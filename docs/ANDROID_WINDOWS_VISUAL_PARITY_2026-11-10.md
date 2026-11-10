# Android → Windows visual parity — 10 November 2026

## Ground truth and scope
- Android main: `de61551ee710e9f34d6dd51420e1aba94314ed4d`, the **Jetpack Compose** implementation under `app/src/main/kotlin/com/example/bymevpn/`. Legacy Flutter `lib/`, images in `public/assets/aistudio/`, and the second `android/app/` tree are **not** production design sources.
- Windows: Tauri 2 WebView2 + native Rust Xray/Wintun. **No VPN engine replacement** in this visual PR.
- Target: Android's narrow, single-column mobile screen rather than a desktop 16:9 dashboard. First launch 480×720 logical pixels, clamped to **70% of each monitor work-area axis**. Users may resize. The smaller minimum height permits scroll on short displays.

## Execution log and reasons
1. Examined the Android `HomeScreen.kt`, `VpnPowerButton.kt`, `ByMeV2Components.kt`, `AccountScreen.kt`, `SettingsScreen.kt`, `PricingScreen.kt` and `ServerSelectionSheet.kt` plus existing Windows shell; found old desktop two-column markup and visual CSS overrides.
2. Added initial red tests specifying a shared mobile home dock, vector bottom nav and monitor cap before implementing the new code.
3. Added pure Rust initial-window sizing with two edge-case regression tests and a one-call Tauri setup hook. No system-wide window size constraints or admin privilege changes.
4. Replaced Home's old dashboard with Android's three states (unknown/no plan, off, on), one location/subscription dock, source shield PNG, 72dp bottom nav and mint/teal color tokens. Kept existing Tauri action IDs.
5. Rebuilt Account as one 51dp profile row, one subscription card (server-derived remaining days), one devices row, one settings row. Moved secondary management actions to a modal, retaining server-authoritative entitlements.
6. Rebuilt Settings as two switches, a language row and a single-choice RU/EN/System dialog. Windows-specific extra settings remain accessible through Account settings dialog, not on the Android-identical main screen.
7. Rebuilt Pricing as Android's 51dp device selector, 95dp stacked offer rows, verified-price summary and one YooKassa CTA. Do not show a purchase-ready button when server confirmation fails. Legal links remain accessible.
8. Made server picker a modal bottom sheet over Home instead of a dashboard tab; matches Android scrim, drag handle, auto card, location list and footer.
9. Kept prior accessibility bindings (Tab, Enter, dialogs), dynamic localized labels and server-backed prices; added a VM behavior test covering account state and payment gating.
10. Investigated CI failures, applied exact Rust formatter output, adapted superseded 3:2 and language tests to new user requests, and fixed a headless test harness regression.

## What's matched at source level
| Android authority | Windows implementation |
|---|---|
| `HomeScreen.kt` + `VpnPowerButton.kt` | `ui/index.html` mobile home and shared dock, `ui/mobile-parity.css`, `ui/app.js` |
| `ByMeV2Components.kt` | inline SVG bottom navigation and fixed 72dp bar |
| `AccountScreen.kt` | account/profile/plan rows and settings dialog |
| `SettingsScreen.kt` | 2 switches and language dialog |
| `PricingScreen.kt` | plan chooser, devices, dynamic pricing, checkout |
| `ServerSelectionSheet.kt` | overlay bottom sheet, auto selection and list |
| Android single-column dimensions | `src-tauri/src/window_layout.rs` |

## Not proven / release gates
- **Not pixel-perfect certified**: screenshots from Android Jetpack Compose and a built Windows WebView2 at 100%, 150%, 200% DPI have not been compared by visual diff. Fonts, text rasterization, OS window chrome and scroll behavior differ by platform.
- **Not complete screen-by-screen parity**: secondary Devices, Advanced, Renewal, Support, Welcome/Signup, paywall and error/empty states still need real screenshot review and selective mobile polish.
- **Not production acceptance**: actual VPN tunnel, DNS/IPv6 protection, Windows 10/11 clean install, restore/reconnect/suspend/resume, new-user authentication/trial/payment and leak tests require controlled Windows devices and server-side accounts. Existing Rust tests/CI are not substitutes.
- Verify window sizing on a small/large monitor, multi-monitor moves, high DPI and Windows taskbar work areas. The 70% cap is **initial size**, not a restriction on voluntary user resize.
- Keep draft PR until screenshots and live acceptance show it is safe to merge. Do not claim 100/100 or 1:1 before seeing the result.

## Operator validation
Open the latest PR Actions run, require frontend+Rust+installer successes, download the private CI build artifact, compare UI to Android for each screen/state, then run real VPN connection and DNS leak validation before exposing to paying clients.
