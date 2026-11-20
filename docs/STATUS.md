# ByMeVPN Windows — implementation status

**Updated:** 2026-11-20
**Source version:** `1.2.21`
**Release classification:** Experimental / **NOT production-ready**. The current source is newer than the existing GitHub draft and remains subject to the production release gate.

## Implemented and source-verified

- Tauri 2 + Rust client with Credential Manager-backed account tokens and asynchronous API calls.
- Email, Telegram and desktop Google authentication flows; trial eligibility checks; subscription, device, pricing and checkout screens. Production backend/payment behavior has not been fully revalidated from this build.
- Server catalog normalization and supported-protocol filtering. TCP protocols use bounded TCP reachability checks; Hysteria2 uses a short-lived Xray outbound and a real HTTPS request over QUIC. Both results are cached for ten minutes by node and full config. Hysteria HTTPS timing and TCP handshake time are different measures and are not mixed for automatic ranking.
- Distribution is now a single NSIS `.exe` installer plus SHA-256 checksum; MSI and portable ZIP are excluded. CI installs the package on its disposable runner, checks Xray/Wintun/database hashes at the app-relative path, then uninstalls it.
- With a fresh catalog, automatic selection follows Android's strategy: choose the fastest measured Reality server, otherwise the fastest measured TCP server, then fall back to a Reality server or the first supported one. A stale catalog leaves selection to the backend. The actual connected node is displayed after connection.
- Rust configuration generation/validation covers supported VLESS Reality/TCP/gRPC variants and Hysteria2 inputs. Synthetic parser checks do not establish real protocol interoperability.
- Tunnel process monitoring, reconnect backoff, session cleanup and explicit verified/unverified connection states. These paths have not been validated through real Windows traffic in this release cycle.
- RU/EN interface, responsive desktop screens, settings, account/device flows and Android-aligned pricing/subscription states. Visual and accessibility parity has not been comprehensively measured against Android.

## Release blockers

1. No end-to-end Windows 10/11 acceptance for each protocol, IPv4/IPv6 routes, DNS behavior, actual egress, network handover, crash cleanup or sustained reconnects. The user has explicitly deferred real VPN connection testing.
2. Tauri UI still launches with `requireAdministrator`; least-privilege UI plus a signed privileged VPN service and authenticated IPC are not implemented. Do not remove the manifest requirement without that broker.
3. DNS/IPv6 leak protection and a fail-closed Windows kill switch are not proven. Current cleanup is best-effort application-owned route/DNS restoration.
4. Android-equivalent per-outbound latency is still incomplete for TCP protocols; those show TCP handshake time. Hysteria2 uses a real HTTPS-over-QUIC request. No throughput comparison or connection-speed superiority is established.
5. Authenticode-signed packages, clean-machine install/uninstall and rollback, Microsoft Store compliance, and staged production rollout are not complete.
6. Account, device-limit, trial, renewal and payment flows still require end-to-end acceptance against the intended backend and payment provider.

See [PRODUCTION_RELEASE_GATE.md](PRODUCTION_RELEASE_GATE.md) and [AUDIT_2026-11-15.md](AUDIT_2026-11-15.md) for the complete acceptance criteria. Passing CI or creating a GitHub artifact does not clear these blockers. Keep generated releases as drafts/prereleases until the gate is evidenced.
