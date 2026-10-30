# Implementation status

## Update: 2026-10-29

- VLESS/Reality session validation and Xray TUN configuration generation are implemented in `src-tauri/src/tun_config.rs`, and a synthetic generated configuration passes the pinned Xray parser. The generator is not yet connected to `vpn_start`; IPv4/IPv6/DNS routing, administrative lifecycle, Hysteria2, and real traffic still need implementation and testing.
- The Windows autostart switch now reads and writes a dedicated per-user Run registry value only when the user operates it. Other settings remain unavailable. Parallel 401 responses are serialized to prevent simultaneous refresh requests from clearing a valid session.
- Login parsing accepts a null display name, consistent with Android; a test covers the email-derived display name. `tunnel_runtime.rs` checks the pinned Xray and Wintun executable hashes and rejects missing or modified files. Neither helper is yet integrated into the connection lifecycle.
- The owner approved public IP-check services. `egress.rs` contains an HTTPS, no-proxy check that compares the observed address with a supplied expected VPN-server IP; it is not yet wired into connection state and has not been exercised through a live tunnel.
- The server selection was changed to a dialog over the connection screen. A local mock session was used to check navigation and failure behavior, not real account or server data.
- A reference-led visual pass added a globe asset, rebuilt email sign-in/registration, adjusted the connection and settings layouts, and kept unfinished controls visibly unavailable. These are a work in progress; the full eight-screen set has not been matched or accepted against the supplied references.
- Official Xray v26.10.29 and Wintun 0.14.1 archives were downloaded and hash-verified, with Wintun's Windows signature validated; provenance is recorded in `vendor/README.md`. The binaries are not yet wired to a tunnel or installer.
- The current Windows upstream (`ade2b6f`) and newer mobile upstream (`f554a0d`) were inspected; see the update in `UPSTREAM_AUDIT.md`. The mobile API and payment flows have changed since the earlier audit.
- The owner confirmed that HTTP is currently the deployed API and requested its use. Both API addresses are configured in `src-tauri/src/api_transport.rs`, with connection-failure-only fallback. A read-only `/plans` request returned HTTP 200; the previous HTTPS endpoint failed its TLS handshake. The application warns that HTTP does not encrypt credentials. This does not validate authentication or payments.
- Refresh failures now preserve saved credentials for network, server, rate-limit and other non-authentication errors; rejected refresh credentials still clear the session. Tauri string errors are converted into JavaScript `Error` objects so the UI can show their messages.
- The VPN, current API integration, payment, Google sign-in and visual matching to the supplied screens remain incomplete and have not been accepted as production-ready.

Last updated: 2026-10-27

## Delivered in this working copy

- Repository audit and source provenance: [`UPSTREAM_AUDIT.md`](UPSTREAM_AUDIT.md).
- Cross-repository release integration requirements: [`RELEASE_BLOCKERS.md`](RELEASE_BLOCKERS.md).
- Tauri v2 desktop shell and initial screen set (welcome, sign-in, sign-up, connection, server chooser, account, tariffs, settings); visual parity remains incomplete.
- A front-end state model that distinguishes disconnected, connecting, connected, and error; the current VPN start command returns a clear unavailable-runtime error and never claims a live tunnel.
- Rust API layer for the documented authentication, server, account, subscription, trial, and token-refresh calls.
- Account screen device list and server-backed device unlink action.
- Server choice now has a true automatic mode; it recommends the API-listed server with the lowest reported ping and falls back deterministically when pings are absent. Manual choice stays explicit and persists across restarts while that server remains available.
- Welcome screen links directly to the working email-registration route; device-capacity visualization now uses API counts instead of a fixed mock.
- Registration confirms the password before sending it; Google login is visibly disabled until a Windows OAuth flow is configured.
- Temporary API failures now show “status unavailable” instead of falsely reporting no subscription; saved-session restore displays a persistent retry prompt when the API cannot be reached.
- Settings no longer show switches for unsupported features; pending Windows behaviors are labeled as in development.
- Added visible keyboard focus, selected-server accessibility state, reduced-motion support, and compact window breakpoints.
- Plan cards no longer infer a “best value” from API ordering; stale tariff responses are ignored after leaving the page, and trial/payment eligibility stays with the Telegram bot.
- Telegram entry follows the bot's `/start login` route; returned HTTPS subscription links are validated, fetched with certificate checks, and stored in Windows Credential Manager. The local profile is restored on next launch. Telegram profile/device/server management still needs the service API.
- The trial/purchase screen now reflects the bot's YooKassa offer (3 days for 1 ₽, then 89 ₽/month) and sends checkout to the bot, which enforces eligibility and confirms recurring terms before payment.
- External Telegram links open through a Windows command with an HTTPS host allowlist; app support links no longer depend on WebView pop-up behavior.
- Persistent install ID and Windows Credential Manager token storage design.
- API client with explicit timeouts, one refresh-and-retry path after HTTP 401, no token/request-body logging, and a warning for the currently configured unencrypted HTTP endpoint. HTTPS certificate validation is retained when HTTPS URLs are configured.

## Not implemented yet

- Real Xray process startup and `/vpn/session` consumption, Wintun setup, Windows route/DNS configuration, and rollback. The Telegram link is imported, but the Windows tunnel engine does not consume it yet.
- Windows autostart registration, auto-connect, effective routing preferences, Google OAuth callback/client setup, password recovery, and full Telegram account/device synchronization.
- In-app tariff selection and checkout. The bot source contains the YooKassa payment and activation flow; the desktop client opens that bot. Live payment confirmation was not tested.
- English localization beyond the selector label. The selector must not be treated as full localization.

## Still required for a releasable VPN

- A legitimate test account or documented test environment to validate auth, endpoint payloads, server selection, subscription entitlement, and device registration end-to-end.
- Package and pin a specific official Xray Windows release plus the matching Wintun DLL, verify upstream release checksums/signature/provenance, record licenses, and implement safe updates.
- Implement elevated TUN lifecycle, safe route/DNS restoration, IPv4 and IPv6 leak protection, and failure cleanup. The desktop shell must stay unprivileged for ordinary UI/API use; elevation should be isolated to tunnel operations.
- Implement reliable connected health checks (core running, adapter present, route/DNS state, successful tunneled probe), reconnect, disconnect and crash recovery.
- Implement Google OAuth callback/client setup only if the API owner confirms the Windows client ID and allowed redirect flow.
- Build and run on Windows with WebView2/VC build tools, then manually verify real traffic and recovery on the target PC. No such runtime acceptance has yet been claimed.

## Current environment constraints

Visual Studio Community 2026 with MSVC and Windows SDK is installed. The Windows app passes `cargo check` and starts with `cargo run`. No Xray/Wintun runtime or test account is available, so real VPN traffic and backend auth flows have not been verified. No administrator credential from chat is used or stored.

## Acceptance gates

1. Source and dependency audit: no secrets; TLS validation enabled; exact runtime binaries and licenses recorded.
2. Auth and account: sign up/in, token refresh, sign out, account status, device list/removal, trial eligibility.
3. VPN: session request → valid Xray config → adapter and routes up → traffic actually exits via selected server → RU bypass behavior matches setting → clean shutdown restores previous network state.
4. Failure handling: API timeout, expired entitlement, blocked device limit, bad server config, unreachable server, app/core crash, sleep/resume, network change, and UAC cancellation all leave an honest state and no stale route.
5. UI: all supplied screens at common DPI scales; keyboard navigation; RU/EN; loading, empty, error, and offline states. Source checks pass, but in-app visual runtime QA has not yet been performed.
