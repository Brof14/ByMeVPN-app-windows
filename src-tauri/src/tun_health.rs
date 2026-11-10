use serde::Serialize;

// Read-only Windows route inspection. No user input reaches PowerShell, and no
// subscription keys, adapter IPs or raw Xray logs are returned to the frontend.
#[derive(Debug, Serialize)]
pub struct RouteReport {
    pub adapter: String,
    pub ipv4_default: Option<bool>,
    pub ipv6_default: Option<bool>,
}

impl Default for RouteReport {
    fn default() -> Self {
        Self {
            adapter: "unknown".to_string(),
            ipv4_default: None,
            ipv6_default: None,
        }
    }
}

impl RouteReport {
    pub fn definitely_missing(&self) -> bool {
        matches!(self.adapter.as_str(), "missing" | "down") || self.ipv4_default == Some(false)
    }
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

// Xray writes continuously while the tunnel is active; a diagnostics request
// must never load an unbounded file or return its sensitive raw content.
pub fn startup_log_hint(path: &std::path::Path) -> &'static str {
    use std::io::{Read, Seek, SeekFrom};
    const MAX_TAIL_BYTES: u64 = 64 * 1024;

    let Ok(mut file) = std::fs::File::open(path) else {
        return "unknown";
    };
    let Ok(size) = file.metadata().map(|metadata| metadata.len()) else {
        return "unknown";
    };
    if file
        .seek(SeekFrom::Start(size.saturating_sub(MAX_TAIL_BYTES)))
        .is_err()
    {
        return "unknown";
    }
    let mut tail = Vec::new();
    if file.take(MAX_TAIL_BYTES).read_to_end(&mut tail).is_err() {
        return "unknown";
    }
    log_hint(&String::from_utf8_lossy(&tail))
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
            "error", "failed", "failure", "denied", "cannot ", "unable to",
            "timed out", "timeout", "refused",
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
        assert_eq!(log_hint("2026/11/10 20:00:00 [Info] dns lookup started"), "unknown");
        assert_eq!(log_hint("DNS servers: 1.1.1.1; routing bymevpn-dns-query"), "unknown");
        assert_eq!(log_hint("2026/11/10 [Warning] DNS was slow"), "unknown");
        assert_eq!(log_hint("2026/11/10 [Error] DNS query failed: timeout"), "dns");
        assert_eq!(log_hint("failed to resolve host"), "dns");
    }

    #[test]
    fn recent_error_line_takes_precedence_over_older_unrelated_diagnostics() {
        assert_eq!(log_hint("error: DNS request failed\\ninfo: route applied"), "dns");
        assert_eq!(log_hint("failed to resolve host\\nWintun access is denied"), "permissions");
        assert_eq!(log_hint("DNS warning from a previous connection"), "unknown");
    }

    #[test]
    fn log_hints_never_include_subscription_secrets() {
        let raw = "Wintun access is denied for uuid=secret";
        assert_eq!(log_hint(raw), "permissions");
        assert_eq!(log_hint("cannot resolve host"), "dns");
        assert_eq!(log_hint("startup successful"), "unknown");
    }
}
