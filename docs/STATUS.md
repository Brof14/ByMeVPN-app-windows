# ByMeVPN Windows — implementation status

**Updated:** 2026-11-21
**Source version:** `1.2.23`
**Android reference checked:** `Brof14/ByMeVPN-app` `b456c46926772cde4a122357309685cbb087a6fb`
**Release classification:** Experimental / **NOT production-ready**. Tag `v1.2.22` has a GitHub draft prerelease with the EXE attached; it is not a public stable release. The 1.2.23 source has not been packaged into a signed installer. The candidate remains subject to the production release gate.

## Implemented and source-verified

- Tauri 2 + Rust client with Credential Manager-backed account tokens and asynchronous API calls.
- Email, Telegram and desktop Google authentication flows; trial eligibility checks; subscription, device, pricing and checkout screens. Production backend/payment behavior has not been fully revalidated from this build.
- Server catalog normalization and supported-protocol filtering. Supported server latency is measured by a short-lived Xray process through the configured protocol outbound, followed by real HTTPS requests through its authenticated loopback proxy. This includes VLESS transports and Hysteria2 over QUIC; it does not treat a TCP handshake as tunnel latency. Results (including failures) are cached for ten minutes by node and full config, run with at most two probe processes, and do not delay catalog delivery or VPN startup. Cloudflare and Google measurements are averaged when both succeed, matching Android's current latency signal.
- Distribution is now a single NSIS `.exe` installer plus SHA-256 checksum; MSI and portable ZIP are excluded. CI installs the package on its disposable runner, checks Xray/Wintun/database hashes at the app-relative path, then uninstalls it.
- Automatic selection chooses the fastest server with a successful protocol-outbound HTTPS measurement. If no valid measurement is available, the request leaves node selection to the backend; it does not label an unmeasured first server as fastest. A single alternate is tried only when the selected server's preflight is unreachable, not for system-route or probe failures. The actual connected node is displayed after connection.
- Rust configuration generation/validation covers supported VLESS Reality/TCP/gRPC variants and Hysteria2 inputs. Synthetic parser checks do not establish real protocol interoperability.
- VLESS `mlkem768x25519plus` encryption is passed through to the bundled Xray core after bounded format/key validation; synthetic plain and padded profiles pass Xray config validation. Live server interoperability is unverified.
- Tunnel process monitoring, reconnect backoff, session cleanup and explicit verified/unverified connection states. These paths have not been validated through real Windows traffic in this release cycle.
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

## Release blockers

1. No end-to-end Windows 10/11 acceptance for each protocol, IPv4/IPv6 routes, DNS behavior, actual egress, network handover, crash cleanup or sustained reconnects. The user has explicitly deferred real VPN connection testing.
2. Tauri UI still launches with `requireAdministrator`; least-privilege UI plus a signed privileged VPN service and authenticated IPC are not implemented. Do not remove the manifest requirement without that broker.
3. DNS/IPv6 leak protection and a fail-closed Windows kill switch are not proven. Current cleanup is best-effort application-owned route/DNS restoration.
4. Live Windows-to-Android latency, throughput, packet-loss and connection-time comparisons are not measured. Source behavior now uses protocol-outbound HTTPS probes for supported transports, but no claim of maximum speed, equivalent real-world performance, or uninterrupted service is established.
5. Authenticode-signed packages, clean-machine install/uninstall and rollback, Microsoft Store compliance, and staged production rollout are not complete.
6. Account, device-limit, trial, renewal and payment flows still require end-to-end acceptance against the intended backend and payment provider.

See [PRODUCTION_RELEASE_GATE.md](PRODUCTION_RELEASE_GATE.md) and [AUDIT_2026-11-15.md](AUDIT_2026-11-15.md) for the complete acceptance criteria. Passing CI or creating a GitHub artifact does not clear these blockers. Keep generated releases as drafts/prereleases until the gate is evidenced.
