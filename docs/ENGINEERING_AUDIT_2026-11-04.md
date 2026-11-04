# ByMeVPN Windows — инженерный аудит и устранение ошибок

**Дата:** 2026-11-04  
**Windows baseline:** `fa3ac9d88add0badca358c2da194f5755d1e6a9c` (main before PR #8)  
**Android baseline:** `d987b9af700ebcb8f6c4e0572554defede903688` (Jetpack Compose `app/`, not old Flutter/demo trees)

Scope: repository-level review of release CI, Tauri runtime discovery, Rust tunnel, frontend state machine, HTML semantics, Android APIs/theme. Static audits and CI are **not** substitutes for Windows network/device acceptance or pixel-by-pixel screenshot comparison.

## 1. Critical diagnosis: installed .exe cannot find Xray/Wintun

**P0 — Fixed in PR #8, Windows acceptance pending.**

- Source: `src-tauri/tauri.conf.json` used the resource list `../vendor/runtime/windows-x64/**/*`. Tauri v2 rewrites parent segments `../` as `_up_` in the installed resource directory.
- Source: `service::get_runtime_dir` probed `vendor/runtime/windows-x64`, `runtime/windows-x64` etc., but did not probe `_up_/vendor/runtime/windows-x64`. Thus the installer could contain the correct verified binaries while the runtime could never find them.
- Existing `scripts/smoke-msi.ps1` asserted the presence and SHA-256 of the binary **anywhere** in an MSI extraction, not its location relative to installed `bymevpn.exe`; this is why green CI did not catch the issue.
- Fix: use explicit Tauri source-to-destination resource directory map; prefer canonical resource location; accept legacy `_up_` layout; preserve SHA verification; check actual expected MSI install paths plus hashes; run smoke test in both CI and release.
- Distinguish *missing* from *damaged* runtime; do **not** download or execute unverified binaries on user machines.
- **Pending:** prove an NSIS installation on Windows 10/11 and a live connection. The existing user-downloaded .exe is immutable and must be replaced by a new installer.

Official Tauri path reference: https://v2.tauri.app/develop/resources/

## 2. Feature parity against the live Android source

| Product area | Confirmed common behavior | Status / remaining gap |
| --- | --- | --- |
| Brand and palette | Windows uses Android V2 canvas `#090F1D`, surfaces `#121C2B`, mint `#69D3BC`; same transparent shield asset | **Partial**, no screenshot matching or complete component parity |
| Navigation | Home / Settings / Account; Windows has desktop sidebar | Fixed Windows Home wording; layout intentionally adapts to width |
| Authentication | Email, Telegram create/check session, session recovery | Live multi-device tests pending; Google disabled pending secure OIDC |
| Subscription | Backend `/subscription/status`, `/mobile/v2/plans`, `/subscription/trial` | Unknown access now renders a retry state instead of clickable active VPN; stale/inactive flows need live QA |
| Servers | Backend `/servers`, `/vpn/session` and explicit unsupported protocol handling | Not all Android-compatible engine protocols work on Windows; country/latency real-world QA pending |
| Payment | Invoice-scoped `/mobile/v2/payment/create` and `/mobile/v2/payment/check` | Provider sandbox/live webhook acceptance pending; don't trust client claims |
| Devices | Device counts and details originate from backend | Some server endpoints can report unavailable; no fabricated removal success |
| Settings | RU direct bypass defaults enabled; DNS and language controls | OS-specific settings, no cross-platform settings sync |
| Security | Verified executable hashes; UI checks actual exit IP before calling connected | **Not** sufficient for leak-proofness, failover, kill switch or adapter routing correctness |
| Accessibility | Native buttons and additional role/button keyboard handling for desktop cards | Screen reader, focus-order and DPI testing incomplete |

## 3. Remaining risk register

### P0 — release blockers

1. **Elevated WebView:** `src-tauri/build.rs` requests `requireAdministrator`. A VPN needs privileged native networking, but WebView and account/payment UI should not share those privileges. Split into unprivileged UI + signed Windows Service/helper with authenticated ACL-protected IPC.
2. **Real tunnel/privacy behavior unverified:** IPv4/IPv6 and DNS routing, Windows adapter changes, fallback, power/sleep/network changes, process crashes, firewall/WFP and route rollback need verification. `tun_config.rs` currently configures explicit IPv4 `0.0.0.0/0` routing, not an accepted dual-stack leak-proof solution.
3. **Installer trust:** unsigned .exe/MSI plus no tested code-signing/upgrade/uninstall/safe rollback acceptance; test clean Windows machines with standard users.
4. **Backend integration:** live authenticated entitlement and server provisioning, payment-provider webhook lifecycle, device enforcement and cancellation must pass end-to-end tests before a stable release.

### P1 — high-priority product gaps

5. **UI is not yet visually 1:1:** Android Jetpack Compose and Windows HTML/CSS use different layouts, spacing and component geometry. Existing matching assets/tokens are not screenshot-level parity; desktop should preserve platform usability while matching the same design system.
6. **Incorrect unknown-access state:** prior Windows `updateVpnUi()` treated `unknown` as a valid subscription, displaying connect controls even though native code rejected it. PR #8 uses a distinct retry state.
7. **Keyboard reachability:** clickable div cards lacked keyboard semantics. PR #8 adds roles, tab stops and Enter/Space activation; assistive-tech acceptance still pending.
8. **Misleading placeholders:** static Germany/Frankfurt and no-advertising wording on the home screen were removed; UI should never depict mock data as a real server.
9. **Protocol parity:** Windows `tun_config.rs` explicitly accepts VLESS Reality over TCP/raw; Android's native engine supports more cases. Present unsupported nodes as unsupported, not selectable/working.
10. **Reliability and speed:** no measured startup/CPU/RAM latency baseline, no 100-cycle connect/disconnect stress test, no quantified performance budget; do not claim zero lags from source inspection.
11. **Feature gaps:** verified kernel kill switch, background service/tray, password reset, seamless updater and real cross-device settings sync are incomplete or disabled.

## 4. Tests and acceptance

### Automated
- Node syntax and frontend contract regression tests
- Rust `cargo check` and unit tests
- Windows NSIS/MSI build
- MSI administrative extraction with **installed executable-relative runtime path** and SHA-256 verification
- Production no-Tauri fake-data prevention, strict pricing and real backend state semantics

### Required before marking release stable
- [ ] NSIS `.exe` and MSI installation on clean Windows 10 and 11 x64
- [ ] launch installed app and successfully verify Xray/Wintun
- [ ] connect/disconnect using a legitimate ByMeVPN account and real server
- [ ] 100 connect/disconnect cycles, Wi-Fi changes, sleep/wake, concurrent launch
- [ ] DNS, IPv4 and IPv6 leak testing and verified route restoration after crash
- [ ] standard-user and UAC Windows Service security review
- [ ] exact UI screenshot and interaction comparisons against Android screens at 100%, 150%, 200% DPI
- [ ] complete account, trial, billing, renewal, devices, Telegram and localization user journeys
- [ ] measure real launch time, CPU, RAM and connection latency
- [ ] trusted signature, update, rollback and uninstall testing

**Release decision:** PR #8 fixes a reproducible source-level packaging mismatch and several UI contracts. Do not label the Windows VPN production-ready based on static audits or green CI alone.
