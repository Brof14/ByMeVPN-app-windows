# ByMeVPN Windows — implementation status

**Updated:** 2026-11-21
**Source version:** `1.2.23`
**Android reference checked:** `Brof14/ByMeVPN-app` `b456c46926772cde4a122357309685cbb087a6fb`
**Release classification:** Experimental / **NOT production-ready**. `v1.2.23` is a draft prerelease. GitHub Actions completed its Rust/release build and isolated Windows service install/runtime/uninstall smoke; Authenticode signing, clean-machine user acceptance, and live VPN/network acceptance remain open.

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

## Privileged service work — 2026-11-21

- The desktop executable now embeds an `asInvoker` manifest. VPN startup, backend entitlement/session creation, Xray, route/DNS recovery, supervision and bounded reconnect are hosted in a separate LocalSystem Windows service. The service accepts bounded connection intent through a local named pipe, verifies the caller's SID/session, and disconnects that session on Windows logoff.
- The NSIS `.exe` is configured to install/start the service once during elevated per-machine installation, stop it before upgrades, and remove it on uninstall. The service refuses registration from outside Program Files. A CI smoke script checks installation, service state, packaged runtime hashes and removal, and is restricted to GitHub Actions.
- Focused local verification: `cargo fmt --check`, `cargo check --locked --bins`, one IPC validation unit test, release build of `bymevpn-service.exe`, full Node contract suite (157 passed), and Tauri NSIS installer build passed. The startup baseline-IP measurement now overlaps the no-TUN server preflight instead of delaying it sequentially. Latest `ByMeVPN_1.2.23_x64-setup.exe` is 17,228,160 bytes; SHA-256 `B99E5BB4DAE9861874425462E26530653CC16B7CD654824E5263D845CE42D924`. Installer, UI executable and service all report `NotSigned`.
- The local installer is unsigned and was not installed or launched. Hosted CI verified service install/start/state, bundled runtime hashes, and service removal on a disposable Windows runner. No VPN session, routes, DNS, proxy, or other VPN process was touched. The older GitHub `v1.2.22` draft predates this service build and does not include it.
- Source compilation is not operational acceptance: standard-user app launch, service IPC permissions, upgrade/uninstall, actual route/DNS/IPv4/IPv6/egress recovery, and all protocol behavior remain unverified on a clean Windows host.

## Local 1.2.23 service candidate

- Tauri built the versioned NSIS `.exe` with the service resource overlay. Hosted CI verified package inclusion and service install/start/uninstall hooks on its disposable Windows runner; this machine's installer was not installed or launched.
- `cargo check --locked --bins`, `cargo build --locked --release --bin bymevpn-service`, the focused IPC validation unit test (1 passed), Rust formatting, JavaScript syntax, PowerShell parser and `git diff --check` passed.
- Authenticode is absent from all three executable layers. The installer hash above applies to this local unsigned candidate; the CI-built artifact may have a different hash and must be recorded separately.
- No real connection was attempted, and no routes, DNS, proxy settings, adapter, app process or other VPN process were touched.

## Hosted v1.2.23 release check — 2026-11-21

- GitHub Actions run [44897301963](https://github.com/Brof14/ByMeVPN-app-windows/actions/runs/44897301963) completed successfully. It passed the full locked Rust test suite, release builds, NSIS packaging, and disposable Windows install/service-state/runtime-hash/uninstall smoke; artifact upload and the draft-release step also completed.
- The uploaded workflow artifact is `ByMeVPN-Windows-Build` (artifact ID `14704428181`, ZIP SHA-256 `428f63fe8e10346c80298d53f0e2e27f2be243e66d5bb80a4a441374c2cd516f`, expires 2026-12-21). The release workflow uses the Windows-runner build and checksum; the locally built unsigned installer hash above is a separate file and is not the hosted asset hash.
- Draft prerelease: [v1.2.23](https://github.com/Brof14/ByMeVPN-app-windows/releases/tag/v1.2.23). It is not a public stable release.
- CI did not launch the app or establish a VPN session. No live protocol/egress, DNS/IPv4/IPv6 leak, network handover, long-duration reconnect, standard-user first launch on a clean machine, or real-network recovery was tested. The other VPN process on the user's PC was not inspected or touched.

## Earlier 1.2.22 candidate (before privileged service)

- Frontend contract suite passed; release-mode Rust suite passed **77/77**. Rust formatting, JavaScript syntax and `git diff --check` passed.
- Built `ByMeVPN_1.2.22_x64-setup.exe` (16,214,284 bytes) under `src-tauri/target/release-artifacts-v1.2.22-github-candidate-2026-11-21/`. SHA-256: `e48f6fde19e4aa7f841818ee98da85fe1925f016ce632ef4cccffba9cf021124`.
- GitHub Actions run [44883989247](https://github.com/Brof14/ByMeVPN-app-windows/actions/runs/44883989247) completed successfully: 77 Rust tests, release build, NSIS install/runtime-hash/uninstall smoke check, and upload all passed. The draft [v1.2.22 release](https://github.com/Brof14/ByMeVPN-app-windows/releases/tag/untagged-2596f65f514fe051ff92) contains `ByMeVPN_1.2.22_x64-setup.exe` (16,223,133 bytes) and `SHA256SUMS.txt`; CI installer SHA-256: `41cc13c4324956f656f1ed86553fe5d8b274387df6ff01dc900a8b7c0f72e52c`.
- The local installer is **not Authenticode-signed** and was not launched. CI's disposable-runner smoke test checked install/uninstall and packaged runtime hashes only; no real VPN session, internet/DNS/route test, or release-owner acceptance was run. This does not clear the release blockers below.

## Release blockers

1. No end-to-end Windows 10/11 acceptance for each protocol, IPv4/IPv6 routes, DNS behavior, actual egress, network handover, crash cleanup or sustained reconnects. The user has explicitly deferred real VPN connection testing.
2. The least-privilege service and its installer lifecycle passed the hosted disposable-runner smoke, but clean-machine standard-user acceptance remains open; the service binary and installer also need Authenticode signing.
3. DNS/IPv6 leak protection and a fail-closed Windows kill switch are not proven. Service cleanup targets only the ByMeVPN adapter, but real restoration behavior remains unverified.
4. Live Windows-to-Android latency, throughput, packet-loss and connection-time comparisons are not measured. Source behavior now uses protocol-outbound HTTPS probes for supported transports, but no claim of maximum speed, equivalent real-world performance, or uninterrupted service is established.
5. Authenticode-signed packages, live clean-machine install/uninstall and rollback, Microsoft Store compliance, and staged production rollout are not complete.
6. Account, device-limit, trial, renewal and payment flows still require end-to-end acceptance against the intended backend and payment provider.

See [PRODUCTION_RELEASE_GATE.md](PRODUCTION_RELEASE_GATE.md) and [AUDIT_2026-11-15.md](AUDIT_2026-11-15.md) for the complete acceptance criteria. Passing CI or creating a GitHub artifact does not clear these blockers. Keep generated releases as drafts/prereleases until the gate is evidenced.
