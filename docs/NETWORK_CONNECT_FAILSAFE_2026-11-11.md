# Windows VPN startup fail-safe (2026-11-11)

## Incident

An installed Windows build could hijack the OS default IPv4/IPv6 routes and DNS while its selected remote VPN server/transport was not actually transferring traffic. The process could remain active with `connected=true` and `verified=false`. The user reported that Internet access stopped during connect.

The code defect was concrete: `vpn_start` rejected `RoutingBypass` and definitely missing routes but allowed `ProxyUnreachable`, `TunUnreachable`, `ProbeUnavailable`, `BaselineUnavailable` and an ineffective DNS/route check to reach `ActiveTunnel`. With `autoSystemRoutingTable` and Windows WFP DNS leak blocking, that could leave every app using a stalled virtual interface.

Xray's Windows TUN cleanup is written in Go `WindowsTun.Close`, but abruptly terminating the process can interrupt Go cleanup while the dynamic WFP session closes. Cleaning up *only* ByMeVPN interface routes/DNS after process termination helps restore normal routing.

## Changed behavior

1. Xray still validates the actual server-provided Xray configuration. No UUID, IP address, auth token or key is built into the app.
2. `preflight_attestation_config` generates a separate config with a credential-protected loopback HTTP inbound and the *actual selected VPN proxy outbound*, **without TUN, WFP, default routes or OS DNS takeover**.
3. A temporary Xray process verifies real HTTPS Internet reachability through the selected server. If it fails, it is stopped and Windows networking has never been changed.
4. After the preflight process exits and releases its loopback port, the full TUN configuration starts. Its end-to-end Xray-vs-Windows probe has a **six-second upper bound** and also requires active TUN routes and system DNS.
5. **Any unverified TUN startup is rejected.** Xray is terminated, its config removed, and any surviving default routes and DNS are removed **only on the `ByMeVPN` adapter**, not Wi-Fi or Ethernet. A failure to restore due to Windows privileges produces an explicit error.
6. `vpn_stop` and the status watchdog attempt the same scoped recovery after child termination, including the case where the previous app left a stale route and no tunnel is tracked.
7. Status checks are serialized with start/stop to avoid deleting routes of a newly started tunnel. WFP anti-leak settings are unchanged when VPN is operating.

## Automated acceptance gates

- Rust: proxy-only preflight has no `tun` inbound or `autoSystemRoutingTable`/`autoSystemWfpBlockLeak`; bunded Windows Xray `run -test` accepts it.
- Node: source contract guarantees preflight occurs before the full TUN process; no active tunnel survives failed verification.
- Windows CI: Rust format/check/tests; frontend regressions; NSIS/MSI installers.
- **Not a real-world VPN success certificate**: automated tests cannot prove live traffic on the user's Windows machine; acceptance requires remote server reachability, DNS, IPv4/IPv6, sleep/resume and UAC checks.

## If the currently installed older build has already blocked Internet

1. **Disconnect** in ByMeVPN and **quit ByMeVPN fully**. If the network stays blocked, reboot Windows to clear process-held WFP filters.
2. If reboot does not restore Internet, inspect the named adapter in **Administrator PowerShell**:

```powershell
Get-NetAdapter -Name 'ByMeVPN' -ErrorAction SilentlyContinue
Get-NetRoute -InterfaceAlias 'ByMeVPN' -ErrorAction SilentlyContinue |
  Select-Object DestinationPrefix,InterfaceAlias,NextHop
```

3. Only when ByMeVPN is closed and those listed default routes persist, remove **exclusively its routes** and DNS settings:

```powershell
$a = Get-NetAdapter -Name 'ByMeVPN' -ErrorAction SilentlyContinue
if ($a) {
  $prefixes = @('0.0.0.0/0','0.0.0.0/1','128.0.0.0/1','::/0','::/1','8000::/1')
  Get-NetRoute -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue |
    Where-Object { $prefixes -contains $_.DestinationPrefix } |
    Remove-NetRoute -Confirm:$false -ErrorAction Stop
  Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ResetServerAddresses
}
```

Do not run global `netsh winsock reset` or erase routes on physical interfaces as a first response. Do not disable all WFP filters: those provide anti-leak protection when the VPN works.

## Constraints

A server-only preflight is intentionally strict. If the network blocks every external HTTPS probe, the application will refuse to enable the system-wide VPN rather than freeze the user's Internet. A known healthy server may be falsely rejected by this guard; refine this only with real diagnostic evidence, not by suppressing the check.

Xray upstream: [TUN README](https://github.com/XTLS/Xray-core/blob/main/proxy/tun/README.md), [Windows implementation](https://github.com/XTLS/Xray-core/blob/main/proxy/tun/tun_windows.go).
