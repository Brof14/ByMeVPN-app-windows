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
    Unavailable,  // External or DNS/TLS services could not be reached.
    Unchanged,    // We DID observe the original IPv4, indicating a route leak.
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
    let ip = candidate.parse::<IpAddr>()
        .map_err(|_| "Сервис проверки вернул некорректный IP-адрес.".to_string())?;
    if !ip.is_ipv4() {
        return Err("Для проверки IPv4 получен адрес другого семейства.".into());
    }
    Ok(ip)
}

async fn query_probe(client: reqwest::Client, endpoint: &'static str) -> Option<IpAddr> {
    let mut response = client.get(endpoint).send().await.ok()?;
    if !response.status().is_success() ||
        response.content_length().is_some_and(|n| n > 1024) {
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
    for endpoint in PROBES {
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
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|_| "Не удалось подготовить проверку выхода VPN.".to_string())
}

/// Capture public IPv4 before changing system routes.
pub async fn public_egress_ip() -> Result<IpAddr, String> {
    probe_egress(probe_client()?).await.ok_or_else(||
        "Публичные сервисы проверки IP до подключения недоступны. Проверьте DNS, HTTPS и доступность сети.".to_string()
    )
}

/// Unchanged is a definite leak signal. Unavailable is only unknown, never
/// a reason to assert protection OR to assume that Xray itself crashed.
pub async fn verify_egress(baseline: IpAddr) -> Result<IpAddr, EgressFailure> {
    let client = probe_client().map_err(|_| EgressFailure::Unavailable)?;
    match probe_egress(client).await {
        Some(observed) if observed == baseline => Err(EgressFailure::Unchanged),
        Some(observed) => Ok(observed),
        None => Err(EgressFailure::Unavailable),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_ip_and_cloudflare_trace_but_rejects_html_and_ipv6() {
        assert_eq!(parse_ip(" 192.0.2.1\n").unwrap(), "192.0.2.1".parse().unwrap());
        let trace = "fl=12f34\nh=www.cloudflare.com\nip=198.51.100.9\nts=1700000000\n";
        assert_eq!(parse_ip(trace).unwrap(), "198.51.100.9".parse().unwrap());
        assert!(parse_ip("<html>192.0.2.1</html>").is_err());
        assert!(parse_ip("2001:db8::1").is_err());
        assert!(parse_ip(&"1".repeat(1025)).is_err());
    }
}
