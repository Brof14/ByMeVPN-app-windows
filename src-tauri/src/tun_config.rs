use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use uuid::Uuid;

fn text<'a>(value: &'a Value, names: &[&str]) -> Option<&'a str> {
    names.iter().find_map(|name| {
        value
            .get(*name)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
    })
}

fn valid_host(host: &str) -> bool {
    if host.contains(['/', '@', '?', '#', ' ', '\\']) {
        return false;
    }
    url::Url::parse(&format!("https://{host}"))
        .is_ok_and(|url| url.host_str().is_some() && url.port().is_none())
}

#[allow(dead_code)]
pub fn build_tun_config(session: &Value) -> Result<Value, String> {
    build_tun_config_ext(session, false, "none")
}

pub fn build_tun_config_ext(session: &Value, bypass_ru: bool, ad_block: &str) -> Result<Value, String> {
    if text(session, &["protocol"]).unwrap_or("vless") != "vless"
        || text(session, &["security"]).unwrap_or("reality") != "reality"
        || !matches!(text(session, &["network"]).unwrap_or("tcp"), "tcp" | "raw")
    {
        return Err("Сервер использует пока не поддерживаемый протокол Windows.".into());
    }
    let host = text(session, &["server", "endpoint"])
        .filter(|s| valid_host(s))
        .ok_or("Сервер вернул некорректный адрес VPN.")?;
    let sni = text(session, &["server_name", "sni"])
        .filter(|s| valid_host(s))
        .ok_or("Сервер не вернул корректное имя Reality.")?;
    let id = text(session, &["uuid", "id"])
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or("Сервер вернул некорректный идентификатор VPN.")?;
    let key = text(session, &["public_key", "server_public_key"])
        .filter(|key| {
            URL_SAFE_NO_PAD
                .decode(key)
                .is_ok_and(|bytes| bytes.len() == 32)
        })
        .ok_or("Сервер вернул некорректный ключ Reality.")?;
    let port = session.get("port").and_then(Value::as_u64).unwrap_or(443);
    if !(1..=65535).contains(&port) {
        return Err("Сервер вернул некорректный порт VPN.".into());
    }
    let short_id = text(session, &["short_id"]).unwrap_or("");
    if short_id.len() > 16
        || short_id.len() % 2 != 0
        || !short_id.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Сервер вернул некорректный Reality short ID.".into());
    }
    let flow = text(session, &["flow"]).unwrap_or("xtls-rprx-vision");
    if flow != "xtls-rprx-vision" {
        return Err("Сервер использует неподдерживаемый режим VLESS.".into());
    }

    let mut rules = Vec::new();

    // 1. Anti-recursion: exclude VPN server host from tunnel to prevent routing loops
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        rules.push(json!({
            "type": "field",
            "ip": [format!("{ip}/32")],
            "outboundTag": "direct"
        }));
    } else {
        rules.push(json!({
            "type": "field",
            "domain": [format!("full:{host}")],
            "outboundTag": "direct"
        }));
    }

    // 2. Local/private network bypass
    rules.push(json!({
        "type": "field",
        "ip": ["geoip:private"],
        "outboundTag": "direct"
    }));

    if ad_block == "basic" || ad_block == "recommended" {
        rules.push(json!({
            "type": "field",
            "domain": ["geosite:category-ads-all"],
            "outboundTag": "block"
        }));
    }

    if bypass_ru {
        rules.push(json!({
            "type": "field",
            "domain": [
                "geosite:category-ru",
                "geosite:category-gov-ru",
                "domain:ru",
                "domain:su",
                "domain:xn--p1ai",
                "domain:gosuslugi.ru"
            ],
            "outboundTag": "direct"
        }));
        rules.push(json!({
            "type": "field",
            "ip": ["geoip:ru"],
            "outboundTag": "direct"
        }));
    }

    Ok(json!({
        "log": {"loglevel": "warning"},
        "inbounds": [{
            "tag": "tun",
            "protocol": "tun",
            "settings": {
                "name": "ByMeVPN",
                "mtu": 1500,
                "gateway": ["172.31.255.1/30"],
                "dns": ["1.1.1.1", "8.8.8.8"],
                "autoSystemRoutingTable": ["0.0.0.0/0"],
                "autoSystemWfpBlockLeak": ["dns", "misconfigtun"]
            }
        }],
        "outbounds": [
            {
                "tag": "proxy",
                "protocol": "vless",
                "settings": {
                    "vnext": [{
                        "address": host,
                        "port": port,
                        "users": [{
                            "id": id.to_string(),
                            "encryption": "none",
                            "flow": flow
                        }]
                    }]
                },
                "streamSettings": {
                    "network": "tcp",
                    "security": "reality",
                    "realitySettings": {
                        "fingerprint": text(session, &["fingerprint"]).unwrap_or("chrome"),
                        "serverName": sni,
                        "publicKey": key,
                        "shortId": short_id
                    }
                }
            },
            {
                "tag": "direct",
                "protocol": "freedom"
            },
            {
                "tag": "block",
                "protocol": "blackhole"
            }
        ],
        "routing": {
            "domainStrategy": "IPIfNonMatch",
            "rules": rules
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn session() -> serde_json::Value {
        json!({"protocol":"vless", "server":"192.0.2.1", "port":443,
          "uuid":"11111111-1111-4111-8111-111111111111", "security":"reality",
          "server_name":"example.com", "public_key":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          "short_id":"0123456789abcdef", "network":"tcp"})
    }

    #[test]
    fn builds_system_tun_config_from_valid_session() {
        let result = build_tun_config(&session()).unwrap();
        assert_eq!(result["inbounds"][0]["protocol"], "tun");
        assert_eq!(
            result["inbounds"][0]["settings"]["autoSystemRoutingTable"][0],
            "0.0.0.0/0"
        );
        assert_eq!(
            result["outbounds"][0]["settings"]["vnext"][0]["address"],
            "192.0.2.1"
        );
        assert_eq!(
            result["outbounds"][0]["streamSettings"]["security"],
            "reality"
        );
    }

    #[test]
    fn rejects_unsupported_or_incomplete_sessions() {
        let mut invalid = session();
        invalid["protocol"] = json!("hysteria2");
        assert!(build_tun_config(&invalid).is_err());
        invalid = session();
        invalid["uuid"] = json!("broken");
        assert!(build_tun_config(&invalid).is_err());
        invalid = session();
        invalid["public_key"] = json!("");
        assert!(build_tun_config(&invalid).is_err());
        invalid = session();
        invalid["server"] = json!("example.com/path");
        assert!(build_tun_config(&invalid).is_err());
    }

    #[test]
    fn xray_accepts_generated_synthetic_configuration() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../vendor/runtime/windows-x64/xray.exe");
        let path = std::env::temp_dir().join(format!("bymevpn-test-{}.json", Uuid::new_v4()));
        std::fs::write(
            &path,
            serde_json::to_vec(&build_tun_config(&session()).unwrap()).unwrap(),
        )
        .unwrap();
        let result = std::process::Command::new(&root)
            .args(["run", "-test", "-config"])
            .arg(&path)
            .output();
        let _ = std::fs::remove_file(path);
        let output = result.expect("Verified development Xray runtime must be available");
        assert!(
            output.status.success(),
            "Xray rejected the generated test configuration"
        );

        let path_ext = std::env::temp_dir().join(format!("bymevpn-test-ext-{}.json", Uuid::new_v4()));
        std::fs::write(
            &path_ext,
            serde_json::to_vec(&build_tun_config_ext(&session(), true, "recommended").unwrap()).unwrap(),
        )
        .unwrap();
        let result_ext = std::process::Command::new(&root)
            .args(["run", "-test", "-config"])
            .arg(&path_ext)
            .output();
        let _ = std::fs::remove_file(path_ext);
        let output_ext = result_ext.expect("Verified development Xray runtime must be available");
        assert!(
            output_ext.status.success(),
            "Xray rejected the generated extended configuration with RU bypass and ad-block"
        );
    }
}
