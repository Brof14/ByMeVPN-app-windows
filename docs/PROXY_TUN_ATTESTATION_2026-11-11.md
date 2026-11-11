# Windows VPN: server-vs-TUN end-to-end attestation (2026-11-11)

## Why the old "connected" status was false

The former Windows app marked `verified = true` whenever a public IPv4 observed after enabling Xray differed from the public IPv4 measured before startup. A changing WAN IP, another VPN, a proxy or another network configuration can also produce this observation. Separately, `Get-NetRoute` proved only that a TUN route existed, not that Windows selected it.

Thus a live Xray process, live Wintun adapter, valid routes, DNS resolution and a changed IP could all coexist with broken or bypassed ByMeVPN traffic. Previous PRs #16–#18 did **not** prove real VPN connectivity.

## New, independent evidence

1. Generate an ephemeral, random authentication secret and reserve a random localhost port during each `vpn_start`. Add a `127.0.0.1`-only HTTP CONNECT inbound in the Xray config; route its tag **only** to the configured `proxy` outbound, before RU bypass/direct routes. No unauthenticated or LAN-exposed proxy is created.
2. For each HTTPS IPv4 checker, compare two requests to the **same provider**:
   - authenticated loopback HTTP CONNECT in Xray → chosen remote VPN server;
   - ordinary OS connection → expected Windows TUN.
   Only identical outputs which differ from a known baseline qualify for verification. Provider outage, failed server handshake, absent baseline, differing IPs and system-route failure are all separate, non-green outcomes.
3. Require the Windows TUN adapter to be up, default IPv4 routes installed **and effectively chosen by Windows** using `Find-NetRoute -RemoteIPAddress '9.9.9.9'`, and system DNS resolution successful.
4. The status watchdog (every 20 seconds) and manual diagnostic use the same server+TUN proof; if a routing bypass is observed, the child process is terminated and the server session revoked.
5. Report `proof`, `effective_ipv4`, route/DNS results without returning secrets or raw Xray logs to the WebView.

No actual user IP, UUID, Reality key, Hysteria password or token is hardcoded into the app. Existing `autoSystemWfpBlockLeak` settings are deliberately unchanged.

## Clean-code / TDD log

- Added Rust tests for authenticated inbound config, Xray syntax validation, and pure proxy/TUN path classification before implementing those functions.
- Added a pure Windows route parser/effective route selection test before changing the PowerShell probe; updated the read-only CLI diagnostic script.
- Replaced legacy frontend contracts that checked IP-only verification with behavior-driven attested-proxy/TUN contracts.
- Committed implementation in small units, reacted to CI failures and applied exact `rustfmt` changes instead of weakening CI.
- Verified **93/93 JS tests** and **52/52 Rust tests** on commit `802889acb287982b81099fb32cccb4ba49fb9703` (test jobs on GitHub Actions run `43000895696`). Installer packaging may still be underway.

## Critical limitations and user acceptance

This is a **draft test build**, not a proven VPN repair on a real Windows computer. A GitHub runner validates generated Xray configs but cannot reach the user's actual ByMeVPN subscription/3x-ui server or measure DNS leaks and post-connection browsing on their Windows adapter. Avoid merging/distributing as production-ready until the following is verified:

1. Install the draft PR's CI preview on a controlled Windows 10/11 computer. Do not use it as a reliable privacy tool until confirmed.
2. Connect; open **Диагностика соединения**. Check the new **Выбранный Windows маршрут IPv4** field and the **Свежий HTTPS-тест выхода** result.
3. Interpret `server_unreachable` as an unsuccessful authenticated HTTP CONNECT test (not definitive evidence of remote server outage), `tun_no_traffic` as an Xray proxy path that worked while the OS path did not, and `routing_bypass` as a mismatch between the two paths. Do not disable WFP leak blocking simply to make tests pass.
4. In a physical browser, test loading a real website through the tunnel, and verify DNS/IPv4/IPv6/WebRTC leak protection, disconnection/reconnection, network handover, suspend/resume, new-account login/trial and paid device limits.
5. If it still fails, supply the new diagnostic dialog text (no credentials) and redacted Xray error categories, plus whether the browser has usable Internet with the tunnel running. If necessary, use `scripts/diagnose-vpn.ps1` for route selection without changing system settings.

Potential remaining causes outside code-only proof include unreachable remote port, 3x-ui subscription parameters/expiration, interface binding conflicts, WFP DNS interference, another virtual adapter, and backend network restrictions; **none has been confirmed from the supplied screenshot**.

Upstream reference: https://xtls.github.io/en/config/inbounds/tun.html
