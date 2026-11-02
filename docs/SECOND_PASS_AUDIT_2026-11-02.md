# ByMeVPN Windows — second-pass engineering and Android V2 parity audit

**Audit date:** 2026-11-02  
**Reviewed main:** `e14f0be89f3e991acf249c37e9aef94907664edb`  
**Android main:** `0a60135e1e89a03d094af174b55cb8e6c3a19f4e`  
**Backend main:** `17d02d175a740042bd31ab21f48f0cf8a66e2ebc`  
**Implementation branch:** `fix/windows-android-parity-reliability-20261102` (PR #5)

## Method and scores

Read the current source, open PR #5, CI workflows, Kotlin Android V2 screens/settings/API, and backend REST contracts. CI results are checked separately from production runtime behavior. All ratings are **source-only expert estimates**, not a screenshot study or a real Windows VPN security evaluation.

| Aspect | Windows main at audit start | PR #5 after static changes | Why not 10/10 |
|---|---|---|---|
| UI/visual coherence | 5.5/10 | approximately 7/10 (provisional) | New Android-brand shield/palette but no native multi-DPI screenshot comparison, complete accessibility and motion audit |
| Android functionality parity | approximately 4/10 | improved but incomplete | Android has a native mobile service, some cross-platform features/settings are not implementable without a real Windows Service or API extension |
| Authentication reliability | unverified live | substantially hardened in source | Fresh account and Telegram/device tests still need real 3x-ui staging |
| VPN traffic safety | experimental | experimental | Exit-IP comparison is **not** a Kill Switch, DNS or IPv6 leak-proof guarantee |
| Billing and entitlement | server catalog integrated | invoice-specific and fail closed | No YooKassa sandbox + 3x-ui fulfillment acceptance; backend lacks native renewal/cancel controls |
| Stable release qualification | NOT READY | NOT READY | Actual Windows install, UAC/network/crash/signing tests missing |

## P0 and P1 findings, source evidence, and changes

| Priority | Finding | Files | Result |
|---|---|---|---|
| P0 | Previously a canceled Telegram poll could still store the returned JWT inside native Rust before JS discarded it | `service.rs`, `main.rs`, `ui/app.js` | Native ticket ownership, server-response generation check, token-scoped cancel IPC, fail-closed token rotation |
| P0 | Logging out through Tauri did not guarantee an active Xray process was stopped | `service.rs`, `ui/app.js` | Tauri logout serializes with connect/disconnect, terminates/waits for Xray before clearing tokens |
| P0 | `vpn_status` treated a live Xray process as proof of working routing | `service.rs`, `egress.rs` | Re-probe the *same IPv4 public exit* periodically; if its verification fails, end Xray and remove connected status. Does not guarantee leak prevention between probes |
| P0 | A dead Tauri bridge triggered JS simulation, including impossible active security settings | `ui/app.js` | Production now rejects missing bridge and cannot pretend to have an authenticated user or VPN |
| P1 | Backend already reports `is_current` from HWID, but Windows always overwrote it to false when `install_id` was omitted | `service.rs` | Preserve canonical backend identity and test legacy fallback |
| P1 | API/provider outage was mapped to `no subscription` when attempting VPN connection | `service.rs` | Distinguish inaccessible subscription from no access |
| P1 | Disconnection ignored `child.kill` / `child.wait` failures and reported success | `service.rs` | Report native OS errors, keep state until termination verified, idempotent stop |
| P1 | Logout could leave old frontend timers and stale network responses could revive another account's UI | `ui/app.js` | Session-epoch guards for polling/refresh, stop timers and reset state |
| P1 | Unknown entitlement was displayed as no subscription | `ui/app.js` | Explicit unknown state; avoid false upsell |
| P1 | Account deletion backend returns HTTP 501, but UI invited users to delete immediately | `ui/app.js` | Honest request-to-support flow; do not claim deletion |
| P1 | English renewal copy falsely promised existing in-app auto-renew cancellation | `ui/app.js` | Corrected to support-only workflow |
| P1 | Dynamic status and toast messages remained in Russian when language = EN | `ui/app.js` | Localized primary dynamic states and 50+ notifications; arbitrary backend errors still lack machine-readable codes |
| P1 | Old manual-link import could create a fake locally active user; still registered as a native command | `main.rs` | Legacy pseudo-auth IPC unregistered; backend-confirmed Email/Telegram only |
| P1 | Client-provided server list, prices or payment success must not be trusted | `ui/app.js`, `service.rs` | Existing PR #5 and backend already use server-owned catalog, owned invoice checks and actual node data; preserved |
| P2 | UI monolith and obsolete styles hamper maintainability | `ui/app.js`, `ui/styles.css` | Still require modularization and component-level visual snapshots |

## Android V2 → Windows acceptance matrix

| Scenario | Android reference | Windows state after PR #5 | Remaining gate |
|---|---|---|---|
| Welcome / login | `SignInScreen.kt`, `SignUpScreen.kt` | Email/Telegram/native token storage and cancellation improved | Live signup, invalid password, refresh/logout on real Windows |
| Main connection | `HomeScreen.kt`, `VpnManager.kt` | Android artwork/colors, Rust Xray/Wintun, state handling and live exit-IP recheck | Route/DNS adapter inspection, tunnel traffic & crash proof |
| Server selection | `ServerSelectionSheet.kt` | API-supported VLESS Reality nodes only, selection persisted | Live node switch, gateway and ping acceptance |
| Free trial | `TrialScreen.kt`, `SubscriptionManager.kt` | Server-confirmed 3 days, no fake local entitlement | Real account and panel provision |
| Pricing / payment | `PricingScreen.kt`, `YooKassaPaymentHandler.kt` | Only server prices for 2/5/10 devices, owned invoice confirmation | Provider sandbox payment/cancel/refund/renewal |
| Account | `AccountScreen.kt` | Updated profile actions, refresh, truthful unknown subscription, no fake deletion | Server-side password reset, real account erasure, recurring management |
| Devices | `DevicesScreen.kt` | HWID device list, current device preservation, device revocation API | Real devices across Android/Windows, 2/5/10 limits |
| Settings | `SettingsScreen.kt`, `SettingsRepository.kt` | RU bypass on by default, DNS, local language and start options | **Settings are local-only**: cross-device settings sync needs authenticated backend API and Android client update |
| Advanced settings | `AdvancedSettingsScreen.kt` | Honest disabled Kill Switch, selected DNS | Privileged Windows service + proven WFP policy |
| i18n | `LocaleManager.kt` | RU/EN labels + dynamic messages | Complete server error codes and every dialog/placeholder audit |
| Support / legal | `SupportScreen.kt` | Official Telegram support action | Final legal text and localization review |
| Updater / background | `AppUpdateManager.kt`, `ByMeVpnService.kt` | Desktop installer/runtime SHA verification | Signed updater, rollback, tray and independent Windows service |

## Non-negotiable release blockers

1. Run the Tauri WebView **as ordinary user**, isolate elevated network operations into a dedicated Windows Service with well-defined ACL-protected IPC. Current `build.rs` still sets `requireAdministrator`.
2. Implement and prove IPv4/IPv6 routes, DNS policy, adapter lifecycle, WFP Kill Switch and fail-closed reconnection on Windows 10/11. A periodic public-IP comparison is **only a health indication**, not comprehensive privacy protection.
3. Manual test with a staging account and registered 3x-ui HWID: email login/register/expired token/logout, Telegram canceled poll, reconnect, trial, server list and device synchronization.
4. Verify YooKassa sandbox invoice creation, pending/succeeded/canceled states, provisioning and device counts through the real provider/webhook.
5. Test 100 connection cycles including process crash, power sleep/resume, Wi-Fi switch, UAC denial, Windows uninstall and system restart; verify default routes and DNS restoration.
6. Visually compare canonical Android V2 with actual Windows screenshots at 900x620 / 1366x768 / 1920x1080, DPI 100–200%, keyboard/screen reader and animations reduced.
7. Implement legitimate backend password recovery/account deletion/recurring payment controls before exposing them as functioning account settings. Android and Windows should not invent endpoints or states.
8. Use signed installer, verified update path and rollback before stable distribution.

**Decision:** Continue development in draft PR #5, retain release as experimental. Merge only after CI and review; advertise “10/10” only after the network, functional, security and visual acceptance matrix passes.
