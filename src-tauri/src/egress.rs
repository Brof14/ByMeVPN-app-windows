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
