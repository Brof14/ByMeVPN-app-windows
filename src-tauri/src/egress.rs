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
#[cfg(test)]
pub enum EgressFailure {
    Unavailable, // External or DNS/TLS services could not be reached.
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg(test)]
pub enum EgressCheck {
    Verified(IpAddr),
    Unchanged,
    Unavailable,
    Unverified(IpAddr),
}

#[cfg(test)]
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
#[cfg(test)]
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
/// Public VPN egress can vary by connection, so different Xray/TUN IPs alone
/// are not proof of bypass. They also cannot prove matching egress: keep that
/// case unverified even when the system IP differs from the baseline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TunnelProof {
    Verified(IpAddr),
    /// Both Xray and Windows carried a real HTTPS request, but an exit-IP
    /// service was unavailable, so the public route could not be compared.
    TrafficObservedUnverified,
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

    /// Actual HTTPS traffic reached both paths. Callers must still validate
    /// that Windows selects the TUN route and DNS resolves before accepting.
    pub fn traffic_confirmed(self) -> bool {
        matches!(
            self,
            Self::Verified(_) | Self::TrafficObservedUnverified | Self::BaselineUnavailable
        )
    }

    pub fn status(self) -> &'static str {
        match self {
            Self::Verified(_) => "paths_match",
            Self::TrafficObservedUnverified => "traffic_observed_unverified",
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
    match baseline {
        None => TunnelProof::BaselineUnavailable,
        Some(before) if before == via_system && via_proxy != via_system => {
            TunnelProof::RoutingBypass
        }
        Some(before) if before == via_system => TunnelProof::BaselineUnchanged,
        Some(_) if via_proxy != via_system => TunnelProof::TrafficObservedUnverified,
        // The caller still checks the active TUN route and DNS before accepting.
        Some(_) => TunnelProof::Verified(via_system),
    }
}

fn apply_generic_connectivity_fallback(proof: TunnelProof, generic_ok: bool) -> TunnelProof {
    if generic_ok
        && matches!(
            proof,
            TunnelProof::ProxyUnreachable | TunnelProof::TunUnreachable
        )
    {
        TunnelProof::TrafficObservedUnverified
    } else {
        proof
    }
}

fn authenticated_proxy_client_with_timeouts(
    port: u16,
    password: &str,
    connect_timeout: Duration,
    request_timeout: Duration,
) -> Result<reqwest::Client, String> {
    let proxy = reqwest::Proxy::all(format!("http://127.0.0.1:{port}"))
        .map_err(|_| "Некорректный локальный адрес проверки VPN.".to_string())?
        .basic_auth("bymevpn", password);
    reqwest::Client::builder()
        .proxy(proxy)
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(connect_timeout)
        .timeout(request_timeout)
        .build()
        .map_err(|_| "Не удалось подготовить защищённый тест VPN.".to_string())
}

fn authenticated_proxy_client(port: u16, password: &str) -> Result<reqwest::Client, String> {
    authenticated_proxy_client_with_timeouts(
        port,
        password,
        Duration::from_millis(2500),
        Duration::from_millis(4500),
    )
}

/// Xray may take longer than a fixed startup delay to create its loopback
/// inbound, especially while the Windows TUN adapter and routes initialize.
/// Wait for the local socket before sending remote probes so an early
/// connection-refused result is not misreported as an unreachable VPN server.
pub async fn wait_for_attestation_listener(port: u16, timeout: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return false;
        }
        if tokio::time::timeout(
            remaining,
            tokio::net::TcpStream::connect(("127.0.0.1", port)),
        )
        .await
        .is_ok_and(|result| result.is_ok())
        {
            return true;
        }
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return false;
        }
        tokio::time::sleep(remaining.min(Duration::from_millis(75))).await;
    }
}

/// Server-only preflight: does the configured Xray proxy itself pass a real
/// HTTPS request? Try both connectivity-check endpoints and independent IP
/// providers. Some networks block Google/Microsoft checks while allowing the
/// same VPN to carry ordinary HTTPS traffic. Until one real request succeeds,
/// Windows TUN routes must not be changed.
pub async fn preflight_xray_server(port: u16, password: &str) -> bool {
    // Preflight gets a slightly longer request budget than steady-state
    // verification: a cold Reality/QUIC handshake can need more than the
    // ordinary 4.5 seconds on a slow uplink.
    let Ok(client) = authenticated_proxy_client_with_timeouts(
        port,
        password,
        Duration::from_millis(3000),
        Duration::from_millis(6000),
    ) else {
        return false;
    };
    if preflight_attempt(client.clone(), Duration::from_secs(10)).await {
        return true;
    }
    // One bounded retry on the same listener distinguishes a transient
    // handshake/startup timeout from a server that genuinely cannot carry
    // HTTPS. The caller still keeps Windows routes untouched until success.
    tokio::time::sleep(Duration::from_millis(600)).await;
    preflight_attempt(client, Duration::from_secs(5)).await
}

async fn preflight_attempt(client: reqwest::Client, budget: Duration) -> bool {
    tokio::time::timeout(budget, async move {
        first_successful_preflight(probe_https_reachability(client.clone()), async move {
            probe_egress(client).await.is_some()
        })
        .await
    })
    .await
    .is_ok_and(|reachable| reachable)
}

async fn first_successful_preflight(
    first: impl std::future::Future<Output = bool>,
    second: impl std::future::Future<Output = bool>,
) -> bool {
    tokio::pin!(first, second);
    tokio::select! {
        result = &mut first => result || second.await,
        result = &mut second => result || first.await,
    }
}

/// End-to-end evidence using Xray's authenticated loopback HTTP inbound.
/// IP results are compared from the same provider; if IP services are blocked,
/// exact HTTPS connectivity-check responses can confirm traffic without
/// claiming an observed VPN exit address. Tests never contain real secrets.
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
    // Run a generic HTTPS check alongside IP checks. If all IP providers are
    // filtered, ordinary traffic can still be observed without claiming an
    // IP match or leak-free IPv4/IPv6 behavior.
    let ip_paths = probe_ip_paths(baseline, via_xray.clone(), system.clone());
    let generic_paths = probe_https_paths(via_xray, system);
    let pair = resolve_probe_results(ip_paths, generic_paths);
    // A bounded failure remains fail-closed; no process or route is accepted
    // based only on an accepted CONNECT or an unanswered request.
    // Give slow Windows DNS/TUN resolution a little longer than the per-host
    // request deadline before declaring the whole path unavailable.
    tokio::time::timeout(Duration::from_secs(8), pair)
        .await
        .unwrap_or(TunnelProof::ProbeUnavailable)
}

async fn resolve_probe_results(
    ip_paths: impl std::future::Future<Output = TunnelProof>,
    generic_paths: impl std::future::Future<Output = bool>,
) -> TunnelProof {
    tokio::pin!(ip_paths);
    tokio::pin!(generic_paths);
    tokio::select! {
        proof = &mut ip_paths => {
            if matches!(proof, TunnelProof::ProxyUnreachable | TunnelProof::TunUnreachable) {
                apply_generic_connectivity_fallback(proof, generic_paths.await)
            } else {
                proof
            }
        }
        generic_ok = &mut generic_paths => {
            if !generic_ok {
                ip_paths.await
            } else {
                // If a real HTTPS request already passed through both Xray
                // and Windows, give an IP endpoint a brief chance to prove
                // the exit without holding up activation for blocked APIs.
                match tokio::time::timeout(Duration::from_millis(250), &mut ip_paths).await {
                    Ok(proof) => apply_generic_connectivity_fallback(proof, true),
                    Err(_) => TunnelProof::TrafficObservedUnverified,
                }
            }
        }
    }
}

async fn probe_ip_paths(
    baseline: Option<IpAddr>,
    proxy: reqwest::Client,
    system: reqwest::Client,
) -> TunnelProof {
    let mut proxy_reachable = false;
    let mut system_reachable = false;
    // Start fallback providers after a short stagger rather than waiting for
    // earlier pairs to time out. Sequential 4.5s batches could not finish
    // within the enclosing 6s deadline and produced probe_unavailable.
    let mut probes = JoinSet::new();
    for (index, endpoint) in PROBES.iter().enumerate() {
        let proxy = proxy.clone();
        let system = system.clone();
        probes.spawn(async move {
            if index >= 2 {
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            // The Xray inbound forces this request through the selected server.
            tokio::join!(query_probe(proxy, endpoint), query_probe(system, endpoint))
        });
    }
    while let Some(result) = probes.join_next().await {
        match result {
            Ok((Some(remote_ip), Some(system_ip))) => {
                probes.abort_all();
                return classify_tunnel_path(baseline, Some(remote_ip), Some(system_ip));
            }
            Ok((Some(_), None)) => proxy_reachable = true,
            Ok((None, Some(_))) => system_reachable = true,
            _ => {}
        }
    }
    if proxy_reachable {
        TunnelProof::TunUnreachable
    } else if system_reachable {
        TunnelProof::ProxyUnreachable
    } else {
        TunnelProof::ProxyUnreachable
    }
}

const HTTPS_REACHABILITY_ENDPOINTS: [&str; 4] = [
    "https://connectivitycheck.gstatic.com/generate_204",
    "https://www.msftconnecttest.com/connecttest.txt",
    "https://cp.cloudflare.com/generate_204",
    "https://www.google.com/generate_204",
];

// Match Android's tunnel-latency signal: two independent, tiny HTTPS probes
// through the selected outbound, averaged when both respond. The broader set
// above remains for reachability/egress verification where any success is enough.
const SERVER_LATENCY_ENDPOINTS: [&str; 2] = [
    "https://cp.cloudflare.com/generate_204",
    "https://www.google.com/generate_204",
];

pub fn average_server_latency_ms(samples: &[u32]) -> Option<u32> {
    let mut valid = samples
        .iter()
        .copied()
        .filter(|sample| *sample > 0)
        .collect::<Vec<_>>();
    if valid.is_empty() {
        return None;
    }
    valid.sort_unstable();
    let total = valid.iter().map(|sample| u64::from(*sample)).sum::<u64>();
    Some((total / valid.len() as u64).min(u64::from(u32::MAX)) as u32)
}

async fn probe_https_reachability(client: reqwest::Client) -> bool {
    let mut probes = JoinSet::new();
    for endpoint in HTTPS_REACHABILITY_ENDPOINTS {
        let client = client.clone();
        probes.spawn(async move { probe_https_endpoint(client, endpoint).await });
    }
    while let Some(result) = probes.join_next().await {
        if result.is_ok_and(|reachable| reachable) {
            probes.abort_all();
            return true;
        }
    }
    false
}

async fn probe_https_paths(proxy: reqwest::Client, system: reqwest::Client) -> bool {
    let mut probes = JoinSet::new();
    for endpoint in HTTPS_REACHABILITY_ENDPOINTS {
        let proxy = proxy.clone();
        let system = system.clone();
        probes.spawn(async move {
            let (via_proxy, via_system) = tokio::join!(
                probe_https_endpoint(proxy, endpoint),
                probe_https_endpoint(system, endpoint)
            );
            via_proxy && via_system
        });
    }
    while let Some(result) = probes.join_next().await {
        if result.is_ok_and(|reachable| reachable) {
            probes.abort_all();
            return true;
        }
    }
    false
}

async fn probe_https_endpoint(client: reqwest::Client, endpoint: &'static str) -> bool {
    let Ok(mut response) = client.get(endpoint).send().await else {
        return false;
    };
    if endpoint.ends_with("/generate_204") {
        return response.status() == reqwest::StatusCode::NO_CONTENT;
    }
    if response.status() != reqwest::StatusCode::OK
        || response.content_length().is_some_and(|size| size > 64)
    {
        return false;
    }
    let mut body = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) if body.len() + chunk.len() <= 64 => body.extend_from_slice(&chunk),
            Ok(None) => break,
            _ => return false,
        }
    }
    body == b"Microsoft Connect Test"
}

/// Measures a real HTTPS transaction through Xray's authenticated local
/// inbound. This works for UDP-only outbounds such as Hysteria2; a TCP port
/// connect would measure an unrelated service or fail on the same endpoint.
pub async fn measure_xray_server_latency(port: u16, password: &str) -> Option<u32> {
    let client = authenticated_proxy_client(port, password).ok()?;
    let mut probes = JoinSet::new();
    for endpoint in SERVER_LATENCY_ENDPOINTS {
        let client = client.clone();
        probes.spawn(async move {
            let started = tokio::time::Instant::now();
            probe_https_endpoint(client, endpoint)
                .await
                .then(|| started.elapsed().as_millis().max(1).min(9999) as u32)
        });
    }
    tokio::time::timeout(Duration::from_secs(5), async {
        let mut measurements = Vec::with_capacity(SERVER_LATENCY_ENDPOINTS.len());
        while let Some(result) = probes.join_next().await {
            if let Ok(Some(ms)) = result {
                measurements.push(ms);
            }
        }
        average_server_latency_ms(&measurements)
    })
    .await
    .ok()
    .flatten()
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
/// Retry a probe with exponential backoff (250ms, 500ms, 1s, 2s, ...).
pub async fn retry_with_exponential_backoff<F, Fut, T>(
    mut operation: F,
    max_attempts: u32,
) -> Option<T>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Option<T>>,
{
    let mut delay = std::time::Duration::from_millis(250);
    for attempt in 0..max_attempts {
        if let Some(value) = operation().await {
            return Some(value);
        }
        if attempt + 1 < max_attempts {
            tokio::time::sleep(delay).await;
            delay = (delay * 2).min(std::time::Duration::from_secs(8));
        }
    }
    None
}

/// Fallback IP-check endpoint used when the primary probe is unavailable.
pub const FALLBACK_IP_ENDPOINT: &str = "https://api.ipify.org";

pub async fn public_egress_ip() -> Result<IpAddr, String> {
    let client = probe_client()?;
    if let Some(ip) = retry_with_exponential_backoff(
        || {
            let client = client.clone();
            async move { probe_egress(client).await }
        },
        3,
    )
    .await
    {
        return Ok(ip);
    }
    // Fallback endpoint with exponential backoff when primary probes are unavailable.
    if let Some(ip) = retry_with_exponential_backoff(
        || async move {
            let client = probe_client().ok()?;
            query_probe(client, FALLBACK_IP_ENDPOINT).await
        },
        2,
    )
    .await
    {
        return Ok(ip);
    }
    Err("Публичные сервисы проверки IP до подключения недоступны. Проверьте DNS, HTTPS и доступность сети.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_latency_averages_available_outbound_https_samples() {
        assert_eq!(average_server_latency_ms(&[]), None);
        assert_eq!(average_server_latency_ms(&[0, 0]), None);
        assert_eq!(average_server_latency_ms(&[42, 0]), Some(42));
        assert_eq!(average_server_latency_ms(&[80, 20]), Some(50));
        assert_eq!(
            average_server_latency_ms(&[u32::MAX, u32::MAX]),
            Some(u32::MAX)
        );
    }

    #[tokio::test]
    async fn preflight_does_not_wait_for_blocked_connectivity_checks_when_ip_probe_succeeds() {
        let result = tokio::time::timeout(
            Duration::from_millis(100),
            first_successful_preflight(std::future::pending(), async { true }),
        )
        .await;
        assert_eq!(result, Ok(true));
        assert!(first_successful_preflight(async { false }, async { true }).await);
        assert!(!first_successful_preflight(async { false }, async { false }).await);
    }

    #[tokio::test]
    async fn confirmed_ip_result_does_not_wait_for_unresponsive_generic_probe() {
        let ip: IpAddr = "198.51.100.2".parse().unwrap();
        let result = tokio::time::timeout(
            Duration::from_millis(100),
            resolve_probe_results(async { TunnelProof::Verified(ip) }, std::future::pending()),
        )
        .await;
        assert_eq!(result.unwrap(), TunnelProof::Verified(ip));
    }

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
    fn routing_bypass_requires_the_system_path_to_match_the_physical_baseline() {
        let original: IpAddr = "192.0.2.10".parse().unwrap();
        let tunneled: IpAddr = "198.51.100.9".parse().unwrap();
        let other_tunneled_exit: IpAddr = "203.0.113.45".parse().unwrap();
        assert_eq!(
            classify_tunnel_path(Some(original), Some(tunneled), Some(original)),
            TunnelProof::RoutingBypass
        );
        assert_eq!(
            classify_tunnel_path(Some(original), Some(tunneled), None),
            TunnelProof::TunUnreachable
        );
        assert_eq!(
            classify_tunnel_path(Some(original), Some(tunneled), Some(other_tunneled_exit)),
            TunnelProof::TrafficObservedUnverified
        );
        assert_eq!(
            classify_tunnel_path(Some(original), None, Some(tunneled)),
            TunnelProof::ProxyUnreachable
        );
        assert_eq!(
            classify_tunnel_path(Some(original), Some(tunneled), Some(tunneled)),
            TunnelProof::Verified(tunneled)
        );
        assert_eq!(
            classify_tunnel_path(None, Some(tunneled), Some(tunneled)),
            TunnelProof::BaselineUnavailable
        );
        assert_eq!(
            classify_tunnel_path(Some(tunneled), Some(tunneled), Some(tunneled)),
            TunnelProof::BaselineUnchanged
        );
    }

    #[tokio::test]
    async fn waits_for_the_xray_listener_when_startup_is_delayed() {
        let reservation = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = reservation.local_addr().unwrap().port();
        drop(reservation);

        let delayed_listener = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(120)).await;
            let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
                .await
                .unwrap();
            let _ = listener.accept().await;
        });

        assert!(wait_for_attestation_listener(port, Duration::from_secs(1)).await);
        delayed_listener.abort();
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
        let path = classify_tunnel_path(None, Some(observed), Some(observed));
        assert_eq!(path, TunnelProof::BaselineUnavailable);
        assert!(path.traffic_confirmed());
        assert_eq!(path.verified_ip(), None);
        assert!(TunnelProof::TrafficObservedUnverified.traffic_confirmed());
        assert_eq!(
            TunnelProof::TrafficObservedUnverified.status(),
            "traffic_observed_unverified"
        );
    }

    #[test]
    fn generic_https_traffic_recovers_blocked_ip_probe_services_without_claiming_verification() {
        assert_eq!(
            apply_generic_connectivity_fallback(TunnelProof::ProxyUnreachable, true),
            TunnelProof::TrafficObservedUnverified
        );
        assert_eq!(
            apply_generic_connectivity_fallback(TunnelProof::TunUnreachable, true),
            TunnelProof::TrafficObservedUnverified
        );
        assert_eq!(
            apply_generic_connectivity_fallback(TunnelProof::ProxyUnreachable, false),
            TunnelProof::ProxyUnreachable
        );
        assert_eq!(
            apply_generic_connectivity_fallback(TunnelProof::RoutingBypass, true),
            TunnelProof::RoutingBypass
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
