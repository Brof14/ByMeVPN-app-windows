# ByMeVPN Windows — implementation status

**Updated:** 2026-11-15
**Starting app version:** `1.2.11`; follow-up connection reliability patch is `1.2.13` (the supplied audit describes `1.2.8`)
**Development branch:** `codex/windows-trial-eligibility-runtime-pin`
**Release classification:** Experimental / NOT production-ready.

## Verified in source and automated tests

- Tauri 2 + Rust desktop UI, Windows Credential Manager-backed tokens and HTTPS API transport.
- Login/register, Telegram session create/check; the Windows parser recognizes the server's `authenticated` status.
- Server DTO normalization from `node_code`, `display_name`, `config.server`, flag/country; parallel TCP reachability probes; unsupported protocols disabled.
- Tariffs come from `/plans`, including 2/5/10-device variants and promotional days. Checkout is disabled without a valid server catalogue.
- Payment request forwards canonical price/days and the **server PR** rejects mismatched terms. Browser return does not independently confirm a new payment.
- Xray configuration validation, pinned runtime SHA-256 check, serialization of connection requests and process-exit detection.
- Connection startup requires a real HTTPS response, Windows selecting the TUN route, DNS resolution and a live Xray process. An observed exit IP is required before the UI reports verified protection; a working path without that IP evidence stays explicitly unverified.
- If IP-check providers are unavailable, ordinary HTTPS traffic can be observed through both Xray and Windows TUN; the tunnel remains explicitly unverified unless the IP and route checks pass.
- Logout, manual disconnect and normal application exit use the same ByMeVPN-adapter-only route/DNS recovery path. This is best-effort process cleanup, not crash-proof service ownership.
- A failed server-catalog refresh retains a sanitized display-only last-known list; connection still requires a live API session.
- Automatic server-selection text now describes service assignment without claiming lowest latency.
- Unsupported device management and Kill Switch no longer claim to be operational. The tray can hide the current process, but no independent Windows service keeps VPN alive after the app exits.
- Node-based frontend syntax/contract tests and Rust checks are configured in CI.

## Critical outstanding release blockers

1. **No Windows network acceptance**: TUN adapter, route/dns lifecycle, IPv4/IPv6 leaks, gateway changes and crash recovery have not been measured end to end on a freshly installed Windows VM.
2. **Elevated UI architecture**: `build.rs` still uses `requireAdministrator` for the entire app. Production requires unprivileged Tauri UI and a narrowly privileged service/helper with secure IPC.
3. **Kill Switch / DNS / IPv6**: full leak-proof behavior and a user-controllable WFP policy are not implemented and verified.
4. **Tray and startup**: a true system background service is not integrated.
5. **Hysteria2**: configuration conversion exists for the pinned Windows Xray runtime, but real Hysteria2 network acceptance has not been run; support is not yet production-verified.
6. **Google sign-in**: safely unavailable until server-side OIDC verification and Windows PKCE login exist.
7. **Account lifecycle**: devices, device revocation, and account erasure are not real API workflows yet. The API PR makes unsupported operations return explicit errors.
8. **Secure deployment**: API requires a strong persistent `JWT_SECRET` environment variable. Old default-signed tokens must be invalidated. Deployment requires a coordinated rollout of both PRs.
9. **Invoices and recurring payments**: current `/payment/check` is entitlement-level; true invoice-specific webhook reconciliation, refunds and recurring control must be verified.
10. **Release engineering**: verified code signing, installer/uninstaller route restoration, updater rollback and real Windows 10/11 DPI tests are incomplete.

## Release gate

Do not merge or publish as stable simply because CI passed. Acceptance requires successful traffic and leak tests, real test-account login, trial/payment flows, reboots, process crashes and cleanup on a Windows 10/11 machine. Public `v1.2.0` predates the hardening PR. Future generated releases are draft/prerelease by default.

The actionable tracker is [Windows issue #3](https://github.com/Brof14/ByMeVPN-app-windows/issues/3) and [backend issue #15](https://github.com/Brof14/ByMeVPN_bot/issues/15).
