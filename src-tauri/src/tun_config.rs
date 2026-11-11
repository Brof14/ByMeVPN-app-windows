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
    if host.parse::<std::net::IpAddr>().is_ok() {
        return true;
    }
    url::Url::parse(&format!("https://{host}"))
        .is_ok_and(|url| url.host_str().is_some() && url.port().is_none())
}

fn session_alpn(session: &Value) -> Result<Option<Vec<String>>, String> {
    let entries: Vec<&str> = match session.get("alpn") {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::String(value)) => value.split(',').collect(),
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| value.as_str().ok_or("Сервер вернул некорректный TLS ALPN."))
            .collect::<Result<_, _>>()?,
        _ => return Err("Сервер вернул некорректный TLS ALPN.".into()),
    };
    let protocols: Vec<String> = entries
        .into_iter()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect();
    if protocols.len() > 16
        || protocols.iter().any(|value| {
            value.len() > 255 || !value.is_ascii() || value.bytes().any(|b| b.is_ascii_control())
        })
    {
        return Err("Сервер вернул некорректный TLS ALPN.".into());
    }
    Ok((!protocols.is_empty()).then_some(protocols))
}

#[allow(dead_code)]
pub fn build_tun_config(session: &Value) -> Result<Value, String> {
    build_tun_config_ext(session, false, "none", "cloudflare")
}

pub fn build_tun_config_ext(
    session: &Value,
    bypass_ru: bool,
    ad_block: &str,
    dns_mode: &str,
) -> Result<Value, String> {
    let protocol = text(session, &["protocol"])
        .unwrap_or("vless")
        .to_ascii_lowercase();
    let security = text(session, &["security"])
        .unwrap_or("reality")
        .to_ascii_lowercase();
    let network = text(session, &["network"])
        .unwrap_or("tcp")
        .to_ascii_lowercase();
    let host = text(session, &["server", "endpoint"])
        .filter(|s| valid_host(s))
        .ok_or("Сервер вернул некорректный адрес VPN.")?;
    let sni = text(session, &["server_name", "sni"]);
    if sni.is_some_and(|name| !valid_host(name)) || (security == "reality" && sni.is_none()) {
        return Err("Сервер не вернул корректное имя TLS.".into());
    }
    let port = session
        .get("port")
        .and_then(|port| {
            port.as_u64()
                .or_else(|| port.as_str().and_then(|value| value.parse::<u64>().ok()))
        })
        .unwrap_or(0);
    if !(1..=65535).contains(&port) {
        return Err("Сервер вернул некорректный порт VPN.".into());
    }
    let fingerprint = text(session, &["fingerprint"]).unwrap_or(
        if matches!(protocol.as_str(), "hysteria2" | "hy2") {
            "firefox"
        } else {
            "chrome"
        },
    );
    let alpn = session_alpn(session)?;

    let proxy_outbound = match protocol.as_str() {
        "vless" => {
            // Match Android XrayConfigGenerator: transport support is one
            // boundary decision, not a different list in each UI/API layer.
            let transport = match network.as_str() {
                "tcp" | "raw" => "tcp",
                "grpc" => "grpc",
                "xhttp" => "xhttp",
                "ws" | "websocket" => "ws",
                "httpupgrade" => "httpupgrade",
                _ => return Err("Сервер использует неподдерживаемый транспорт VLESS.".into()),
            };
            if !matches!(security.as_str(), "reality" | "tls" | "none")
                || (security == "reality" && !matches!(transport, "tcp" | "grpc" | "xhttp"))
            {
                return Err(
                    "Сервер использует неподдерживаемую комбинацию транспорта и защиты.".into(),
                );
            }
            let id = text(session, &["uuid", "id"])
                .and_then(|s| Uuid::parse_str(s).ok())
                .ok_or("Сервер вернул некорректный идентификатор VPN.")?;
            // Preserve an explicitly empty flow. XTLS-Vision is only a legacy
            // default for VLESS Reality over TCP, never for TLS or XHTTP.
            let default_flow = if security == "reality" && matches!(network.as_str(), "tcp" | "raw")
            {
                "xtls-rprx-vision"
            } else {
                ""
            };
            let flow = session
                .get("flow")
                .and_then(Value::as_str)
                .unwrap_or(default_flow);
            if !flow.is_empty() && flow != "xtls-rprx-vision" {
                return Err("Сервер использует неподдерживаемый режим VLESS.".into());
            }
            let mut user = json!({"id": id.to_string(), "encryption": "none"});
            if !flow.is_empty() {
                user["flow"] = json!(flow);
            }
            let mut stream_settings = json!({
                "network": transport,
                "security": security,
            });
            if transport == "grpc" {
                let mut grpc =
                    json!({"serviceName": text(session, &["transport_path"]).unwrap_or("")});
                if text(session, &["transport_mode"])
                    .is_some_and(|mode| mode.eq_ignore_ascii_case("multi"))
                {
                    grpc["multiMode"] = json!(true);
                }
                stream_settings["grpcSettings"] = grpc;
            }
            if transport == "ws" {
                let mut ws = json!({});
                if let Some(path) = text(session, &["transport_path"]) {
                    ws["path"] = json!(path);
                }
                if let Some(host) = text(session, &["transport_host"]) {
                    ws["headers"] = json!({"Host": host});
                }
                stream_settings["wsSettings"] = ws;
            }
            if transport == "httpupgrade" {
                let mut upgrade = json!({});
                if let Some(path) = text(session, &["transport_path"]) {
                    upgrade["path"] = json!(path);
                }
                if let Some(host) = text(session, &["transport_host"]) {
                    upgrade["host"] = json!(host);
                }
                stream_settings["httpupgradeSettings"] = upgrade;
            }
            if transport == "xhttp" {
                let mut settings = json!({});
                for (field, aliases) in [
                    ("path", &["transport_path"][..]),
                    ("host", &["transport_host"][..]),
                    ("mode", &["transport_mode"][..]),
                ] {
                    if let Some(value) = text(session, aliases) {
                        settings[field] = json!(value);
                    }
                }
                stream_settings["xhttpSettings"] = settings;
            }
            if security == "reality" {
                let key = text(session, &["public_key", "server_public_key"])
                    .filter(|key| {
                        URL_SAFE_NO_PAD
                            .decode(key)
                            .is_ok_and(|bytes| bytes.len() == 32)
                    })
                    .ok_or("Сервер вернул некорректный ключ Reality.")?;
                let short_id = text(session, &["short_id"]).unwrap_or("");
                if short_id.len() > 16
                    || !short_id.len().is_multiple_of(2)
                    || !short_id.bytes().all(|b| b.is_ascii_hexdigit())
                {
                    return Err("Сервер вернул некорректный Reality short ID.".into());
                }
                stream_settings["realitySettings"] = json!({
                    "fingerprint": fingerprint,
                    "serverName": sni.ok_or("Сервер не вернул корректное имя TLS.")?,
                    "publicKey": key,
                    "shortId": short_id
                });
            } else if security == "tls" {
                let mut tls_settings = json!({"fingerprint": fingerprint});
                if let Some(name) = sni {
                    tls_settings["serverName"] = json!(name);
                }
                if let Some(values) = alpn.as_ref() {
                    tls_settings["alpn"] = json!(values);
                }
                stream_settings["tlsSettings"] = tls_settings;
            }
            json!({
                "tag": "proxy",
                "protocol": "vless",
                "settings": {"vnext": [{
                    "address": host,
                    "port": port,
                    "users": [user]
                }]},
                "streamSettings": stream_settings
            })
        }
        "hysteria2" | "hy2" => {
            if security != "tls" || !matches!(network.as_str(), "udp" | "hysteria") {
                return Err("Некорректные параметры Hysteria 2.".into());
            }
            let auth =
                text(session, &["uuid", "id"]).ok_or("Сервер не вернул пароль Hysteria 2.")?;
            let obfuscation = text(session, &["encryption"]).unwrap_or("");
            let obfuscation_password = text(session, &["flow"]).unwrap_or("");
            if !obfuscation.is_empty() && obfuscation != "salamander" {
                return Err("Сервер использует неизвестную обфускацию Hysteria 2.".into());
            }
            if obfuscation == "salamander" && obfuscation_password.is_empty() {
                return Err("Сервер не вернул пароль обфускации Hysteria 2.".into());
            }
            let mut tls_settings = json!({
                "fingerprint": fingerprint,
                "alpn": alpn.unwrap_or_else(|| vec!["h3".to_string()])
            });
            if let Some(name) = sni {
                tls_settings["serverName"] = json!(name);
            }
            let mut stream_settings = json!({
                "network": "hysteria",
                "security": "tls",
                "hysteriaSettings": {"version": 2, "auth": auth},
                "tlsSettings": tls_settings
            });
            if obfuscation == "salamander" {
                stream_settings["finalmask"] = json!({
                    "udp": [{"type": "salamander", "settings": {"password": obfuscation_password}}]
                });
            }
            json!({
                "tag": "proxy",
                "protocol": "hysteria",
                "settings": {"version": 2, "address": host, "port": port},
                "streamSettings": stream_settings
            })
        }
        _ => return Err("Сервер использует пока не поддерживаемый протокол Windows.".into()),
    };

    let dns_servers = match dns_mode {
        "cloudflare" => ["1.1.1.1", "1.0.0.1"],
        "adguard" => ["94.140.14.14", "94.140.15.15"],
        "google" => ["8.8.8.8", "8.8.4.4"],
        _ => return Err("Неизвестный DNS-провайдер.".into()),
    };

    let mut rules = Vec::new();

    // Windows routes DNS through the virtual TUN adapter. Intercept port 53
    // before any RU/LAN bypass rule; otherwise the WFP DNS leak blocker can
    // leave the OS resolver unreachable or send DNS outside the proxy.
    rules.push(json!({
        "type": "field",
        "inboundTag": ["tun"],
        "port": "53",
        "network": "tcp,udp",
        "outboundTag": "dns-out"
    }));
    // Built-in DNS lookups must go via the encrypted proxy rather than
    // matching geolocation bypass rules for their upstream resolver IPs.
    rules.push(json!({
        "type": "field",
        "inboundTag": ["bymevpn-dns-query"],
        "outboundTag": "proxy"
    }));

    // 1. Anti-recursion: exclude VPN server host from tunnel to prevent routing loops
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        rules.push(json!({
            "type": "field",
            "ip": [format!("{ip}/{}", if ip.is_ipv4() { 32 } else { 128 })],
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
        "dns": {
            "servers": dns_servers,
            "queryStrategy": "UseIP",
            "tag": "bymevpn-dns-query"
        },
        "inbounds": [{
            "tag": "tun",
            "protocol": "tun",
            "settings": {
                "name": "ByMeVPN",
                "mtu": 1500,
                // Explicitly route both IP families through TUN. Otherwise
                // "misconfigtun" blocks IPv6 and dual-stack HTTP/DNS probes
                // can fail while IPv4 is otherwise connected.
                "gateway": ["172.31.255.1/30", "fd30:31:255::1/64"],
                "dns": dns_servers,
                "autoSystemRoutingTable": ["0.0.0.0/0", "::/0"],
                "autoOutboundsInterface": "auto",
                "autoSystemWfpBlockLeak": ["dns", "misconfigtun"]
            }
        }],
        "outbounds": [
            proxy_outbound,
            {
                "tag": "direct",
                "protocol": "freedom"
            },
            {
                "tag": "block",
                "protocol": "blackhole"
            },
            {
                "tag": "dns-out",
                "protocol": "dns"
            }
        ],
        "routing": {
            "domainStrategy": "IPIfNonMatch",
            "rules": rules
        }
    }))
}

/// A one-session, authenticated HTTP CONNECT listener proves whether the
/// selected Xray outbound can reach the internet independently of Windows
/// TUN routing. It never listens on a LAN address or becomes a default system
/// proxy. Caller supplies a fresh loopback port and per-session credentials.
pub fn add_attestation_http_inbound(
    config: &mut Value,
    port: u16,
    user: &str,
    password: &str,
) -> Result<(), String> {
    if port == 0
        || user.is_empty()
        || password.is_empty()
        || config["inbounds"].as_array().is_none()
        || config["routing"]["rules"].as_array().is_none()
    {
        return Err("Невозможно создать защищённый локальный тест VPN.".into());
    }
    let inbounds = config["inbounds"].as_array_mut().unwrap();
    if inbounds.iter().any(|inbound| {
        inbound["tag"] == "bymevpn-attestation" || inbound["port"].as_u64() == Some(u64::from(port))
    }) {
        return Err("Локальный тест VPN уже добавлен.".into());
    }
    inbounds.push(json!({
        "tag": "bymevpn-attestation",
        "listen": "127.0.0.1",
        "port": port,
        "protocol": "http",
        "settings": {
            "users": [{"user": user, "pass": password}],
            "allowTransparent": false
        }
    }));
    // Exact tag match, ahead of RU bypass, DNS and any user routing rule:
    // this test cannot accidentally escape via a 'direct' outbound.
    config["routing"]["rules"].as_array_mut().unwrap().insert(
        0,
        json!({
            "type": "field",
            "inboundTag": ["bymevpn-attestation"],
            "outboundTag": "proxy"
        }),
    );
    Ok(())
}

pub fn supports_windows_session(session: &Value) -> bool {
    build_tun_config_ext(session, false, "none", "cloudflare").is_ok()
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
        assert_eq!(result["routing"]["rules"][0]["inboundTag"][0], "tun");
        assert_eq!(result["routing"]["rules"][0]["port"], "53");
        assert_eq!(result["routing"]["rules"][0]["outboundTag"], "dns-out");
        assert_eq!(
            result["routing"]["rules"][1]["inboundTag"][0],
            "bymevpn-dns-query"
        );
        assert_eq!(result["routing"]["rules"][1]["outboundTag"], "proxy");
        assert_eq!(result["outbounds"][3]["protocol"], "dns");
        assert_eq!(result["dns"]["tag"], "bymevpn-dns-query");
        assert_eq!(result["dns"]["servers"][0], "1.1.1.1");
        assert_eq!(
            result["inbounds"][0]["settings"]["autoSystemRoutingTable"][0],
            "0.0.0.0/0"
        );
        assert_eq!(
            result["inbounds"][0]["settings"]["autoSystemRoutingTable"][1],
            "::/0"
        );
        assert_eq!(
            result["inbounds"][0]["settings"]["autoOutboundsInterface"],
            "auto"
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
    fn server_support_matches_full_windows_configuration_validation() {
        assert!(supports_windows_session(&session()));

        let mut unsupported_flow = session();
        unsupported_flow["flow"] = json!("xtls-rprx-vision-invalid");
        assert!(!supports_windows_session(&unsupported_flow));

        let mut missing_key = session();
        missing_key["public_key"] = json!(null);
        assert!(!supports_windows_session(&missing_key));
    }

    #[test]
    fn supports_android_hysteria2_sessions_and_salamander_obfuscation() {
        let mut session = session();
        session["protocol"] = json!("hysteria2");
        session["network"] = json!("udp");
        session["security"] = json!("tls");
        session["uuid"] = json!("subscription-auth");
        session["public_key"] = json!("");
        session["encryption"] = json!("salamander");
        session["flow"] = json!("obfuscation-password");

        assert!(supports_windows_session(&session));
        let config = build_tun_config(&session).unwrap();
        assert_eq!(config["outbounds"][0]["protocol"], "hysteria");
        assert_eq!(config["outbounds"][0]["settings"]["version"], 2);
        assert_eq!(
            config["outbounds"][0]["streamSettings"]["network"],
            "hysteria"
        );
        assert_eq!(
            config["outbounds"][0]["streamSettings"]["hysteriaSettings"]["auth"],
            "subscription-auth"
        );
        assert_eq!(
            config["outbounds"][0]["streamSettings"]["finalmask"]["udp"][0]["type"],
            "salamander"
        );
    }

    #[test]
    fn supports_android_vless_xhttp_with_tls() {
        let mut session = session();
        session["security"] = json!("tls");
        session["public_key"] = json!(null);
        session["network"] = json!("xhttp");
        session["transport_path"] = json!("/edge");
        session["transport_host"] = json!("cdn.example.com");
        session["transport_mode"] = json!("stream-up");

        assert!(supports_windows_session(&session));
        let config = build_tun_config(&session).unwrap();
        assert_eq!(config["outbounds"][0]["protocol"], "vless");
        assert_eq!(config["outbounds"][0]["streamSettings"]["network"], "xhttp");
        assert_eq!(
            config["outbounds"][0]["streamSettings"]["xhttpSettings"]["path"],
            "/edge"
        );
        assert_eq!(
            config["outbounds"][0]["streamSettings"]["tlsSettings"]["serverName"],
            "example.com"
        );
        assert!(config["outbounds"][0]["settings"]["vnext"][0]["users"][0]
            .get("flow")
            .is_none());
    }

    #[test]
    fn honors_explicit_empty_reality_flow_and_never_defaults_vision_for_tls() {
        let mut reality = session();
        reality["flow"] = json!("");
        let config = build_tun_config(&reality).unwrap();
        assert!(config["outbounds"][0]["settings"]["vnext"][0]["users"][0]
            .get("flow")
            .is_none());

        let mut tls = session();
        tls["security"] = json!("tls");
        tls["public_key"] = json!(null);
        let config = build_tun_config(&tls).unwrap();
        assert!(config["outbounds"][0]["settings"]["vnext"][0]["users"][0]
            .get("flow")
            .is_none());
    }

    #[test]
    fn tls_alpn_matches_android_subscription_without_invented_defaults() {
        let mut tls = session();
        tls["security"] = json!("tls");
        tls["public_key"] = json!(null);
        tls["alpn"] = json!(["h2", "http/1.1"]);
        let config = build_tun_config(&tls).unwrap();
        assert_eq!(
            config["outbounds"][0]["streamSettings"]["tlsSettings"]["alpn"],
            json!(["h2", "http/1.1"])
        );

        tls.as_object_mut().unwrap().remove("alpn");
        let config = build_tun_config(&tls).unwrap();
        assert!(config["outbounds"][0]["streamSettings"]["tlsSettings"]
            .get("alpn")
            .is_none());
    }

    #[test]
    fn supports_android_alpn_csv_hysteria_defaults_and_missing_sni() {
        let mut tls = session();
        tls["security"] = json!("tls");
        tls["public_key"] = json!(null);
        tls["server_name"] = json!("");
        tls["alpn"] = json!(" h2, http/1.1 ");
        let config = build_tun_config(&tls).unwrap();
        assert_eq!(
            config["outbounds"][0]["streamSettings"]["tlsSettings"]["alpn"],
            json!(["h2", "http/1.1"])
        );
        assert!(config["outbounds"][0]["streamSettings"]["tlsSettings"]
            .get("serverName")
            .is_none());

        let mut hy2 = tls.clone();
        hy2["protocol"] = json!("hysteria2");
        hy2["network"] = json!("udp");
        hy2["uuid"] = json!("server-supplied-auth");
        hy2["alpn"] = json!(["h3", "custom-protocol"]);
        let config = build_tun_config(&hy2).unwrap();
        assert_eq!(
            config["outbounds"][0]["streamSettings"]["tlsSettings"]["alpn"],
            json!(["h3", "custom-protocol"])
        );
        hy2.as_object_mut().unwrap().remove("alpn");
        let config = build_tun_config(&hy2).unwrap();
        assert_eq!(
            config["outbounds"][0]["streamSettings"]["tlsSettings"]["alpn"],
            json!(["h3"])
        );
    }

    #[test]
    fn accepts_valid_ipv6_server_and_numeric_string_port() {
        let mut ipv6 = session();
        ipv6["server"] = json!("2001:db8::1");
        ipv6["port"] = json!("16287");
        let config = build_tun_config(&ipv6).unwrap();
        assert_eq!(
            config["outbounds"][0]["settings"]["vnext"][0]["address"],
            "2001:db8::1"
        );
        assert_eq!(
            config["outbounds"][0]["settings"]["vnext"][0]["port"],
            16287
        );
    }

    #[test]
    fn rejects_missing_or_invalid_port_and_malformed_alpn() {
        let mut missing_port = session();
        missing_port.as_object_mut().unwrap().remove("port");
        assert!(build_tun_config(&missing_port).is_err());

        let mut tls = session();
        tls["security"] = json!("tls");
        tls["public_key"] = json!(null);
        tls["alpn"] = json!({"bogus": "h2"});
        assert!(build_tun_config(&tls).is_err());

        tls["alpn"] = json!(["h2", 17]);
        assert!(build_tun_config(&tls).is_err());
    }

    #[test]
    fn validates_dns_mode_and_generates_provider_addresses() {
        let config = build_tun_config_ext(&session(), true, "none", "adguard").unwrap();
        assert_eq!(config["inbounds"][0]["settings"]["dns"][0], "94.140.14.14");
        assert!(build_tun_config_ext(&session(), true, "none", "untrusted").is_err());
    }

    #[test]
    fn authenticated_local_probe_is_forced_through_the_selected_vpn_outbound() {
        let mut config = build_tun_config(&session()).unwrap();
        add_attestation_http_inbound(&mut config, 38271, "byme", "random-secret").unwrap();
        assert_eq!(config["inbounds"][1]["protocol"], "http");
        assert_eq!(config["inbounds"][1]["listen"], "127.0.0.1");
        assert_eq!(config["inbounds"][1]["port"], 38271);
        assert_eq!(
            config["inbounds"][1]["settings"]["users"][0]["user"],
            "byme"
        );
        assert_eq!(
            config["inbounds"][1]["settings"]["users"][0]["pass"],
            "random-secret"
        );
        assert_eq!(
            config["routing"]["rules"][0]["inboundTag"][0],
            "bymevpn-attestation"
        );
        assert_eq!(config["routing"]["rules"][0]["outboundTag"], "proxy");
        assert_eq!(config["outbounds"][0]["tag"], "proxy");
        assert!(add_attestation_http_inbound(&mut config, 38271, "byme", "secret").is_err());
    }

    #[test]
    fn preflight_does_not_create_tun_routes_or_wfp_filters() {
        let mut config = build_tun_config(&session()).unwrap();
        add_attestation_http_inbound(&mut config, 38271, "bymevpn", "unique-password").unwrap();
        let preflight = preflight_attestation_config(&config).unwrap();

        let inbounds = preflight["inbounds"].as_array().unwrap();
        assert_eq!(inbounds.len(), 1);
        assert_eq!(inbounds[0]["protocol"], "http");
        assert_eq!(inbounds[0]["listen"], "127.0.0.1");
        assert_eq!(inbounds[0]["tag"], "bymevpn-attestation");
        assert_eq!(preflight["routing"]["rules"][0]["outboundTag"], "proxy");
        assert!(preflight["outbounds"].as_array().unwrap().iter().any(|outbound| {
            outbound["tag"] == "proxy"
        }));
        assert!(preflight.to_string().find("autoSystemRoutingTable").is_none());
        assert!(preflight.to_string().find("autoSystemWfpBlockLeak").is_none());
        assert_eq!(config["inbounds"][0]["protocol"], "tun");
    }

    #[test]
    fn preflight_rejects_missing_authenticated_probe_without_modifying_system() {
        let base = build_tun_config(&session()).unwrap();
        assert!(preflight_attestation_config(&base).is_err());
    }

    #[test]
    fn xray_accepts_attested_tun_config_with_local_http_proxy() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../vendor/runtime/windows-x64/xray.exe");
        let mut config = build_tun_config(&session()).unwrap();
        add_attestation_http_inbound(&mut config, 38271, "byme", "random-secret").unwrap();
        let path =
            std::env::temp_dir().join(format!("bymevpn-attestation-{}.json", Uuid::new_v4()));
        std::fs::write(&path, serde_json::to_vec(&config).unwrap()).unwrap();
        let result = std::process::Command::new(&root)
            .args(["run", "-test", "-config"])
            .arg(&path)
            .output()
            .unwrap();
        let _ = std::fs::remove_file(path);
        assert!(
            result.status.success(),
            "Attestation config failed Xray -test: {}",
            String::from_utf8_lossy(&result.stderr)
        );
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

        let path_ext =
            std::env::temp_dir().join(format!("bymevpn-test-ext-{}.json", Uuid::new_v4()));
        std::fs::write(
            &path_ext,
            serde_json::to_vec(
                &build_tun_config_ext(&session(), true, "recommended", "cloudflare").unwrap(),
            )
            .unwrap(),
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

    #[test]
    fn xray_accepts_android_xhttp_tls_and_hysteria2_profiles() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../vendor/runtime/windows-x64/xray.exe");
        let mut xhttp = session();
        xhttp["security"] = json!("tls");
        xhttp["public_key"] = json!(null);
        xhttp["network"] = json!("xhttp");
        xhttp["transport_path"] = json!("/edge");
        xhttp["transport_host"] = json!("cdn.example.com");
        xhttp["transport_mode"] = json!("stream-up");
        let mut hysteria = session();
        hysteria["protocol"] = json!("hysteria2");
        hysteria["network"] = json!("udp");
        hysteria["security"] = json!("tls");
        hysteria["uuid"] = json!("subscription-auth");
        hysteria["public_key"] = json!("");
        hysteria["encryption"] = json!("salamander");
        hysteria["flow"] = json!("obfuscation-password");

        for (name, config) in [
            ("xhttp", build_tun_config(&xhttp).unwrap()),
            ("hysteria2", build_tun_config(&hysteria).unwrap()),
        ] {
            let path = std::env::temp_dir().join(format!("bymevpn-{name}-{}.json", Uuid::new_v4()));
            std::fs::write(&path, serde_json::to_vec(&config).unwrap()).unwrap();
            let result = std::process::Command::new(&root)
                .args(["run", "-test", "-config"])
                .arg(&path)
                .output();
            let _ = std::fs::remove_file(path);
            let output = result.expect("Verified development Xray runtime must be available");
            assert!(
                output.status.success(),
                "Xray rejected the generated {name} config: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }
    #[test]
    fn android_transport_matrix_grpc_ws_and_httpupgrade_matches_subscription() {
        for (network, security) in [
            ("grpc", "tls"),
            ("grpc", "reality"),
            ("ws", "tls"),
            ("websocket", "tls"),
            ("httpupgrade", "tls"),
            ("ws", "none"),
            ("tcp", "none"),
        ] {
            let mut node = session();
            node["network"] = json!(network);
            node["security"] = json!(security);
            node["flow"] = json!("");
            node["transport_path"] = json!(if network == "grpc" {
                "my-service"
            } else {
                "/cdn"
            });
            node["transport_host"] = json!("proxy.example.com");
            node["transport_mode"] = json!("multi");
            assert!(supports_windows_session(&node), "{network} / {security}");
            let config = build_tun_config(&node).unwrap();
            let stream = &config["outbounds"][0]["streamSettings"];
            match network {
                "grpc" => {
                    assert_eq!(stream["grpcSettings"]["serviceName"], "my-service");
                    assert_eq!(stream["grpcSettings"]["multiMode"], true);
                }
                "ws" | "websocket" => {
                    assert_eq!(stream["network"], "ws");
                    assert_eq!(stream["wsSettings"]["path"], "/cdn");
                    assert_eq!(stream["wsSettings"]["headers"]["Host"], "proxy.example.com");
                }
                "httpupgrade" => {
                    assert_eq!(stream["httpupgradeSettings"]["path"], "/cdn");
                    assert_eq!(stream["httpupgradeSettings"]["host"], "proxy.example.com");
                }
                _ => {}
            }
            if security == "none" {
                assert!(stream.get("tlsSettings").is_none());
                assert!(stream.get("realitySettings").is_none());
            }
        }
        let mut invalid = session();
        invalid["network"] = json!("ws");
        assert!(
            !supports_windows_session(&invalid),
            "Android forbids Reality over WS"
        );
        invalid["network"] = json!("httpupgrade");
        assert!(!supports_windows_session(&invalid));
    }

    #[test]
    fn xray_accepts_android_grpc_and_ws_transport_configs() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../vendor/runtime/windows-x64/xray.exe");
        for (name, security) in [
            ("grpc", "tls"),
            ("grpc", "reality"),
            ("ws", "tls"),
            ("httpupgrade", "tls"),
        ] {
            let mut node = session();
            node["network"] = json!(name);
            node["security"] = json!(security);
            node["flow"] = json!("");
            node["transport_path"] = json!(if name == "grpc" {
                "grpc-service"
            } else {
                "/edge"
            });
            node["transport_host"] = json!("cdn.example.com");
            let config = build_tun_config(&node).unwrap();
            let path = std::env::temp_dir().join(format!("bymevpn-{name}-{}.json", Uuid::new_v4()));
            std::fs::write(&path, serde_json::to_vec(&config).unwrap()).unwrap();
            let result = std::process::Command::new(&root)
                .args(["run", "-test", "-config"])
                .arg(&path)
                .output();
            let _ = std::fs::remove_file(path);
            let output = result.expect("Verified Xray binary required for transport acceptance");
            assert!(
                output.status.success(),
                "Xray rejected {name}/{security}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }
}
