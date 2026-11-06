# Production release gate — Windows (2026-11-06)

**Current decision: NO-GO for paying customers.** Source-level fixes and passing CI, if achieved, do not demonstrate a secure working VPN on a Windows host. Do not publish a stable release or claim leak-free protection until all P0 gates are evidenced.

## Architecture gate (P0)

- [ ] UI and Tauri WebView launch with `asInvoker`, never with `requireAdministrator`.
- [ ] Install a dedicated, signed Windows VPN Service with elevated permissions **once during installation**. Service is the sole owner of Xray/Wintun, routes, DNS and WFP rules.
- [ ] Restrict IPC to verified user/session SIDs with named-pipe ACLs and impersonation or explicit OS-token identity checks. Never use world-writable pipes, plaintext files, command-line tokens or shell interpolation.
- [ ] Service independently authorizes each connect operation against live backend entitlements. UI cannot submit arbitrary executable paths, unvalidated raw Xray configs, routes or WFP commands.
- [ ] Handle simultaneous users, service restart/crash, Windows Update, uninstall and failure rollback. A UI crash must not leave an unprotected routing state; a service crash must fail closed or unmistakably report disconnection.
- [ ] Install and uninstall service/driver without permanent admin privileges for the UI. An occasional UAC during trusted installation or service repair is acceptable; repeated UAC at application launch is not.

The current app still requires Administrator on launch. **Do not flip the app manifest to asInvoker alone**: Wintun routing would then fail or silently degrade. A separately authenticated privileged broker must be implemented and tested first.

## Network correctness gate (P0)

For clean Windows 10 x64 and Windows 11 x64, both Wi-Fi and Ethernet, with IPv6 available and unavailable:

- [ ] Connect to **each supported protocol**, capture virtual adapter, IPv4/IPv6 routes, DNS server list and actual public IPv4/IPv6 egress, including queries to independent external resolvers.
- [ ] Prove that DNS is not sent outside the tunnel unless intentionally whitelisted, and that IPv6 never leaks to the original uplink.
- [ ] With Russian bypass enabled (the Android default), verify direct routing **only** for specified destinations. With it disabled, verify full-tunnel behavior. Treat bypass traffic as intentionally not protected by the VPN.
- [ ] Force-kill Xray, WebView and service individually; sever WAN, switch networks, sleep/resume, reboot, suspend during connect, and interrupt installation. Verify route/DNS/WFP cleanup and no orphan process.
- [ ] Test no route recursion for domain-name and IP-address VPN endpoints; verify endpoint resolution and reconnect.
- [ ] Validate Kill Switch only if it is enabled/shown to users; WFP must fail closed during transient outages and uninstall must remove rules safely.
- [ ] Require 100 connect/disconnect/reconnect/server-switch cycles and a 24-hour soak on real hardware/VM with evidence.

## Account/payment gates (P0)

- [ ] Email/Telegram/Google successful and aborted login, expired/refresh/revoked tokens; no secret exposed to WebView, CLI flags, installer, logs or screenshots.
- [ ] Trial eligibility and actual one-time 3-day provisioning against production-like backend.
- [ ] Plans and invoices for 2/5/10-device variants, checkout cancellation, YooKassa webhook confirmation, refunds, auto-renewal and device-limit enforcement.
- [ ] Session revocation on failed start, crash, disconnect and logout; no phantom paid entitlements.
- [ ] Installation with one Windows account must not leak credentials to another.

## UX and performance gates (P1)

Use matched Android screenshots as the baseline, but adapt navigation/controls to Windows; do not claim "pixel-perfect" without measured comparison. Exercise all screens at 800×590, 960×700 and 1920×1080 with DPI 100/150/200%, keyboard-only access, screen reader and RU/EN/System language.

Suggested acceptance targets, **not measured results**: cold start p95 under 2 s on a defined reference PC, idle CPU under 1%, memory under 150 MiB in idle UI, no increasing process/thread/handle count across 100 cycles. Publish actual measurements and hardware/network configuration. Measure connect p50/p95, throughput, packet loss and latency; compare the same test account and servers on Android and Windows.

## Distribution gate (P0)

- [ ] CI frontend and native tests green, MSI/NSIS install + uninstall smoke test green.
- [ ] Microsoft Authenticode-signed executables/installers with publicly verifiable certificate, verified Xray/Wintun provenance and pinned checksums; package manifest/resources tested.
- [ ] Clean machine installation and rollback, without disabling SmartScreen, UAC, Defender or AV.
- [ ] Controlled staged rollout, signed release notes, reproducible versioned release and support rollback path.
- [ ] Written approval from a named release owner, with actual test evidence attached.

Until the above are complete: **GitHub Actions releases are drafts/prereleases only.** Do not present the built package as stable, production-ready, secure, or equivalent to the Android VPN merely because it compiles.
