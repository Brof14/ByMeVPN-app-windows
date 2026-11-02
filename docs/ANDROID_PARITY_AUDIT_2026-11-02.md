# ByMeVPN Windows — Android parity and release audit

Date: 2026-11-02  
Reviewed Windows baseline: `e14f0be89f3e991acf249c37e9aef94907664edb`  
Android V2 baseline: `0a60135e1e89a03d094af174b55cb8e6c3a19f4e`  
Backend baseline: `17d02d175a740042bd31ab21f48f0cf8a66e2ebc`  

## Evaluation method and ratings

The initial code-based design evaluation is **5.5/10**, and feature/UI parity is approximately **4/10**. These subjective scores are **not** screenshot, usability lab or accessibility test results. They do not improve automatically to 10/10 when a CSS commit is merged.

The Android V2 source uses a subdued navy canvas (`#090F1D`), navy cards (`#121C2B`), mint (`#69D3BC`) and system typography, while Windows used cyan/neon-green, glows and mock content. The draft PR aligns the basic tokens and decreases glow, but authentic Android assets and frame-by-frame screenshot comparisons are still missing.

## Findings and actions

| Severity | Finding | Current fix / requirement |
|---|---|---|
| P0 | Pinned Xray v26.10.29 asset returns 404 and stops every fresh Windows CI/runtime assembly | PR updates to official v26.10.31 release, pins official ZIP SHA256 `2e04a9995a6f2ad1b28c0bb25c708ecb2695e43a1c9c7889c4b6ac2b48cf7a6a`, and embeds build-time executable SHA256 for runtime verification |
| P0 | Windows WebView/UI runs with `requireAdministrator` | Unresolved: separate ACL-protected privileged Windows Service + unprivileged frontend, and end-to-end service tests |
| P0 | Full IPv4/IPv6/DNS and Kill Switch network leak guarantees are untested; only IPv4 default route is explicitly configured | Unresolved: packet capture and verified routing/WFP policy on real Windows 10/11 with varying connections |
| P1 | Fake-looking neon UI differs from Android V2 | Android palette/tokens, toned-down components, focusable power controls; visual screenshot acceptance still needed |
| P1 | Account and server responses can arrive after logout, restoring stale state | Session epoch guards for async account and server requests |
| P1 | Login and registration can submit repeatedly while requests run | Auth busy state, disabled actions, server-confirmed user, input sanitization and retry on outage |
| P1 | Telegram polling can complete after modal closes, logging in a user who canceled | Generation-scoped polling, stop on cancellation, no stale callbacks |
| P1 | Connecting/Disconnecting and connection health are not exposed distinctly | Explicit UI phase and verified flag; suppress protection badge if status cannot be checked |
| P1 | Invalid/stale settings values, concurrent writes and unsupported flags cause inconsistent state | Schema/type validation, migration defaults, serialized writes, replace-style save |
| P1 | Account lacks Android-like shortcuts and refresh | Refresh, copy ID, application/advanced settings, sync when app regains focus |
| P1 | Static user/expiry/server examples can appear as actual data | Remove invented examples; load real server/account state |
| P1 | Advanced settings incorrectly claimed WFP DNS protection was already active | Clear unverified status and explanatory text; no Kill Switch claim |
| P1 | Language selection stripped legal hyperlinks by replacing a parent node's `textContent` | Translate individual spans/links and maintain clickable terms/privacy URLs |
| P1 | No desktop DNS provider selection despite Android settings storage | Validated provider list: Cloudflare, AdGuard, Google, applied to TUN config at next connection |
| P2 | Existing pricing matrix contained stale hardcoded server prices | Initialize empty catalog; only fill from validated API plans |
| P2 | Frontend tests blocked by failures downloading the VPN runtime | Independent Ubuntu Node/contract test job in addition to Windows Rust tests |
| P2 | Auto-connect setting was present in backend settings allowlist but not exposed to users | Opt-in toggle; connects only on restored, active entitlement |
| P2 | Google button visible though backend intentionally disables Google OIDC | Hidden until issuer, audience, signature and nonce verification are implemented |
| P2 | Manual subscription URL login falsely implies API account authorization | Hidden pending a real signed import/identity workflow |

## Android/Windows parity matrix

| Android V2 area | Windows draft status | Not yet accepted |
|---|---|---|
| Sign-in / Sign-up | Email and Telegram flows, error/retry and busy states | Live account tests, password recovery, complete source-asset visual parity |
| Home | Actual subscription, selected server and explicit phases | Real-time traffic counters, full connection state machine, exact Android visuals |
| Server selection | Real API nodes + automatic choice | Live multi-node failover, latency inside VPN rather than just TCP connect |
| Pricing / trial | Server catalog, limited device options, invoice-specific payments | Real YooKassa sandbox test, refund/auto-renewal and canceled-retry UX |
| Account / devices | Profile, renewal status, device counters, sync and shortcuts | Tested cross-device/account lifecycle and backend deletion support |
| Settings | RU direct traffic by default, auto-connect, RU/EN, ad-block | End-to-end localization of every dynamic status and tooltip |
| Advanced settings | Configurable DNS, honest WFP information | Real WFP Kill Switch, IPv6 leak policy and system routing rollback |
| Support | Telegram support entry point and FAQ | Accessible complete localization and legal document review |
| Platform behaviors | Native Rust/Tauri Xray/Wintun plus runtime signature check | Windows Service, tray, network wake/reconnect, signing and updater |

## Release acceptance (must pass before stable)

- [ ] Fresh Windows 10 and 11 x64 installation, standard account and UAC test
- [ ] Email/Telegram sign-in, registration, logout, expired JWT, offline refresh
- [ ] Real 3x-ui subscription and HWID 2/5/10 device limit
- [ ] DNS IPv4 and IPv6 leak tests under dual-stack, IPv6-only, VPN crash, sleep/resume, Wi-Fi change
- [ ] VPN connect/disconnect repeated 100 times, with proper adapter, DNS and route cleanup
- [ ] Kill Switch only enabled if proven to work and restore traffic on shutdown
- [ ] Signed NSIS/MSI and portable runtime artifact smoke test, all assets present
- [ ] Payment test invoices through YooKassa test mode, actual subscription and cancellation reconciliation
- [ ] Screenshots comparing Android UI and Windows UI at 900x620, 1366x768, 1920x1080 and DPI 100/150/200%
- [ ] Keyboard navigation, focus indicators, screen reader, RU/EN review for all screens
- [ ] Measured startup time, memory, CPU and bandwidth, no fake metrics

**Decision:** The draft PR is not eligible for stable release until these acceptance criteria are satisfied. CI is only a subset of the release gate.
