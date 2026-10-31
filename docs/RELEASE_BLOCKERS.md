# Windows release integration requirements

**Updated 2026-10-31.** This file replaces historical assumptions about a 1 ₽ trial and static 89 ₽/month payment flows.

## Server rollout

The matching backend PR is [Brof14/ByMeVPN_bot#14](https://github.com/Brof14/ByMeVPN_bot/pull/14).

- Configure a strong persistent `JWT_SECRET` (32+ characters) across workers **before** deploying. The public fallback key was removed. Existing tokens issued under that fallback require a new login.
- Canonical plans, gift durations and 2/5/10-device prices come from `constants.py` and `GET /plans`. The backend validates (rather than trusts) the client-supplied `amount_rub` and `days`.
- Free trial is 3 days at 0 ₽ and does not require a card. Trial provisioning is denied on reuse and must be confirmed by 3x-ui before showing activation.
- Telegram is a session-based login returning `authenticated`, not `approved`. Shared persistent login tickets are still needed for multi-worker deployment; the current in-memory storage is a release blocker.
- Google login cannot be enabled until real OIDC signature/audience/issuer checks and desktop PKCE are implemented.
- The device list and account deletion APIs intentionally report unavailable rather than returning fabricated success. These workflows still require implementation.
- Orders require webhook/provider confirmation, idempotency and ideally invoice-specific status. Active existing subscription status alone cannot prove a new payment.

## Windows desktop

- Tauri WebView must run without administrative privileges; isolate elevation in a Windows Service/helper with ACL-protected IPC.
- Xray and Wintun are hash-pinned, but actual network routing and traffic must be tested with a legitimate account on Windows.
- Full TUN lifecycle, IPv4/IPv6/DNS leak protection, proper Kill Switch, route rollback, network/sleep recovery, background tray, and installer cleanup are unverified.
- Hysteria2 requires a compatible, proven engine; hide/disable those servers until supported.
- Do not report `Connected` unless both the engine and traffic are verified; the current implementation checks process and exit IP, but does not yet validate all adapter/route/DNS invariants.
- Run UI QA at common DPI/resolutions, plus accessibility and RU/EN coverage.

## Release discipline

- CI includes frontend Node tests, Rust check and Rust unit tests, but these do **not** establish successful real tunneling.
- The `release.yml` workflow produces draft prereleases by default until a manual release-acceptance decision.
- See [STATUS.md](STATUS.md) and [Windows release gate #3](https://github.com/Brof14/ByMeVPN-app-windows/issues/3).
