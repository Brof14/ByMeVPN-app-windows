# Windows VPN recovery and Android parity — 2026-11-10

Status: engineering implementation and automated verification, **not a live Windows VPN acceptance certificate**.

## Source of truth
- Android: `Brof14/ByMeVPN-app` main, `app/src/main/kotlin/com/example/bymevpn/` (Jetpack Compose, actual Xray config generator and subscription parser).
- Windows: `Brof14/ByMeVPN-app-windows` main + PR #16, Tauri 2/WebView2, Rust and packaged Xray/Wintun.
- Backend: `Brof14/ByMeVPN_bot` main + PR #86. Older bind-mounted `legacy_trial_bootstrap.py` can override /servers and /vpn/session.

## Observed failures and confirmed underlying defects

| Symptom / requirement | Root cause found in source | Change and proof |
| --- | --- | --- |
| Windows cannot select gRPC and other Android transports | Windows VLESS builder only accepted tcp/raw/xhttp; backend capability filter excluded gRPC/WS/HTTPUpgrade | Extended VLESS builder to `grpc`, `ws/websocket`, `httpupgrade`, and `security=none` while retaining TLS, Reality, XHTTP, Hysteria2; native synthetic Xray `-test` regressions |
| Backend-selected auto server may be unsupported by Windows | Backend `desktop_vpn_capabilities.py` and legacy route used narrower selectors | PR #86 negotiates explicit `X-VPN-Capabilities` and preserves older Windows default behavior |
| Server cannot connect even with nominal protocol support | `api_router.parse_single_node_line` discarded the gRPC service, HTTP paths/hosts, ALPN, transport mode, Hysteria2 obfuscation and sometimes assigned Vision flow when absent | PR #86 adds transport-preserving parser and URI tests including IPv6 |
| UI says Xray started but no proven VPN | Windows treated a long-running Xray process as `connected` even when egress verification returned unavailable | On startup, inspect Windows ByMeVPN TUN adapter and default routes; reject consistently missing IPv4 route; expose redacted diagnostics. Distinguish Unknown from observed leak |
| Red error toast overlaps navigation | Global fixed bottom toast used Android-sized bottom navigation space | Transient toasts move to upper-right and are size bounded; persistent VPN warnings live under VPN status with a Diagnostics action |
| Windows looked like a tiny phone | Layout forced a 480×720 portrait, single-column mobile WebView | Initial 960×660 logical landscape, auto fit to <=70% usable monitor *area*, resizable; desktop left nav, two-column Home, responsive account/pricing/settings, desktop auth grid |

## TDD / implementation order

1. Added tests for Android transport matrix before modifying `tun_config.rs` (gRPC Reality/TLS, WS/WebSocket, HTTPUpgrade, TLS/none, invalid combos). Bundled Windows Xray binary validates generated synthetic configs; no secrets hardcoded.
2. Implemented minimal Rust mapping from server session fields to the Xray `streamSettings` variants and expanded the capability request header. Enforced the same transport policy on the API side in PR #86, including the legacy override.
3. Replaced portrait-first launch sizing with a pure `initial_window_size` function. Used failing contract tests to drive new dimensions and retained user-resize behavior; no programmatic screen zoom.
4. Kept Android's font/color/icon semantics while adding a desktop-only composition sheet after existing mobile styling; retained three functional tabs and Tauri event mappings.
5. Added a persistent unverified VPN notice instead of a nav-blocking toast. Kept strong warning wording rather than claiming traffic protection from Xray process status alone.
6. Added `tun_health.rs`: a read-only Windows PowerShell adapter/route probe, pure parsing, tests, conservative missing-route detection and categorized diagnostics. No PowerShell modifications, no automatic privilege elevation, no raw key/IP/Xray log disclosure.
7. Added a bounded 64KiB diagnostic log tail reader and test so UI diagnostics cannot read an unbounded Xray log into process memory.
8. Added desktop sign-in composition and contract tests. Retained Android-like Account, Settings, server picker and verified-price checkout from prior PR #15.
9. Investigated GitHub CI failures at `cargo fmt --check` and applied the exact formatting suggestions. Further backend regressions cover URI transport fields and encoded Hysteria2 auth.

## Protocol mapping

| Subscription node | Android | Windows in PR #16 |
| --- | --- | --- |
| VLESS Reality TCP/raw, Vision when explicitly specified | Yes | Yes |
| VLESS TLS TCP/raw | Yes | Yes |
| VLESS TLS or Reality gRPC | Yes | Yes, serviceName and multiMode |
| VLESS TLS/Reality XHTTP | Yes | Yes, path/host/mode |
| VLESS TLS/none WebSocket | Yes | Yes, host/path |
| VLESS TLS/none HTTPUpgrade | Yes | Yes, host/path |
| Hysteria2 UDP + TLS / Salamander | Yes | Yes, auth, ALPN, obfs from subscription |
| TLS/Reality SNI, fingerprint, ALPN | Yes | Yes, when supplied |

This table reflects code and tests, **not confirmed live reachability of every remote server**.

## Windows acceptance steps before calling VPN functional

1. Build Windows CI installer from the PR commit; confirm Rust formatting/tests and NSIS+MSI packaging.
2. Perform a real Windows 10 and 11 test, on multiple DPI levels and physical networks with a valid server-owned subscription, without embedding secrets in client logs.
3. Check Xray/Wintun process, TUN adapter, IPv4/IPv6 default routes, DNS resolution through the tunnel, and outbound public IPv4 before/after.
4. If unverified, open **Диагностика соединения** in the inline warning. It reports adapter present/up, IPv4/IPv6 routing, verification status, and a generic error category; **do not share raw Xray logs or VPN config**.
5. Check reconnect, PC sleep/wake, account expiry/device limit, locale RU/EN, first-time Google/Telegram sign-in, payment and installer upgrade path. Test on both admin and non-admin contexts; do not disable WFP DNS-leak safeguards to force a green result.
6. Capture actual Android and WebView2 screenshots of every state and do real visual comparison. The code-only comparison is **not a pixel-perfect certification**.

### Known limitations

- Cannot prove that the user's particular machine has a working VPN without live Windows network diagnostics. The app now refuses the specific state `Xray alive + definitely absent IPv4 TUN route`; a present route is still **not** equivalent to safe live traffic.
- Windows core privilege separation/elevation is not solved here; a secure privileged helper/service would be required if Wintun requires elevation, not a permanently admin-rights UI. Mobile Hotspot/forwarding and competing VPNs may need distinct Xray network handling.
- A genuine full visual and functional 1:1 result requires actual screenshots and testing of secondary devices, support, renewal, advanced settings and exceptional states. The desktop layout adapts the Android visual language instead of literally reproducing phone dimensions.
- The backend code must **actually be deployed**; merging PRs alone does not change a running 3x-ui/API process.

## CI evidence

- Windows frontend regression suite on a validated branch revision: **86/86 passed**.
- Windows native `cargo test --release` on that revision: **44/44 passed**, including synthetic Xray transport configs.
- Backend Python tests and quality checks run through GitHub Actions on PR #86; see the final PR status for the latest commit.
- Installer packaging and live traffic acceptance are separate gates. Successful CI is not an egress or leak test.

## Reproducibility and change scope

All changes are pushed through GitHub commits in PR #16 (Windows) and PR #86 (backend). Source modifications are in the application/transport builder, native read-only TUN health module, Tauri command, source-owned compatibility selection and subscription URI parser. There are no hardcoded production IPs, UUIDs, short IDs or passwords.
