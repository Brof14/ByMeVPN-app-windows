# ByMeVPN for Windows

A Windows desktop client for the ByMeVPN service, built with **Tauri 2**, **Rust**, and a lightweight HTML/CSS/JavaScript interface.

> **Status:** Experimental, NOT production-ready. Xray launch and a fail-closed egress probe are implemented; real Windows routing, IPv4/IPv6/DNS leak behavior, elevated service isolation and crash recovery still require full end-to-end acceptance. Do not rely on this build for privacy until those tests pass.

## Download installers (.exe / .msi)

The current source is built on Windows by GitHub Actions after frontend contract tests, Rust tests, and an MSI extraction check.

- **Direct .exe / .msi downloads:** [GitHub Releases](https://github.com/Brof14/ByMeVPN-app-windows/releases). Choose the newest **Windows Preview** release and its `ByMeVPN_*_x64-setup.exe` (normal installer) or `ByMeVPN_*_x64_en-US.msi` (managed deployment).
- **Builds for open pull requests:** [Actions → CI](https://github.com/Brof14/ByMeVPN-app-windows/actions/workflows/ci.yml). Open a successful run, then download the `ByMeVPN-Windows-Installers` artifact (GitHub downloads Actions artifacts as a ZIP).
- Verify downloaded files against the release's `SHA256SUMS.txt` (Windows: `Get-FileHash .\\YourInstaller.exe -Algorithm SHA256`).
- The bare `bymevpn.exe` from a development build **is not portable**; it requires the bundled Xray/Wintun runtime. Download an installer, not a bare executable.

**Security disclaimer:** Windows preview builds are not yet certified as leak-free or production-ready. The application still runs with administrator privileges and lacks a verified kernel-level Kill Switch. CI verifies packaging, not actual Windows VPN routing, DNS/IPv6 leak protection or real billing. Unsigned builds can trigger SmartScreen warnings; do not disable Windows security settings to bypass them.

The previously published `v1.2.0` installers (October 30, 2026) predate major Android-parity fixes and advertise unsupported security guarantees. Use newer verified-preview CI builds for evaluation, and do not interpret 'preview' as a security certification.

## Requirements

- Windows 10/11 (x64)
- Rust stable and Microsoft C++ build tools
- WebView2 Runtime

Cargo downloads the Tauri dependencies during the build. The frontend is in `ui/`; the Windows-native application code is in `src-tauri/`.

## Development

Open the project in the repository and follow the Tauri 2 development workflow for the local Windows toolchain. The API endpoints are defined in `src-tauri/src/api_transport.rs`.

The desktop API transport requires HTTPS and uses Rustls. For a production deployment, confirm that the configured host has a valid certificate, that the app is connected to the correct backend, and that JWT signing secrets are correctly configured. Do not disable TLS certificate verification.

## Implementation status

A production VPN requires an integrity-checked Xray Windows runtime, its matching Wintun component, tunnel and route management, DNS handling, traffic validation, and reliable shutdown. The app must only report **Connected** after the tunnel and traffic checks pass.

See [`docs/UPSTREAM_AUDIT.md`](docs/UPSTREAM_AUDIT.md) and [`docs/STATUS.md`](docs/STATUS.md) for the verified API contract, parity notes, and remaining work.

For the current Android-to-Windows behavior/design comparison, source-level fixes and remaining release gates, see [`docs/ANDROID_WINDOWS_DELTA_2026-11-06.md`](docs/ANDROID_WINDOWS_DELTA_2026-11-06.md). The Windows build is still experimental, and Rust/Node CI does not establish real tunnel security or pixel-identical UI.

## Security

Never commit passwords, API tokens, subscription URLs, or VPN keys. Store user credentials with Windows Credential Manager. Do not run unsigned driver installers or disable TLS verification.


## Release hardening status (2026-11-02)

- Live server and pricing information is loaded from the API; the UI no longer substitutes fictitious server lists.
- VPN `Connected` is not reported unless an external-IP verification succeeds. The process is monitored for early exit.
- Email/Telegram account flows are aligned with the matching backend PR `Brof14/ByMeVPN_bot#14`. Deploy the server first and provide a secure JWT_SECRET.
- Payment terms are validated against the server tariff catalog, and account deletion/device management endpoints intentionally report unavailable until implemented.
- Kill Switch and background/tray mode are disabled in the UI until properly implemented and tested.
- Release workflow creates **draft prereleases** only. A passing Rust unit test does not prove a working, leak-free VPN.

### Critical uncompleted work

Windows Service privilege separation, Wintun adapter and route inspection, IPv6/DNS leak prevention, sleep/resume recovery, reliable TUN health monitoring, auto updates/code signing, and actual account/payment/VPN acceptance with test credentials. A full production release must not be made until these pass.


## Android V2 parity work (November 2, 2026)

The Android design source of truth is `Brof14/ByMeVPN-app` (main as of November 2, 2026). The current draft [Windows PR #5](https://github.com/Brof14/ByMeVPN-app-windows/pull/5) aligns its color tokens, account controls and basic connection state with Android.

- Windows uses the Android canvas `#090F1D`, surface `#121C2B` and mint `#69D3BC`. The exact Android V2 shield has been imported byte-for-byte, but pixel-perfect parity is **not yet verified** on a running Windows build.
- Email and Telegram state, connected/connecting/unverified UI, account synchronization and trial/payment controls must be tested against the live backend.
- Google login, background VPN and Kill Switch remain disabled/unavailable by design until securely implemented.
- Android's automatic connection preference is supported as an opt-in after account restoration in Windows; direct routing for supported Russian sites defaults to enabled.
- Optional DNS choice (Cloudflare, AdGuard, Google DNS) is validated and used when generating the next TUN configuration. It is not a claim of DNS leak-proofness.
- The official Xray **v26.10.31** archive is pinned to GitHub's published SHA-256. The build embeds the extracted executable's SHA-256 and checks it again before VPN launch. The previous v26.10.29 download URL returned HTTP 404.
- Tests include an independent Ubuntu frontend job and Windows Rust/TUN configuration checks. Green CI does not guarantee successful network tunneling.

See [Android parity audit and release gates](docs/ANDROID_PARITY_AUDIT_2026-11-02.md).


## Current engineering audit (2026-11-02)

The latest [second-pass audit](docs/SECOND_PASS_AUDIT_2026-11-02.md) covers Telegram login cancellation, native logout and Xray shutdown, continuous connection-health checks, true HWID current-device flags, live subscription states, safer RU/EN UI and the release-gate checklist. The main app now refuses to invent VPN or login results when the Tauri bridge is unavailable. Account/subscription details are backend-owned; personal Windows settings currently remain local and **do not sync** with Android.
