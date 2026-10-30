# ByMeVPN for Windows

Windows desktop client based on the public ByMeVPN Android and Telegram bot repositories.

## Current status

This is an in-progress Windows client. The desktop UI and source contract are being built from the checked-out upstream sources. A production VPN requires a valid ByMeVPN account/API entitlement and an installed, integrity-checked Xray Windows runtime with its matching Wintun component. The app must report connected only after the tunnel and traffic checks succeed.

## Development

- Windows 10/11 x64
- Rust stable and the Microsoft C++ build tools
- WebView2 Runtime
- Tauri v2 Rust dependencies (Cargo fetches them)

API addresses are defined together in `src-tauri/src/api_transport.rs`. The current server uses HTTP, so passwords and bearer tokens are not protected in transit. Change both configured URLs to the verified HTTPS endpoints when available. The fallback is attempted only when a connection cannot be established; requests are not retried after an HTTP response or an ambiguous delivery failure.

The frontend is plain HTML/CSS/JavaScript in `ui/`; no Node package manager is needed. The Windows-native shell lives in `src-tauri/`.

See [`docs/UPSTREAM_AUDIT.md`](docs/UPSTREAM_AUDIT.md) and [`docs/STATUS.md`](docs/STATUS.md) for the verified API contract, parity map, and remaining implementation gates.

## Secrets

Never put passwords, API tokens, subscription links, or VPN keys in source control or chat. Windows credentials belong in Windows Credential Manager. Do not run an unsigned driver installer or disable TLS validation. HTTP does not protect credentials in transit, even when the server hashes passwords and signs tokens.
