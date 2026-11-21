# ByMeVPN Windows — implementation status

**Updated:** 2026-11-21
**Source version:** `1.2.22`
**Android reference checked:** `Brof14/ByMeVPN-app` `b456c46926772cde4a122357309685cbb087a6fb`
**Release classification:** Experimental / **NOT production-ready**. The current source is newer than the existing GitHub draft and remains subject to the production release gate.

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
- The installer is **not Authenticode-signed** and was not launched. No real VPN session, internet/DNS/route test, or clean-machine install was run. This local artifact does not clear any release blocker below.

## Release blockers

1. No end-to-end Windows 10/11 acceptance for each protocol, IPv4/IPv6 routes, DNS behavior, actual egress, network handover, crash cleanup or sustained reconnects. The user has explicitly deferred real VPN connection testing.
2. Tauri UI still launches with `requireAdministrator`; least-privilege UI plus a signed privileged VPN service and authenticated IPC are not implemented. Do not remove the manifest requirement without that broker.
3. DNS/IPv6 leak protection and a fail-closed Windows kill switch are not proven. Current cleanup is best-effort application-owned route/DNS restoration.
4. Live Windows-to-Android latency, throughput, packet-loss and connection-time comparisons are not measured. Source behavior now uses protocol-outbound HTTPS probes for supported transports, but no claim of maximum speed, equivalent real-world performance, or uninterrupted service is established.
5. Authenticode-signed packages, clean-machine install/uninstall and rollback, Microsoft Store compliance, and staged production rollout are not complete.
6. Account, device-limit, trial, renewal and payment flows still require end-to-end acceptance against the intended backend and payment provider.

See [PRODUCTION_RELEASE_GATE.md](PRODUCTION_RELEASE_GATE.md) and [AUDIT_2026-11-15.md](AUDIT_2026-11-15.md) for the complete acceptance criteria. Passing CI or creating a GitHub artifact does not clear these blockers. Keep generated releases as drafts/prereleases until the gate is evidenced.
