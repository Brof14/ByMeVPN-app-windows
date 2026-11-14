use std::net::IpAddr;
use std::time::Duration;
use tokio::task::JoinSet;

// Independent HTTPS egress endpoints. Any single successful IPv4 reply is
// sufficient; requests are concurrent, not a 3 * 7-second serial bottleneck.
// The trace endpoint has a different response format and provider.
const PROBES: [&str; 6] = [
    "https://api4.ipify.org",
    "https://ipv4.icanhazip.com",
    "https://ifconfig.me/ip",
    "https://checkip.amazonaws.com",
    "https://ipinfo.io/ip",
    "https://www.cloudflare.com/cdn-cgi/trace",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EgressFailure {
    Unavailable, // External or DNS/TLS services could not be reached.
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EgressCheck {
    Verified(IpAddr),
    Unchanged,
    Unavailable,
    Unverified(IpAddr),
}

pub fn classify_egress(
    baseline: Option<IpAddr>,
    observed: Result<IpAddr, EgressFailure>,
) -> EgressCheck {
    match (baseline, observed) {
        (Some(baseline), Ok(observed)) if baseline == observed => EgressCheck::Unchanged,
        (Some(_), Ok(observed)) => EgressCheck::Verified(observed),
        (None, Ok(observed)) => EgressCheck::Unverified(observed),
        (_, Err(_)) => EgressCheck::Unavailable,
    }
}

/// Status for explicit, user-initiated diagnostics. This never exposes
/// an address and never equates a reachable service with leak-free routing.
pub fn egress_result_code(result: EgressCheck) -> &'static str {
    match result {
        EgressCheck::Verified(_) => "changed",
        EgressCheck::Unchanged => "unchanged",
        EgressCheck::Unverified(_) => "baseline_missing",
        EgressCheck::Unavailable => "unavailable",
    }
}

/// Two independent paths to the *same* HTTPS endpoint are required:
/// (a) authenticated local Xray HTTP CONNECT -> configured remote VPN,
/// (b) a normal system request expected to traverse Windows TUN.
/// A changed system IPv4 by itself was the source of false "VPN connected".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TunnelProof {
    Verified(IpAddr),
    RoutingBypass,
    ProxyUnreachable,
    TunUnreachable,
    BaselineUnavailable,
    BaselineUnchanged,
    ProbeUnavailable,
}

impl TunnelProof {
    pub fn verified_ip(self) -> Option<IpAddr> {
        if let Self::Verified(ip) = self {
            Some(ip)
        } else {
            None
        }
    }

    pub fn status(self) -> &'static str {
        match self {
            Self::Verified(_) => "paths_match",
            Self::RoutingBypass => "routing_bypass",
            Self::ProxyUnreachable => "server_unreachable",
            Self::TunUnreachable => "tun_no_traffic",
            Self::BaselineUnavailable => "baseline_unknown",
            Self::BaselineUnchanged => "exit_unchanged",
            Self::ProbeUnavailable => "probe_unavailable",
        }
    }
}

pub fn classify_tunnel_path(
    baseline: Option<IpAddr>,
    remote_via_xray: Option<IpAddr>,
    system_via_tun: Option<IpAddr>,
) -> TunnelProof {
    let Some(via_proxy) = remote_via_xray else {
        return TunnelProof::ProxyUnreachable;
    };
    let Some(via_system) = system_via_tun else {
        return TunnelProof::TunUnreachable;
    };
    if via_proxy != via_system {
        return TunnelProof::RoutingBypass;
    }
    match baseline {
        None => TunnelProof::BaselineUnavailable,
        Some(before) if before == via_system => TunnelProof::BaselineUnchanged,
        Some(_) => TunnelProof::Verified(via_system),
    }
}

fn authenticated_proxy_client(port: u16, password: &str) -> Result<reqwest::Client, String> {
    let proxy = reqwest::Proxy::all(format!("http://127.0.0.1:{port}"))
        .map_err(|_| "Некорректный локальный адрес проверки VPN.".to_string())?
        .basic_auth("bymevpn", password);
    reqwest::Client::builder()
        .proxy(proxy)
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_millis(2500))
        .timeout(Duration::from_millis(4500))
        .build()
        .map_err(|_| "Не удалось подготовить защищённый тест VPN.".to_string())
}

/// Server-only preflight: does the configured Xray proxy itself pass a real
/// HTTPS request? Until this is true, Windows TUN routes must not be changed.
pub async fn preflight_xray_server(port: u16, password: &str) -> bool {
    let Ok(client) = authenticated_proxy_client(port, password) else {
        return false;
    };
    tokio::time::timeout(Duration::from_secs(7), probe_egress(client))
        .await
        .ok()
        .flatten()
        .is_some()
}

/// End-to-end evidence using Xray's authenticated loopback HTTP inbound. The
/// two measurements use the *same* provider, unlike the old random-provider
/// IP comparison. Tests never contain real subscription credentials.
pub async fn verify_tunnel_path(
    baseline: Option<IpAddr>,
    port: u16,
    password: &str,
) -> TunnelProof {
    let via_xray = match authenticated_proxy_client(port, password) {
        Ok(client) => client,
        Err(_) => return TunnelProof::ProbeUnavailable,
    };
    let system = match probe_client() {
        Ok(client) => client,
        Err(_) => return TunnelProof::ProbeUnavailable,
    };
    // Test independent providers concurrently, and measure both routes to the
    // same provider at the same time. Serial probing used to spend the entire
    // startup window waiting on one blocked HTTPS/DNS provider before trying
    // a working fallback.
    let pair = async {
        let mut probes = JoinSet::new();
        for endpoint in PROBES {
            let proxy = via_xray.clone();
            let direct = system.clone();
            probes.spawn(async move {
                // This local inbound has a forced proxy routing rule, so a
                // successful response proves the selected server path.
                let (remote, system) =
                    tokio::join!(query_probe(proxy, endpoint), query_probe(direct, endpoint));
                (remote, system)
            });
        }
        let mut proxy_reachable = false;
        while let Some(result) = probes.join_next().await {
            match result {
                Ok((Some(remote_ip), Some(system_ip))) => {
                    probes.abort_all();
                    return classify_tunnel_path(baseline, Some(remote_ip), Some(system_ip));
                }
                Ok((Some(_), _)) => proxy_reachable = true,
                _ => {}
            }
        }
        if proxy_reachable {
            TunnelProof::TunUnreachable
        } else {
            TunnelProof::ProxyUnreachable
        }
    };
    // Each provider pair now runs concurrently; leave a short bounded window
    // for DNS/TLS setup while preserving fail-safe rollback.
    tokio::time::timeout(Duration::from_secs(6), pair)
        .await
        .unwrap_or(TunnelProof::ProbeUnavailable)
}

fn parse_ip(body: &str) -> Result<IpAddr, String> {
    if body.len() > 1024 {
        return Err("Сервис проверки вернул слишком большой ответ.".into());
    }
    let plain = body.trim();
    let candidate = if let Some(line) = plain.lines().find(|line| line.starts_with("ip=")) {
        line.trim_start_matches("ip=").trim()
    } else {
        plain
    };
    let ip = candidate
        .parse::<IpAddr>()
        .map_err(|_| "Сервис проверки вернул некорректный IP-адрес.".to_string())?;
    if !ip.is_ipv4() {
        return Err("Для проверки IPv4 получен адрес другого семейства.".into());
    }
    Ok(ip)
}

async fn query_probe(client: reqwest::Client, endpoint: &'static str) -> Option<IpAddr> {
    let mut response = client.get(endpoint).send().await.ok()?;
    if !response.status().is_success() || response.content_length().is_some_and(|n| n > 1024) {
        return None;
    }
    let mut body = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) if body.len() + chunk.len() <= 1024 => body.extend_from_slice(&chunk),
            Ok(None) => break,
            _ => return None,
        }
    }
    let text = std::str::from_utf8(&body).ok()?;
    parse_ip(text).ok()
}

async fn probe_egress(client: reqwest::Client) -> Option<IpAddr> {
    let mut probes = JoinSet::new();
    // Stagger the fallback providers: most checks succeed with one of the
    // first three, so don't open six connections on every watchdog tick.
    for endpoint in PROBES.iter().take(3) {
        probes.spawn(query_probe(client.clone(), endpoint));
    }
    let initial = tokio::time::timeout(Duration::from_millis(650), async {
        while let Some(result) = probes.join_next().await {
            if let Ok(Some(ip)) = result {
                return Some(ip);
            }
        }
        None
    })
    .await;
    if let Ok(Some(ip)) = initial {
        probes.abort_all();
        return Some(ip);
    }

    // Existing probes continue if the grace period elapsed. If the primary
    // providers all failed, start backups immediately without waiting.
    for endpoint in PROBES.iter().skip(3) {
        probes.spawn(query_probe(client.clone(), endpoint));
    }
    while let Some(result) = probes.join_next().await {
        if let Ok(Some(ip)) = result {
            probes.abort_all();
            return Some(ip);
        }
    }
    None
}

fn probe_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .https_only(true)
        // Check the OS-installed route, never a browser-configured proxy.
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_millis(2500))
        .timeout(Duration::from_millis(4500))
        .build()
        .map_err(|_| "Не удалось подготовить проверку выхода VPN.".to_string())
}

/// Capture public IPv4 before changing system routes.
pub async fn public_egress_ip() -> Result<IpAddr, String> {
    probe_egress(probe_client()?).await.ok_or_else(||
        "Публичные сервисы проверки IP до подключения недоступны. Проверьте DNS, HTTPS и доступность сети.".to_string()
    )
}

/// A missing baseline permits a tunnel attempt but can never verify protection.
pub async fn verify_egress(baseline: Option<IpAddr>) -> EgressCheck {
    let observed = match probe_client() {
        Ok(client) => probe_egress(client).await.ok_or(EgressFailure::Unavailable),
        Err(_) => Err(EgressFailure::Unavailable),
    };
    classify_egress(baseline, observed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_statuses_never_confuse_no_probe_with_a_changed_ip() {
        let old = "192.0.2.1".parse::<IpAddr>().unwrap();
        let new = "198.51.100.2".parse::<IpAddr>().unwrap();
        assert_eq!(
            egress_result_code(classify_egress(Some(old), Ok(new))),
            "changed"
        );
        assert_eq!(
            egress_result_code(classify_egress(Some(old), Ok(old))),
            "unchanged"
        );
        assert_eq!(
            egress_result_code(classify_egress(None, Ok(new))),
            "baseline_missing"
        );
        assert_eq!(
            egress_result_code(classify_egress(Some(old), Err(EgressFailure::Unavailable))),
            "unavailable"
        );
    }

    #[test]
    fn matching_proxy_and_tun_exits_are_not_a_full_health_confirmation() {
        let ip: IpAddr = "198.51.100.2".parse().unwrap();
        // The caller must also check the active TUN route, DNS and Xray
        // process. This intermediate result must never claim "verified VPN".
        assert_eq!(TunnelProof::Verified(ip).status(), "paths_match");
        assert_ne!(TunnelProof::Verified(ip).status(), "verified");
    }

    #[test]
    fn changed_direct_ip_cannot_be_verified_without_a_matching_proxy_ip() {
        let original: IpAddr = "192.0.2.10".parse().unwrap();
        let direct: IpAddr = "198.51.100.9".parse().unwrap();
        let via_xray: IpAddr = "203.0.113.45".parse().unwrap();
        assert_eq!(
            classify_tunnel_path(Some(original), Some(via_xray), Some(direct)),
            TunnelProof::RoutingBypass
        );
        assert_eq!(
            classify_tunnel_path(Some(original), None, Some(direct)),
            TunnelProof::ProxyUnreachable
        );
        assert_eq!(
            classify_tunnel_path(Some(original), Some(via_xray), None),
            TunnelProof::TunUnreachable
        );
        assert_eq!(
            classify_tunnel_path(Some(original), Some(direct), Some(direct)),
            TunnelProof::Verified(direct)
        );
        assert_eq!(
            classify_tunnel_path(None, Some(direct), Some(direct)),
            TunnelProof::BaselineUnavailable
        );
        assert_eq!(
            classify_tunnel_path(Some(direct), Some(direct), Some(direct)),
            TunnelProof::BaselineUnchanged
        );
    }

    #[test]
    fn missing_baseline_does_not_prevent_start_but_never_claims_verification() {
        let observed = "198.51.100.9".parse::<IpAddr>().unwrap();
        assert_eq!(
            classify_egress(None, Ok(observed)),
            EgressCheck::Unverified(observed)
        );
        assert_eq!(
            classify_egress(None, Err(EgressFailure::Unavailable)),
            EgressCheck::Unavailable
        );
    }

    #[test]
    fn known_baseline_detects_changed_and_unchanged_egress() {
        let baseline = "192.0.2.10".parse::<IpAddr>().unwrap();
        let vpn_ip = "198.51.100.9".parse::<IpAddr>().unwrap();
        assert_eq!(
            classify_egress(Some(baseline), Ok(vpn_ip)),
            EgressCheck::Verified(vpn_ip)
        );
        assert_eq!(
            classify_egress(Some(baseline), Ok(baseline)),
            EgressCheck::Unchanged
        );
    }

    #[test]
    fn accepts_plain_ip_and_cloudflare_trace_but_rejects_html_and_ipv6() {
        assert_eq!(
            parse_ip(" 192.0.2.1\n").unwrap(),
            "192.0.2.1".parse::<IpAddr>().unwrap()
        );
        let trace = "fl=12f34\nh=www.cloudflare.com\nip=198.51.100.9\nts=1700000000\n";
        assert_eq!(
            parse_ip(trace).unwrap(),
            "198.51.100.9".parse::<IpAddr>().unwrap()
        );
        assert!(parse_ip("<html>192.0.2.1</html>").is_err());
        assert!(parse_ip("2001:db8::1").is_err());
        assert!(parse_ip(&"1".repeat(1025)).is_err());
    }
}
