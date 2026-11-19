# ByMeVPN Windows — implementation status

**Updated:** 2026-11-19
**Source version:** `1.2.19`
**Release classification:** Experimental / **NOT production-ready**. The existing `v1.2.18` GitHub draft does not contain this `1.2.19` source version.

## Implemented and source-verified

- Tauri 2 + Rust client with Credential Manager-backed account tokens and asynchronous API calls.
- Email, Telegram and desktop Google authentication flows; trial eligibility checks; subscription, device, pricing and checkout screens. Production backend/payment behavior has not been fully revalidated from this build.
- Server catalog normalization, supported-protocol filtering and bounded TCP reachability checks. Recent TCP results are cached in memory for ten minutes by node and full config; this is endpoint connection time, not VPN tunnel latency. Hysteria2 is excluded from TCP checks.
- Distribution is now a single NSIS `.exe` installer plus SHA-256 checksum; MSI and portable ZIP are excluded. CI installs the package on its disposable runner, checks Xray/Wintun/database hashes at the app-relative path, then uninstalls it.
- Automatic selection now shows the backend-assigned server after connection, matching the latest Android selection feedback where Windows has the same server name.
- Rust configuration generation/validation covers supported VLESS Reality/TCP/gRPC variants and Hysteria2 inputs. Synthetic parser checks do not establish real protocol interoperability.
- Tunnel process monitoring, reconnect backoff, session cleanup and explicit verified/unverified connection states. These paths have not been validated through real Windows traffic in this release cycle.
- RU/EN interface, responsive desktop screens, settings, account/device flows and Android-aligned pricing/subscription states. Visual and accessibility parity has not been comprehensively measured against Android.

## Release blockers

1. No end-to-end Windows 10/11 acceptance for each protocol, IPv4/IPv6 routes, DNS behavior, actual egress, network handover, crash cleanup or sustained reconnects. The user has explicitly deferred real VPN connection testing.
2. Tauri UI still launches with `requireAdministrator`; least-privilege UI plus a signed privileged VPN service and authenticated IPC are not implemented. Do not remove the manifest requirement without that broker.
3. DNS/IPv6 leak protection and a fail-closed Windows kill switch are not proven. Current cleanup is best-effort application-owned route/DNS restoration.
4. Actual Android-equivalent per-outbound VPN latency is not implemented. Windows' displayed server-list measurement is TCP endpoint reachability only; no throughput or connection-speed superiority is established.
5. Authenticode-signed packages, clean-machine install/uninstall and rollback, Microsoft Store compliance, and staged production rollout are not complete.
6. Account, device-limit, trial, renewal and payment flows still require end-to-end acceptance against the intended backend and payment provider.

See [PRODUCTION_RELEASE_GATE.md](PRODUCTION_RELEASE_GATE.md) and [AUDIT_2026-11-15.md](AUDIT_2026-11-15.md) for the complete acceptance criteria. Passing CI or creating a GitHub artifact does not clear these blockers. Keep generated releases as drafts/prereleases until the gate is evidenced.
