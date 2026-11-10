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

// Classifications only. Never expose log lines: Xray errors can embed hosts,
// UUIDs, auth tokens and other details from private subscriptions.
pub fn log_hint(text: &str) -> &'static str {
    let lower = text.to_ascii_lowercase();
    if lower.contains("access is denied") || lower.contains("permission denied") {
        "permissions"
    } else if lower.contains("wintun") || lower.contains("create tun") {
        "adapter"
    } else if lower.contains("failed to add route") || lower.contains("routing table") {
        "routes"
    } else if lower.contains("dns") || lower.contains("resolve") {
        "dns"
    } else if lower.contains("failed") || lower.contains("error") {
        "xray"
    } else {
        "unknown"
    }
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
    fn log_hints_never_include_subscription_secrets() {
        let raw = "Wintun access is denied for uuid=secret";
        assert_eq!(log_hint(raw), "permissions");
        assert_eq!(log_hint("cannot resolve host"), "dns");
        assert_eq!(log_hint("startup successful"), "unknown");
    }
}
