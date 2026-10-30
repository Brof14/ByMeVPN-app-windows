# ByMeVPN for Windows

A Windows desktop client for the ByMeVPN service, built with **Tauri 2**, **Rust**, and a lightweight HTML/CSS/JavaScript interface.

> **Status:** Work in progress. The interface and API contract are being developed. A working production VPN tunnel is not yet implemented.

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
