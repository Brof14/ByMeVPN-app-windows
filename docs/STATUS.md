# ByMeVPN Windows — implementation status

**Updated:** 2026-11-21
**Source version:** `1.2.25`
**Android reference checked:** `Brof14/ByMeVPN-app` `b456c46926772cde4a122357309685cbb087a6fb`
**Release classification:** Experimental / **NOT production-ready**. Tag `v1.2.25` is published as a GitHub prerelease with the unsigned EXE and checksum attached; it is not a public stable release. The candidate remains subject to the production release gate.

## Implemented and source-verified

- Tauri 2 + Rust client with Credential Manager-backed account tokens and asynchronous API calls.
- Email, Telegram and desktop Google authentication flows; trial eligibility checks; subscription, device, pricing and checkout screens. Production backend/payment behavior has not been fully revalidated from this build.
- Server catalog normalization and supported-protocol filtering. Supported server latency is measured by a short-lived Xray process through the configured protocol outbound, followed by real HTTPS requests through its authenticated loopback proxy. This includes VLESS transports and Hysteria2 over QUIC; it does not treat a TCP handshake as tunnel latency. Successful results are cached for ten minutes and failures for 60 seconds by node and full config, run with at most two probe processes, and do not delay catalog delivery or VPN startup. Cloudflare and Google measurements are averaged when both succeed, matching Android's current latency signal.
- Distribution is now a single NSIS `.exe` installer plus SHA-256 checksum; MSI and portable ZIP are excluded. CI installs the package on its disposable runner, checks Xray/Wintun/database hashes at the app-relative path, then uninstalls it.
- Automatic selection chooses the fastest server with a successful protocol-outbound HTTPS measurement. If no valid measurement is available, the request leaves node selection to the backend; it does not label an unmeasured first server as fastest. Up to two explicit catalog alternates are tried for server-reachability or preflight-listener failures, including when every latency probe failed; unmeasured candidates prefer VLESS Reality, then VLESS, then Hysteria2. `probe_unavailable` and system-route failures are not retried. The actual connected node is displayed after connection.
- Rust configuration generation/validation covers supported VLESS Reality/TCP/gRPC variants and Hysteria2 inputs. Synthetic parser checks do not establish real protocol interoperability.
- VLESS `mlkem768x25519plus` encryption is passed through to the bundled Xray core after bounded format/key validation; synthetic plain and padded profiles pass Xray config validation. Live server interoperability is unverified.
- Tunnel process monitoring, reconnect backoff, session cleanup and explicit verified/unverified connection states. Preflight and TUN failures append a sanitized cause parsed from `xray_startup.log` plus the local journal path; raw log lines, hosts, UUIDs and tokens are not returned to the WebView. These paths have not been validated through real Windows traffic in this release cycle.
- RU/EN interface, responsive desktop screens, settings, account/device flows and Android-aligned pricing/subscription states. Visual and accessibility parity has not been comprehensively measured against Android.
- Desktop windows use persistent left navigation, a full-width work area, a two-column connection view on wide screens, a centered searchable server picker, and a balanced sign-in layout; narrower windows retain the compact arrangement. Server measurement explains that it checks internet delay through each server without requiring an active VPN. Colors, text and product flows remain Android-aligned. A screenshot-based visual comparison is still pending.
- Server-list loading coalesces concurrent requests and retries transient empty/error results at bounded delays, scoped to the same signed-in account and entitlement.
- The home recovery panel follows Android's unknown/inactive/trial-used states and offers Telegram account recovery where eligible; its loading state is reflected accessibly while sign-in starts.

## Local 1.2.22 candidate

- Frontend contract suite passed; release-mode Rust suite passed **77/77**. Rust formatting, JavaScript syntax and `git diff --check` passed.
- Built `ByMeVPN_1.2.22_x64-setup.exe` (16,214,284 bytes) under `src-tauri/target/release-artifacts-v1.2.22-github-candidate-2026-11-21/`. SHA-256: `e48f6fde19e4aa7f841818ee98da85fe1925f016ce632ef4cccffba9cf021124`.
- GitHub Actions run [44883989247](https://github.com/Brof14/ByMeVPN-app-windows/actions/runs/44883989247) completed successfully: 77 Rust tests, release build, NSIS install/runtime-hash/uninstall smoke check, and upload all passed. The draft [v1.2.22 release](https://github.com/Brof14/ByMeVPN-app-windows/releases/tag/untagged-2596f65f514fe051ff92) contains `ByMeVPN_1.2.22_x64-setup.exe` (16,223,133 bytes) and `SHA256SUMS.txt`; CI installer SHA-256: `41cc13c4324956f656f1ed86553fe5d8b274387df6ff01dc900a8b7c0f72e52c`.
- The local installer is **not Authenticode-signed** and was not launched. CI's disposable-runner smoke test checked install/uninstall and packaged runtime hashes only; no real VPN session, internet/DNS/route test, or release-owner acceptance was run. This does not clear the release blockers below.

## 1.2.23 desktop, authentication and interaction pass (2026-11-21)

Source-only changes; no live VPN, account, route, DNS or installer action was performed in this workspace.

- **Desktop window** opens at 1080×720 logical pixels, still capped to 70% of the monitor work area. The two-column Home layout now activates from 1060 CSS pixels, so the default window reaches the workstation layout on a 1920-wide monitor instead of staying in a tablet-width column. Small monitors keep the existing compact arrangement.
- **Server latency updates** no longer rebuild the complete server catalog and the full VPN UI for every probe result. A latency event patches only its own row, and remaining UI work is coalesced into one animation frame. The server search query is stored in state and survives latency updates, language changes and catalog refreshes.
- **Account refreshes** are single-flight for a session: startup, window focus, subscription expiry and the retry button share one native request instead of racing device-list generations. Switching accounts also drops the previous account's cached server catalog.
- **Authentication UI** now renders inline field errors (email, password, confirmation and a form-level server error) that clear as the field is corrected; the session-recovery panel and its retry button are actually shown after a failed restore. The password eye control keeps its SVG instead of replacing it with a platform emoji. The login/registration slogan is mode-specific instead of showing both lines, and the registration Telegram action is a full-width secondary button rather than an unstyled link.
- **Checks:** `node --check ui/app.js` and the full Node suite passed — 155 tests, including six new behavior/contract tests for search preservation, per-row latency updates, single-flight refreshes, inline auth errors and bounded auth icons. The login, registration, Home and server-picker screens were rendered in a browser against the current CSS at a 1100 px desktop viewport (fake Tauri bridge; no real API). Rust was not recompiled locally because this workspace has no Rust/Windows toolchain; the Windows CI job runs `cargo test` and the NSIS build after this branch is pushed.
- **Not verified:** a real tunnel, live sign-in, real server latency, DPI scaling on Windows, and installer packaging. Render measurements in a Linux Chromium instance do not prove Windows WebView2 behaviour.

## 1.2.24 sign-in layout and latency probing (2026-11-21)

Source and layout changes; no live VPN, account, route, DNS or installer action was performed in this workspace.

- **Desktop sign-in** is now one centered, Android-style column: brand and tagline above a 460 px form column. The previous two-column grid let the mark and the card drift to opposite corners on wide monitors (the skewed screen users reported). The column stays centered, and scrolls rather than clipping on short windows.
- **Server latency** probes now give Xray three seconds to open its authenticated loopback listener (was 1.2 s) and allow a 10 s per-server budget. On slower disks the old window closed before Xray was ready, so every row showed “could not measure” even for healthy servers.
- **Latency control** has a 30 s watchdog; a native probe that exits without a final event can no longer leave the “measure latency” button disabled forever.
- **Checks:** JavaScript syntax and the full Node contract suite pass. The sign-in and server-picker screens were rendered at desktop viewports against the current CSS (fake Tauri bridge; no live API). Rust was not compiled locally (no toolchain in this Linux workspace); CI runs `cargo check`, the Rust tests and the NSIS build after the tag is pushed.
- **Not verified:** a real tunnel, live sign-in, real server latency, Windows DPI scaling, installer packaging/signing.

## 1.2.25 automatic failover, connection diagnostics and connected latency (2026-11-21)

Source-only changes; no live VPN, account, route, DNS or installer action was performed in this workspace.

- **Automatic failover without a measured node.** Previously automatic mode only retried when a positive latency result had pinned a server. An unmeasured `auto` request therefore got exactly one backend-assigned attempt; a dead assignment surfaced as the reported dead end. The client now tries up to two explicit catalog candidates after a retryable server-reachability or preflight-listener failure, including when every latency probe failed, while still refusing to retry `probe_unavailable` or system-route failures. For unmeasured candidates it prefers VLESS Reality, then other VLESS, then Hysteria2; measured latency still wins.
- **Preflight resilience.** The no-TUN server preflight now waits 8 s for Xray's loopback listener, allows a 3 s connect/6 s request budget, and makes one bounded second HTTPS-probe round (10 s, then 5 s) after a 600 ms pause. Windows routes remain untouched until the server passes.
- **Actionable Xray diagnostics.** Preflight and TUN failures now append a fixed, sanitized cause parsed from the local `xray_startup.log` (connection refused, timeout, DNS, TLS certificate, Reality rejection, authentication, Wintun, routes, permissions or config rejection) plus the local journal path. Raw log lines, hosts, UUIDs and tokens are never returned to the WebView.
- **Connected latency.** A successful connection now measures real HTTPS latency through the verified tunnel, overlapped with route/DNS inspection, and refreshes it with the 20 s health probe. Server-list failures are cached for 60 s instead of 10 minutes, so a transient cold-start failure no longer blanks every row for the success TTL.
- **Android parity closed in this pass.** Opening Servers with no measurements automatically triggers the same protocol-outbound probe; the list shows Android's active/queued counter, latency colour thresholds (≤200 ms mint, ≤350 ms yellow, slower orange), the selected automatic server plus its measured ping, and a persistent “Could not connect / Try again” state with a retry CTA instead of only a toast.
- **Checks:** `node --check ui/app.js`, full Node suite **164/164**, and the focused Rust contract updates. Rust was not compiled locally (no toolchain in this Linux workspace); Windows CI runs `cargo check`, `cargo test`, formatting and the NSIS build after push.
- **CI and release:** commit `8d6e27fc2392ba40b4847748c647e9dbac7db8b1` passed [CI run 44931250503](https://github.com/Brof14/ByMeVPN-app-windows/actions/runs/44931250503) including `cargo check`, Rust tests and the NSIS build. [Release run 44931253412](https://github.com/Brof14/ByMeVPN-app-windows/actions/runs/44931253412) produced the installer; [v1.2.25](https://github.com/Brof14/ByMeVPN-app-windows/releases/tag/v1.2.25) is published as a prerelease with `ByMeVPN_1.2.25_x64-setup.exe` (16,230,903 bytes; SHA-256 `1470ad7c6c1896e25066ccd53c2fe0ee90fb167be840623004d1d0d2f2fbd56d`) and `SHA256SUMS.txt`. The installer is not Authenticode-signed.
- **Not verified:** a real tunnel, live sign-in, real server latency, Windows DPI scaling, installer signing/clean-machine install. The user's `server_unreachable` report could not be reproduced without the Windows Xray journal and a live session.

## Release blockers

1. No end-to-end Windows 10/11 acceptance for each protocol, IPv4/IPv6 routes, DNS behavior, actual egress, network handover, crash cleanup or sustained reconnects. The user has explicitly deferred real VPN connection testing.
2. Tauri UI still launches with `requireAdministrator`; least-privilege UI plus a signed privileged VPN service and authenticated IPC are not implemented. Do not remove the manifest requirement without that broker.
3. DNS/IPv6 leak protection and a fail-closed Windows kill switch are not proven. Current cleanup is best-effort application-owned route/DNS restoration.
4. Live Windows-to-Android latency, throughput, packet-loss and connection-time comparisons are not measured. Source behavior now uses protocol-outbound HTTPS probes for supported transports, but no claim of maximum speed, equivalent real-world performance, or uninterrupted service is established.
5. Authenticode-signed packages, clean-machine install/uninstall and rollback, Microsoft Store compliance, and staged production rollout are not complete.
6. Account, device-limit, trial, renewal and payment flows still require end-to-end acceptance against the intended backend and payment provider.

See [PRODUCTION_RELEASE_GATE.md](PRODUCTION_RELEASE_GATE.md) and [AUDIT_2026-11-15.md](AUDIT_2026-11-15.md) for the complete acceptance criteria. Passing CI or creating a GitHub artifact does not clear these blockers. Keep generated releases as drafts/prereleases until the gate is evidenced.
