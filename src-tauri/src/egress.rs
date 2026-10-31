use std::net::IpAddr;
use std::time::Duration;

// Public probes explicitly approved by the project owner.
const PROBES: [&str; 3] = [
    "https://api.ipify.org",
    "https://icanhazip.com",
    "https://ifconfig.me/ip",
];

fn parse_ip(body: &str) -> Result<IpAddr, String> {
    if body.len() > 128 {
        return Err("Сервис проверки вернул некорректный ответ.".into());
    }
    body.trim()
        .parse()
        .map_err(|_| "Сервис проверки вернул некорректный IP-адрес.".into())
}

async fn probe_egress(client: &reqwest::Client) -> Result<IpAddr, String> {
    for endpoint in PROBES {
        let mut response = match client.get(endpoint).send().await {
            Ok(response) if response.status().is_success() => response,
            _ => continue,
        };
        if response.content_length().is_some_and(|length| length > 128) {
            continue;
        }
        let mut bytes = Vec::new();
        let mut valid = true;
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) if bytes.len() + chunk.len() <= 128 => bytes.extend_from_slice(&chunk),
                Ok(None) => break,
                _ => { valid = false; break; }
            }
        }
        if valid {
            if let Ok(body) = std::str::from_utf8(&bytes) {
                if let Ok(ip) = parse_ip(body) {
                    return Ok(ip);
                }
            }
        }
    }
    Err("Публичные сервисы проверки IP недоступны.".into())
}

fn probe_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(7))
        .build()
        .map_err(|_| "Не удалось подготовить проверку выхода VPN.".to_string())
}

/// Capture the public network address before changing system routes.
pub async fn public_egress_ip() -> Result<IpAddr, String> {
    probe_egress(&probe_client()?).await
}

/// Require an independently observed public IP different from the original
/// address. A matching server inbound IP is NOT mandatory.
pub async fn verify_egress(baseline: IpAddr) -> Result<IpAddr, String> {
    let observed = probe_egress(&probe_client()?).await?;
    if observed == baseline {
        Err("Внешний IP не изменился: трафик не подтверждён через VPN.".into())
    } else {
        Ok(observed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_ip_only_and_rejects_html_or_oversized_results() {
        assert_eq!(
            parse_ip(" 192.0.2.1\n").unwrap(),
            "192.0.2.1".parse::<IpAddr>().unwrap()
        );
        assert!(parse_ip("<html>192.0.2.1</html>").is_err());
        assert!(parse_ip(&"1".repeat(129)).is_err());
    }
}
