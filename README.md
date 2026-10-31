# ByMeVPN for Windows

A Windows desktop client for the ByMeVPN service, built with **Tauri 2**, **Rust**, and a lightweight HTML/CSS/JavaScript interface.

> **Status:** Experimental, NOT production-ready. Xray launch and a fail-closed egress probe are implemented; real Windows routing, IPv4/IPv6/DNS leak behavior, elevated service isolation and crash recovery still require full end-to-end acceptance. Do not rely on this build for privacy until those tests pass.

## Requirements

- Windows 10/11 (x64)
- Rust stable and Microsoft C++ build tools
- WebView2 Runtime

Cargo downloads the Tauri dependencies during the build. The frontend is in `ui/`; the Windows-native application code is in `src-tauri/`.

## Development

Open the project in the repository and follow the Tauri 2 development workflow for the local Windows toolchain. The API endpoints are defined in `src-tauri/src/api_transport.rs`.

The current API server uses HTTP. Passwords and bearer tokens are not protected in transit, so authentication must remain blocked until verified HTTPS endpoints are available. Do not enter real account credentials into an unencrypted connection.

## Implementation status

A production VPN requires an integrity-checked Xray Windows runtime, its matching Wintun component, tunnel and route management, DNS handling, traffic validation, and reliable shutdown. The app must only report **Connected** after the tunnel and traffic checks pass.

See [`docs/UPSTREAM_AUDIT.md`](docs/UPSTREAM_AUDIT.md) and [`docs/STATUS.md`](docs/STATUS.md) for the verified API contract, parity notes, and remaining work.

## Security

Never commit passwords, API tokens, subscription URLs, or VPN keys. Store user credentials with Windows Credential Manager. Do not run unsigned driver installers or disable TLS verification.


## Release hardening status (2026-10-31)

- Live server and pricing information is loaded from the API; the UI no longer substitutes fictitious server lists.
- VPN `Connected` is not reported unless an external-IP verification succeeds. The process is monitored for early exit.
- Email/Telegram account flows are aligned with the matching backend PR `Brof14/ByMeVPN_bot#14`. Deploy the server first and provide a secure JWT_SECRET.
- Payment terms are validated against the server tariff catalog, and account deletion/device management endpoints intentionally report unavailable until implemented.
- Kill Switch and background/tray mode are disabled in the UI until properly implemented and tested.
- Release workflow creates **draft prereleases** only. A passing Rust unit test does not prove a working, leak-free VPN.

### Critical uncompleted work

Windows Service privilege separation, Wintun adapter and route inspection, IPv6/DNS leak prevention, sleep/resume recovery, reliable TUN health monitoring, auto updates/code signing, and actual account/payment/VPN acceptance with test credentials. A full production release must not be made until these pass.
