# ByMeVPN Windows — implementation status

**Updated:** 2026-10-31  
**Development branch:** `fix/windows-release-hardening-20261031`  
**Matching API branch:** `Brof14/ByMeVPN_bot:fix/server-security-entitlements-20261031`  
**Release classification:** Experimental / NOT production-ready.

## Verified in source and automated tests

- Tauri 2 + Rust desktop UI, Windows Credential Manager-backed tokens and HTTPS API transport.
- Login/register, Telegram session create/check; the Windows parser recognizes the server's `authenticated` status.
- Server DTO normalization from `node_code`, `display_name`, `config.server`, flag/country; parallel TCP reachability probes; unsupported protocols disabled.
- Tariffs come from `/plans`, including 2/5/10-device variants and promotional days. Checkout is disabled without a valid server catalogue.
- Payment request forwards canonical price/days and the **server PR** rejects mismatched terms. Browser return does not independently confirm a new payment.
- Xray configuration validation, pinned runtime SHA-256 check, serialization of connection requests and process-exit detection.
- Egress check before returning `Connected`; failure cleans up Xray/config and returns an error. This only confirms an observed exit address at that moment.
- Unsupported device management, kill switch and background/tray behavior no longer claim to be operational. Buttons are disabled or state clearly indicates unavailable.
- Node-based frontend syntax/contract tests and Rust checks are configured in CI.

## Critical outstanding release blockers

1. **No Windows network acceptance**: TUN adapter, route/dns lifecycle, IPv4/IPv6 leaks, gateway changes and crash recovery have not been measured end to end on a freshly installed Windows VM.
2. **Elevated UI architecture**: `build.rs` still uses `requireAdministrator` for the entire app. Production requires unprivileged Tauri UI and a narrowly privileged service/helper with secure IPC.
3. **Kill Switch / DNS / IPv6**: full leak-proof behavior and a user-controllable WFP policy are not implemented and verified.
4. **Tray and startup**: a true system background service is not integrated.
5. **Hysteria2**: not supported by the pinned Windows Xray configuration path; its nodes are intentionally disabled.
6. **Google sign-in**: safely unavailable until server-side OIDC verification and Windows PKCE login exist.
7. **Account lifecycle**: devices, device revocation, and account erasure are not real API workflows yet. The API PR makes unsupported operations return explicit errors.
8. **Secure deployment**: API requires a strong persistent `JWT_SECRET` environment variable. Old default-signed tokens must be invalidated. Deployment requires a coordinated rollout of both PRs.
9. **Invoices and recurring payments**: current `/payment/check` is entitlement-level; true invoice-specific webhook reconciliation, refunds and recurring control must be verified.
10. **Release engineering**: verified code signing, installer/uninstaller route restoration, updater rollback and real Windows 10/11 DPI tests are incomplete.

## Release gate

Do not merge or publish as stable simply because CI passed. Acceptance requires successful traffic and leak tests, real test-account login, trial/payment flows, reboots, process crashes and cleanup on a Windows 10/11 machine. Public `v1.2.0` predates the hardening PR. Future generated releases are draft/prerelease by default.

The actionable tracker is [Windows issue #3](https://github.com/Brof14/ByMeVPN-app-windows/issues/3) and [backend issue #15](https://github.com/Brof14/ByMeVPN_bot/issues/15).
