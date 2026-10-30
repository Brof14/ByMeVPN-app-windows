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

pub async fn verify_egress(expected: IpAddr) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(7))
        .build()
        .map_err(|_| "Не удалось подготовить проверку выхода VPN.".to_string())?;
    let mut observed_other = false;
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
                Ok(Some(chunk)) if bytes.len() + chunk.len() <= 128 => {
                    bytes.extend_from_slice(&chunk)
                }
                Ok(None) => break,
                _ => {
                    valid = false;
                    break;
                }
            }
        }
        let body = match std::str::from_utf8(&bytes) {
            Ok(body) if valid => body,
            _ => continue,
        };
        if let Ok(ip) = parse_ip(body) {
            if ip == expected {
                return Ok(());
            }
            observed_other = true;
        }
    }
    if observed_other {
        Err("Проверка показала другой внешний IP. Защита VPN не подтверждена.".into())
    } else {
        Err("Не удалось проверить внешний IP. Защита VPN не подтверждена.".into())
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
