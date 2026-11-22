use serde::Serialize;

// Read-only Windows route inspection. No user input reaches PowerShell, and no
// subscription keys, adapter IPs or raw Xray logs are returned to the frontend.
#[derive(Debug, Serialize)]
pub struct RouteReport {
    pub adapter: String,
    pub ipv4_default: Option<bool>,
    pub ipv6_default: Option<bool>,
    /// Does the Windows routing policy actually choose the TUN interface?
    /// A route merely existing in Get-NetRoute does not prove selection.
    pub effective_ipv4: Option<bool>,
    /// Is the VPN endpoint still reachable through the physical gateway,
    /// i.e. there is no routing loop where the endpoint is captured by TUN.
    pub endpoint_via_physical_gateway: Option<bool>,
    /// True when the VPN endpoint resolves to the TUN adapter instead of the
    /// physical network, which would create a routing loop.
    pub routing_loop: bool,
}

impl Default for RouteReport {
    fn default() -> Self {
        Self {
            adapter: "unknown".to_string(),
            ipv4_default: None,
            ipv6_default: None,
            effective_ipv4: None,
            endpoint_via_physical_gateway: None,
            routing_loop: false,
        }
    }
}

impl RouteReport {
    pub fn definitely_missing(&self) -> bool {
        matches!(self.adapter.as_str(), "missing" | "down")
            || self.ipv4_default == Some(false)
            || self.effective_ipv4 == Some(false)
            || self.routing_loop
    }

    /// A routing loop means the VPN endpoint is no longer reachable through
    /// the physical gateway, so the tunnel would capture its own traffic.
    pub fn has_routing_loop(&self) -> bool {
        self.routing_loop || self.endpoint_via_physical_gateway == Some(false)
    }
}

/// Conservative evidence for a *current* tunnel, not a proof against all
/// DNS/IPv6 leaks. A changed public IPv4 alone never qualifies.
pub fn health_proves_connection(
    routes: &RouteReport,
    dns_ok: Option<bool>,
    process_running: bool,
    traffic_observed: bool,
) -> bool {
    process_running
        && routes.adapter == "up"
        && routes.ipv4_default == Some(true)
        && routes.effective_ipv4 == Some(true)
        && dns_ok == Some(true)
        && traffic_observed
}

fn parse_report(text: &str) -> RouteReport {
    let mut report = RouteReport::default();
    for line in text.lines() {
        let Some((key, value)) = line.trim().split_once('=') else {
            continue;
        };
        match key {
            "adapter" if matches!(value, "up" | "down" | "missing") => {
                report.adapter = value.to_string();
            }
            "ipv4" => report.ipv4_default = parse_bool(value),
            "ipv6" => report.ipv6_default = parse_bool(value),
            "effective_ipv4" => report.effective_ipv4 = parse_bool(value),
            "endpoint_via_physical_gateway" => report.endpoint_via_physical_gateway = parse_bool(value),
            "routing_loop" => report.routing_loop = value == "1",
            _ => {}
        }
    }
    report
}

fn parse_bool(value: &str) -> Option<bool> {
    match value {
        "1" => Some(true),
        "0" => Some(false),
        _ => None,
    }
}

#[cfg(windows)]
fn inspect_sync() -> RouteReport {
    use std::os::windows::process::CommandExt;

    // Cover both full and split default routes. Read-only; never call
    // New-NetRoute, Set-NetRoute, adapter creation or elevation.
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$a = Get-NetAdapter -Name 'ByMeVPN' -ErrorAction SilentlyContinue
if ($null -eq $a) { Write-Output 'adapter=missing'; exit 0 }
if ($a.Status -eq 'Up') { Write-Output 'adapter=up' }
else { Write-Output 'adapter=down' }
$r = @(Get-NetRoute -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty DestinationPrefix)
$v4 = ($r -contains '0.0.0.0/0') -or (
    ($r -contains '0.0.0.0/1') -and ($r -contains '128.0.0.0/1'))
$v6 = ($r -contains '::/0') -or (
    ($r -contains '::/1') -and ($r -contains '8000::/1'))
Write-Output ('ipv4=' + [int]$v4)
Write-Output ('ipv6=' + [int]$v6)
# Get-NetRoute alone only proves that a route was installed. Find-NetRoute
# tests the actual route Windows picks for a public destination without
# transmitting a packet or changing any OS configuration.
$best = @(Find-NetRoute -RemoteIPAddress '9.9.9.9' -ErrorAction SilentlyContinue |
    Where-Object { $_.PSObject.Properties.Name -contains 'DestinationPrefix' } |
    Select-Object -First 1)
if ($best.Count -gt 0) {
    Write-Output ('effective_ipv4=' + [int]($best[0].InterfaceIndex -eq $a.ifIndex))
} else { Write-Output 'effective_ipv4=unknown' }
"#;
    std::process::Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            SCRIPT,
        ])
        .creation_flags(0x0800_0000)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| parse_report(&String::from_utf8_lossy(&output.stdout)))
        .unwrap_or_default()
}

#[cfg(not(windows))]
fn inspect_sync() -> RouteReport {
    RouteReport::default()
}

pub async fn inspect() -> RouteReport {
    tauri::async_runtime::spawn_blocking(inspect_sync)
        .await
        .unwrap_or_default()
}

/// Verifies that the VPN endpoint is still reachable through the *physical*
/// gateway and not captured by the ByMeVPN TUN adapter. A false result means
/// a routing loop: traffic to the endpoint would be sent into the tunnel.
#[cfg(windows)]
pub fn detect_routing_loop_sync(endpoint: &str) -> bool {
    use std::os::windows::process::CommandExt;
    if endpoint.trim().is_empty() {
        return false;
    }
    let script = format!(
        r#"
$ErrorActionPreference = 'SilentlyContinue'
$a = Get-NetAdapter -Name 'ByMeVPN' -ErrorAction SilentlyContinue
$best = @(Find-NetRoute -RemoteIPAddress '{endpoint}' -ErrorAction SilentlyContinue |
    Select-Object -First 1)
if ($best.Count -eq 0) {{ Write-Output 'loop=unknown'; exit 0 }}
$idx = $best[0].InterfaceIndex
if ($null -ne $a -and $idx -eq $a.ifIndex) {{ Write-Output 'loop=1' }} else {{ Write-Output 'loop=0' }}
"#,
        endpoint = endpoint.replace('\'', "")
    );
    std::process::Command::new("powershell.exe")
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(0x0800_0000)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("loop=1"))
        .unwrap_or(false)
}

#[cfg(not(windows))]
pub fn detect_routing_loop_sync(_endpoint: &str) -> bool {
    false
}

pub async fn detect_routing_loop(endpoint: &str) -> bool {
    let endpoint = endpoint.to_string();
    tauri::async_runtime::spawn_blocking(move || detect_routing_loop_sync(&endpoint))
        .await
        .unwrap_or(false)
}

/// Returns true when the endpoint is reachable through the physical gateway
/// (no routing loop).
pub async fn vpn_endpoint_reachable_via_physical_gateway(endpoint: &str) -> bool {
    !detect_routing_loop(endpoint).await
}

/// Restore IPv4/IPv6 routes and DNS on every failure path. Idempotent.
pub async fn restore_routes_and_dns_on_failure() -> Result<(), String> {
    cleanup_bymevpn_routes_after_exit().await
}

/// Best-effort recovery *after our Xray process has exited*. Xray removes
/// WFP filters when its handles close, but process termination can interrupt
/// its Go-side route/DNS cleanup. Remove only stale default routes and DNS on
/// the adapter owned by ByMeVPN; never change the physical network adapter.
/// If Windows denies the operation, report it rather than claiming recovery.
#[cfg(windows)]
pub fn cleanup_bymevpn_routes_after_exit_sync() -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$a = Get-NetAdapter -Name 'ByMeVPN' -ErrorAction SilentlyContinue
if ($null -eq $a) { exit 0 }
$prefixes = @('0.0.0.0/0', '0.0.0.0/1', '128.0.0.0/1', '::/0', '::/1', '8000::/1')
$stale = @(Get-NetRoute -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue |
    Where-Object { $prefixes -contains $_.DestinationPrefix })
foreach ($route in $stale) {
    Remove-NetRoute -InputObject $route -Confirm:$false -ErrorAction Stop
}
# A clean disconnect already removes these settings. Don't demand elevated
# permissions to do a needless DNS reset when the TUN has no DNS configured.
$dns = @(Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue |
    ForEach-Object { $_.ServerAddresses } | Where-Object { $_ })
if ($dns.Count -gt 0) {
    Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ResetServerAddresses -ErrorAction Stop
}
"#;
    let output = std::process::Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            SCRIPT,
        ])
        .creation_flags(0x0800_0000)
        .output()
        .map_err(|_| "Не удалось проверить восстановление сети Windows.".to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err("Windows не разрешила удалить оставшиеся маршруты ByMeVPN. Перезапустите компьютер, если интернет не восстановился.".into())
    }
}

#[cfg(not(windows))]
pub fn cleanup_bymevpn_routes_after_exit_sync() -> Result<(), String> {
    Ok(())
}

pub async fn cleanup_bymevpn_routes_after_exit() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(cleanup_bymevpn_routes_after_exit_sync)
        .await
        .map_err(|_| "Не удалось завершить восстановление сети Windows.".to_string())?
}

// Xray writes continuously while the tunnel is active; a diagnostics request
// must never load an unbounded file or return its sensitive raw content.
fn read_log_tail(path: &std::path::Path) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    const MAX_TAIL_BYTES: u64 = 64 * 1024;

    let mut file = std::fs::File::open(path).ok()?;
    let size = file.metadata().ok()?.len();
    file.seek(SeekFrom::Start(size.saturating_sub(MAX_TAIL_BYTES)))
        .ok()?;
    let mut tail = Vec::new();
    file.take(MAX_TAIL_BYTES).read_to_end(&mut tail).ok()?;
    Some(String::from_utf8_lossy(&tail).into_owned())
}

pub fn startup_log_hint(path: &std::path::Path) -> &'static str {
    read_log_tail(path)
        .map(|tail| log_hint(&tail))
        .unwrap_or("unknown")
}

/// Human-readable cause from the local Xray journal. Callers may append this
/// to a connection error; it deliberately returns a fixed phrase instead of a
/// raw log line so hosts, UUIDs, passwords and subscription paths never reach
/// the WebView or a support message.
pub fn xray_failure_diagnosis(path: &std::path::Path) -> Option<&'static str> {
    read_log_tail(path).and_then(|tail| xray_failure_hint(&tail))
}

pub fn xray_failure_hint(text: &str) -> Option<&'static str> {
    let mut saw_failure = false;
    for line in text.lines().rev().take(300) {
        let line = line.to_ascii_lowercase();
        let failure = [
            "error",
            "failed",
            "failure",
            "denied",
            "cannot ",
            "unable to",
            "timed out",
            "timeout",
            "refused",
            "invalid",
            "rejected",
            "unreachable",
        ]
        .iter()
        .any(|part| line.contains(part));
        if !failure {
            continue;
        }
        saw_failure = true;
        if line.contains("access is denied") || line.contains("permission denied") {
            return Some("Windows отклонила операцию; приложению нужны права администратора");
        }
        if line.contains("wintun") || line.contains("create tun") {
            return Some("не удалось создать TUN-адаптер ByMeVPN");
        }
        if line.contains("failed to add route") || line.contains("routing table") {
            return Some("не удалось применить маршруты Windows");
        }
        if line.contains("connection refused") || line.contains("actively refused") {
            return Some("сервер отклонил подключение (connection refused)");
        }
        if line.contains("i/o timeout")
            || line.contains("context deadline exceeded")
            || line.contains("timed out")
            || line.contains("timeout")
        {
            return Some("сервер не ответил за отведённое время (timeout)");
        }
        if line.contains("no such host")
            || line.contains("failed to resolve")
            || line.contains("could not resolve")
        {
            return Some("не удалось определить адрес сервера (DNS)");
        }
        if line.contains("x509") || line.contains("certificate") || line.contains("tls:") {
            return Some("сервер не прошёл проверку TLS-сертификата");
        }
        if line.contains("reality") {
            return Some("сервер отклонил параметры Reality");
        }
        if line.contains("authentication")
            || line.contains("invalid user")
            || line.contains("unauthorized")
            || line.contains("invalid password")
        {
            return Some("сервер отклонил ключ или пароль подключения");
        }
        if line.contains("eof") {
            return Some("сервер закрыл соединение (EOF)");
        }
        if line.contains("unknown config")
            || line.contains("failed to parse")
            || line.contains("invalid config")
        {
            return Some("Xray отклонил конфигурацию подключения");
        }
    }
    saw_failure.then_some("Xray сообщил об ошибке; подробности в локальном журнале")
}

// Classifications only. Never expose log lines: Xray errors can embed hosts,
// UUIDs, auth tokens and other details from private subscriptions.
pub fn log_hint(text: &str) -> &'static str {
    // Only classify explicit failures, most recent first. In particular,
    // the mere presence of 'dns' in Xray's normal routing messages is NOT a
    // DNS error. Logs are overwritten at VPN startup, but may include both
    // warnings and later successful recoveries.
    for line in text.lines().rev().take(200) {
        let line = line.to_ascii_lowercase();
        let failure = [
            "error",
            "failed",
            "failure",
            "denied",
            "cannot ",
            "unable to",
            "timed out",
            "timeout",
            "refused",
        ]
        .iter()
        .any(|part| line.contains(part));
        if !failure {
            continue;
        }
        if line.contains("access is denied") || line.contains("permission denied") {
            return "permissions";
        }
        if line.contains("wintun") || line.contains("create tun") {
            return "adapter";
        }
        if line.contains("failed to add route") || line.contains("routing table") {
            return "routes";
        }
        if line.contains("dns") || line.contains("resolve") {
            return "dns";
        }
        return "xray";
    }
    "unknown"
}

/// Checks whether Windows can resolve a public hostname *while* the tunnel
/// is active. A failure is only an observation; it does not prove why DNS
/// failed, and must not be presented as a confirmed DNS leak.
pub async fn dns_resolution_check() -> Option<bool> {
    let lookup = async {
        for hostname in ["example.com", "cloudflare.com"] {
            if let Ok(mut addresses) = tokio::net::lookup_host((hostname, 443)).await {
                if addresses.next().is_some() {
                    return true;
                }
            }
        }
        false
    };
    tokio::time::timeout(std::time::Duration::from_secs(5), lookup)
        .await
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_definite_missing_windows_route_counts_as_failure() {
        let ready = parse_report("adapter=up\nipv4=1\nipv6=1\n");
        assert!(!ready.definitely_missing());
        let missing = parse_report("adapter=missing\n");
        assert!(missing.definitely_missing());
        let ipv4 = parse_report("adapter=up\nipv4=0\nipv6=1\n");
        assert!(ipv4.definitely_missing());
        let unknown = parse_report("PowerShell disabled");
        assert!(!unknown.definitely_missing());
        assert_eq!(unknown.ipv6_default, None);
    }

    #[test]
    fn installed_but_not_selected_tun_route_is_not_vpn_protection() {
        let selected = parse_report("adapter=up\nipv4=1\nipv6=1\neffective_ipv4=1\n");
        assert_eq!(selected.effective_ipv4, Some(true));
        assert!(!selected.definitely_missing());
        assert!(health_proves_connection(&selected, Some(true), true, true));

        let bypass = parse_report("adapter=up\nipv4=1\nipv6=1\neffective_ipv4=0\n");
        assert_eq!(bypass.effective_ipv4, Some(false));
        assert!(bypass.definitely_missing());
        assert!(!health_proves_connection(&bypass, Some(true), true, true));

        let unknown = parse_report("adapter=up\nipv4=1\n");
        assert_eq!(unknown.effective_ipv4, None);
        assert!(!health_proves_connection(&unknown, Some(true), true, true));
    }

    #[test]
    fn only_live_confirmed_tunnel_and_dns_qualify_as_healthy_diagnostics() {
        let ready = parse_report("adapter=up\nipv4=1\nipv6=1\neffective_ipv4=1\n");
        assert!(health_proves_connection(&ready, Some(true), true, true));
        assert!(!health_proves_connection(&ready, Some(true), true, false));
        assert!(!health_proves_connection(&ready, None, true, true));
        assert!(!health_proves_connection(&ready, Some(false), true, true));
        assert!(!health_proves_connection(&ready, Some(true), false, true));
        let bad_route = parse_report("adapter=up\nipv4=0\nipv6=1\n");
        assert!(!health_proves_connection(
            &bad_route,
            Some(true),
            true,
            true
        ));
        let down = parse_report("adapter=down\nipv4=1\n");
        assert!(!health_proves_connection(&down, Some(true), true, true));
    }

    #[test]
    fn large_xray_log_is_inspected_from_the_bounded_recent_tail() {
        let path =
            std::env::temp_dir().join(format!("bymevpn-health-log-{}", uuid::Uuid::new_v4()));
        let mut noise = vec![b'x'; 128 * 1024];
        noise.extend_from_slice(b"\\nfailed to create Wintun: access is denied\\n");
        std::fs::write(&path, noise).unwrap();
        let hint = startup_log_hint(&path);
        let _ = std::fs::remove_file(path);
        assert_eq!(hint, "permissions");
    }

    #[test]
    fn dns_keyword_alone_or_warning_does_not_claim_dns_failure() {
        assert_eq!(
            log_hint("2026/11/10 20:00:00 [Info] dns lookup started"),
            "unknown"
        );
        assert_eq!(
            log_hint("DNS servers: 1.1.1.1; routing bymevpn-dns-query"),
            "unknown"
        );
        assert_eq!(log_hint("2026/11/10 [Warning] DNS was slow"), "unknown");
        assert_eq!(
            log_hint("2026/11/10 [Error] DNS query failed: timeout"),
            "dns"
        );
        assert_eq!(log_hint("failed to resolve host"), "dns");
    }

    #[test]
    fn connection_diagnostics_name_common_xray_failures_without_echoing_raw_logs() {
        assert_eq!(
            xray_failure_hint("failed to dial: connection refused"),
            Some("сервер отклонил подключение (connection refused)")
        );
        assert_eq!(
            xray_failure_hint("dial tcp 203.0.113.5:443: i/o timeout"),
            Some("сервер не ответил за отведённое время (timeout)")
        );
        assert_eq!(
            xray_failure_hint("REALITY: processed invalid connection"),
            Some("сервер отклонил параметры Reality")
        );
        assert_eq!(
            xray_failure_hint("tls: failed to verify certificate: x509: expired"),
            Some("сервер не прошёл проверку TLS-сертификата")
        );
        assert_eq!(xray_failure_hint("DNS lookup succeeded"), None);
    }

    #[test]
    fn recent_error_line_takes_precedence_over_older_unrelated_diagnostics() {
        assert_eq!(
            log_hint("error: DNS request failed\\ninfo: route applied"),
            "dns"
        );
        assert_eq!(
            log_hint("failed to resolve host\\nWintun access is denied"),
            "permissions"
        );
        assert_eq!(
            log_hint("DNS warning from a previous connection"),
            "unknown"
        );
    }

    #[test]
    fn log_hints_never_include_subscription_secrets() {
        let raw = "Wintun access is denied for uuid=secret";
        assert_eq!(log_hint(raw), "permissions");
        assert_eq!(log_hint("cannot resolve host"), "dns");
        assert_eq!(log_hint("startup successful"), "unknown");
    }
}
