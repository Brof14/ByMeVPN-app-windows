# Continuation — ByMeVPN Windows parity

Workspace: `C:\Users\User\Documents\ChatGPT\ByMeVPN-app-windows\work`
Branch: `codex/release-v1.2.14`, upstream `origin/codex/release-v1.2.14`.
Android reference is read-only at `..\android-work`; use `FETCH_HEAD` (observed latest `e2c5ae7 Run server latency checks sequentially`). Preserve its existing unrelated modification in `AccountScreen.kt`.

## This run
- Added ISO alpha-2 country flag fallback in `src-tauri/src/service.rs`.
- Added explicit Android-parity account deletion: `DELETE /me` with `X-Confirm-Account-Deletion: DELETE`, stops/restores the local tunnel, pins request to auth generation, then clears local credentials. Wired Tauri command and RU/EN confirmation UI.
- Trial CTA now opens an informational confirmation before making the activation request.
- Updated focused source-contract test for account deletion.
- Passed: Rust fmt check, Rust debug `cargo check`, JS syntax, 14 focused Node tests, diff whitespace check.
- `cargo build --release --manifest-path src-tauri/Cargo.toml` is still running in exec session 85059; poll with `functions.exec` -> `tools.write_stdin({session_id:85059,...})` until it finishes. It has reached final optimized Rust compilation (rustc active) with no error output so far.
- No real VPN, account deletion, payments, route/DNS changes, Android device, commit, or push was performed.

## Continue next (do not repeat completed steps)
1. Poll release build session 85059; diagnose only if it exits with an error.
2. Inspect latest Android feature deltas from `git -C ..\android-work log --oneline origin/main` and compare by flow against Windows (`ui/index.html`, `ui/app.js`, `src-tauri/src/service.rs`). The Android checkout has local user changes; do not checkout/reset/pull it.
3. Prioritize tunnel correctness/performance parity: Windows currently does direct TCP latency (`measure_real_ping`) for supported TCP protocols and excludes Hysteria2; Android latest measures server delay through each configured proxy outbound sequentially, emits per-server progress, caches results and avoids probes during connection/active VPN. Do not label TCP connect latency as tunnel latency; assess whether the pinned Windows Xray runtime exposes a safe per-outbound delay API before implementing. Preserve user constraint: no actual VPN session/network mutation.
4. Compare the latest Android network-handover and restore lifecycle policies to Windows watchdog/reconnect; only port deterministic lifecycle protections that compile and can be tested offline. Do not overclaim live stability.
5. Update this file with precise completed/open work if the run again reaches its execution limit.

Public stable release is not proven ready. Existing release audit: `docs/AUDIT_2026-11-15.md`; known blocker includes app-wide admin manifest/no least-privilege VPN service and missing live Windows protocol/route/DNS acceptance. A later explicit user request authorizes pushing changes and preparing a **draft prerelease only**, using the workflow's disclosure and draft flags.

## 2026-11-19 follow-up
- Completed the pending release build: session 89646 passed after 3m22s. That binary predates later edits. A new release build for the final Rust changes is running in session 49965; poll it. UI assets changed during compilation, so rebuild once more if packaging the final UI requires it.
- Fixed trial confirmation click event accidentally bypassing confirmation; old account confirmations cannot activate trials on a new account. Added behavioral tests.
- Hardened account deletion: recheck account identity, guard duplicate requests, require server confirmation of deletion and revocation, avoid asserting all records are erased, and refresh VPN status on failure. Live backend acceptance remains unverified; no deletion was performed.
- Catalog loads skip TCP probes while tunnel is already active/transitioning. Removed repeated hidden TCP probes from VPN status; TCP numbers in the catalog have explanatory accessible labels. This does not implement Android outbound latency or prove throughput improvement.
- Fixed queued automatic reconnect potentially starting after manual stop or changing servers, by revalidating the reconnect state inside the connection gate. Focused Rust unit test passed.
- Corrected egress classification: two differing proxy/system public IPs are traffic observed but unverified, not matching IP proof. Focused Rust unit test passed.
- Updated support screen to match mobile copy and email contact, with keyboard-operable native buttons. Full Node UI suite passed after the reconnect/egress changes and before the final duplicate-deletion guard; targeted account suite subsequently passed. `cargo check --locked` passed after reconnect/egress and probe changes. `cargo fmt --check` and `git diff --check` passed.
- Current source is uncommitted. Do not claim release readiness or live VPN speed, security or stability. Preserve explicit prohibition on real VPN sessions, system route/DNS changes, Android devices and account mutations during verification.

## Further implementation
1. Poll release build session 49965; if unavailable verify independently without asserting an unobserved exit result.
2. Complete account/session race audit, including parallel logins and account deletion generation binding from confirmation through native request. Verify actual deployed API contract only with non-mutating authorized methods.
3. Compare Android `FETCH_HEAD` server probing and cached per-node latency implementation with Xray's Windows capabilities; implement only real tunnel latency with bounded cancellation, no second TUN, no persisted credentials, and avoid probing while a connection transition is underway. Current displayed TCP measurement is explicitly identified.
4. Finish Windows recovery architecture for sleep/resume and physical network handover, plus process isolation; real validation remains deferred per user instruction.
5. Complete screen-by-screen RU/EN states, keyboard/focus and visual comparison against current Android. Most recent support changes are source-checked, not visually verified.
6. Recheck the release gate (`docs/AUDIT_2026-11-15.md`), signed packaging and installer. No publication until the prerequisites are actually met.

## Latest follow-up
- Added `auth_session_generation` and bound account deletion confirmation to the generation captured before showing the dialog; the native command checks it before local shutdown, during the API request, and before clearing secrets. Concurrent login/session replacement still needs end-to-end audit.
- `cargo check --locked` and the full Node test suite (116 tests, dot reporter) passed after this change. Release build session 49965 started before this latest Rust edit, so its result does not cover the latest source even if it succeeds; rebuild before claiming a final release artifact.
- Checked the pinned Xray CLI help: it exposes `run` and API operations but no standalone `measureOutboundDelay` command like Android libv2ray. Parity requires a separately designed proxy-only probe with lifecycle, credential and cancellation controls; do not assume TCP connect is equivalent.

## Build update
- Release build session 49965 completed successfully in 3m27s, but started before the final auth-generation binding.
- Fresh release build session 82954 started after the final native and UI changes. Poll with `tools.write_stdin` for its result; compilation can take over three minutes. Do not rely solely on an output EXE timestamp.
- Android advanced settings defer kill-switch protection to Android OS; Windows UI correctly states its full kill switch is unavailable. Do not present Windows as having an equivalent protection until a privileged service/WFP design is implemented and verified.

## Protocol parity follow-up
- Compared Android `ApiModels.kt`/`XrayConfigGenerator.kt` and backend `api_router.py`: Android parses missing VLESS `flow` as empty. Windows no longer assumes XTLS Vision when `flow` is absent; explicit Vision remains supported. Focused Rust test passed.
- Windows no longer silently rewrites a non-`none` VLESS encryption mode to `none`; it rejects it before routes change. Supporting other VLESS encryption modes remains open. Focused Rust test passed.
- Added Android API aliases for gRPC/XHTTP/WebSocket/HTTP upgrade path, host and mode; targeted gRPC alias test passed. Full live protocol behavior remains unverified.
- Release session 82954 passed, but predates protocol edits. New release build session 87903 includes these changes; poll via `tools.write_stdin` before reporting its result.

## Android reference refresh
- Read-only fetch now points to `33f584d` (newer than `e2c5ae7`). `33f584d` changes latency probes: sequential configured-outbound checks now try Cloudflare and then Google, cache positive and negative results for 10 minutes keyed by a SHA-256 fingerprint of node/config, and avoid redundant initial probes. Android APK updater/build changes are platform-specific. Windows still uses TCP catalog measurements and does not yet implement outbound latency/cache parity.
- All 24 Rust `tun_config::tests` passed, including bundled Xray acceptance of synthetic profiles; no VPN was connected.

## Final build and cache note
- Release session 87903 passed after protocol changes. The UI was then adjusted to clear stale cached TCP latency; fresh release build session 31843 includes that final UI change and is running. Poll it and record the outcome.
- Cached server catalogs no longer display an unbounded-age TCP latency as current; a targeted behavioral test passed. Full Node UI suite now passes 117 tests. All 24 `tun_config::tests` passed, including Xray synthetic config checks.
- Updated the protocol support matrix in `docs/AUDIT_2026-11-15.md` for Android `33f584d`; no claim of live traffic acceptance.

## Authentication race hardening
- `store_auth` now checks the authentication generation captured when each password login, registration or Google login began. Telegram tickets store the generation from creation and recheck it when approved, while retaining ticket cancellation checks. This prevents an older in-flight authentication result from replacing an already changed account in the same process. Cross-process and real authenticated acceptance remain open.
- `cargo check --locked` passed after this change. The full Node suite had one stale source-pattern assertion after the ticket representation changed; it was updated and the affected `frontend-contract.test.mjs` suite passed. Other full-suite checks were passing in that run.
- Session 31843 is still building a source snapshot from before authentication race hardening; after it finishes, the final source needs a new release build. CPU load caused the debug check to take 1m41s.

## Release build checkpoint
- Session 31843 succeeded in 12m43s, but was compiled before the authentication-race edits. Final release compilation with those edits is now running in session 47714. Wait for completion and report only the observed result. The computer became heavily loaded during LTO; do not launch more broad concurrent builds.

## Verified latest build
- Session 47714 completed successfully: locked release build with the authentication-generation hardening and current UI/protocol changes, 6m42s. This is a raw executable, not a tested or signed installer and not evidence of release readiness.
- Last full Node run after auth changes had one obsolete Telegram ticket source assertion; the corrected affected suite passed. Earlier full suite passed 117 tests before that native auth edit. `cargo check` after auth change and the 24 protocol tests passed.

## Latest UI parity additions
- Added Android support screen entries for version/contact and privacy documents, retained keyboard-operable buttons, and corrected the displayed app version to match Tauri 1.2.17. Added the Android device-limit upgrade entry for active 2/5-device plans; the bot calculates and displays the price, no payment is initiated by the client. Focused UI/translation/account tests and JS syntax passed.
- Release session 37321 started before these latest UI edits; its output is not the latest complete application. Rebuild after completing further UI work, and do not publish an outdated binary.

## Current handoff checkpoint
- Android reference fetched read-only is now `33f584d`; worktree's pre-existing `AccountScreen.kt` edit remains untouched.
- Support page now includes About/version/contact and legal documents; visible UI version corrected from 1.2.15 to 1.2.17 and checked against Tauri configuration. Device page offers the Android Telegram upgrade path only for usable 2/5-device plans, with no automatic payment; heading reflects a confirmed full device list.
- Full Node suite passed 118 checks after the most recent UI edits. 24 Rust configuration tests passed, plus targeted egress/reconnect checks; real VPN traffic, system settings, actual account deletion and real checkout were not tested.
- Release session 47714 passed for the previous code snapshot. Session 37321 is running from before the latest device-upgrade UI changes; its binary must not be presented as the latest source. Poll it, then rebuild after all pending implementation is complete.
- Priority remaining: outbound latency parity/caching (needs safe child process lifecycle and secure temporary config design), Windows handover and least-privilege service, comprehensive Android visual/behavior parity and live release acceptance. The user prohibited real VPN connection and requests no questions. Preserve the worktree and avoid claiming completion.

## Latest build
- Release session 37321 completed successfully in 5m16s but predates the device-upgrade UI.
- Session 50457 is the fresh release build after the current changes; poll it. Avoid introducing further UI/native changes during this build unless necessary; they would invalidate its output.

## Subscription expiry parity gap
- Android tracks `lastFetchedAt`, reduces `secondsRemaining` as time passes, and avoids treating a known elapsed subscription as active. Windows currently retains a static `seconds_remaining` and bases UI on `status`; implement an account-scoped received timestamp and expiry transition that refreshes entitlement without suggesting trial/purchase on unknown data. Ensure timers are canceled on account switch and that an unavailable refresh does not silently authorize or interrupt an existing tunnel. This was identified but not changed in this run.

## Subscription expiry implemented
- Windows now timestamps each received subscription, counts down the server-provided `seconds_remaining`, schedules an account-scoped expiry recheck and treats elapsed entitlement as unconfirmed instead of continuing to display an active subscription. It prevents a new connect or trial prompt while entitlement is unconfirmed; an existing tunnel is not torn down by the UI timer. Old timers are canceled on replacement/logout.
- Full Node UI suite passed 120 tests, including elapsed subscription display and preventing a new tunnel start. No live account or VPN actions were performed.
- Release build session 50457 predates these expiry and device-upgrade UI edits and must not be treated as final; poll it, then rebuild after all implementation changes.

## Account settings parity
- Added Android's logged-in password-reset action for non-Google accounts with a usable email; it uses the existing neutral reset endpoint, prevents duplicate requests and hides the action for Google or placeholder email profiles. Targeted account and translation tests passed; no email was sent.
- Session 50457 started before the subscription timer and this account-settings UI, so its result is not the latest release artifact. Rebuild once implementation changes stop.

## Release compilation update
- Session 50457 completed successfully (4m50s) for its earlier snapshot. Session 59535 is the new locked release build including the expiry timer and logged-in password-reset UI. Poll for its result; no installer or live connection has been checked.

## Pricing parity
- Monthly-equivalent price now uses Android's ceiling of server-confirmed price × 30 / confirmed days; invalid terms are unavailable rather than producing a fabricated rate. The targeted rounding test and full 122-test Node suite passed.
- Release session 59535 started before this pricing UI change and is therefore not the latest source; poll it and rebuild once after implementation stops.

## Final snapshot build in progress
- Session 59535 succeeded in 2m51s but predates the price-rounding adjustment. New release session 84996 includes the latest code; poll it. No further code edits should be assumed included if made after it started.

## Latest verified snapshot
- Release session 84996 finished successfully in 2m39s after the latest pricing change. Executable: `src-tauri\target\release\bymevpn.exe`. It is not a signed installer and was not launched for a live VPN test.
- Full Node suite passed 122 tests, 24 Rust protocol configuration tests passed (including local synthetic Xray config validation), and focused egress/reconnect tests passed. No real server/account mutations or VPN network changes were performed.
- Android source at 33f584d confirms in-app checkout currently uses YooKassa only; Windows retains the same provider.
- Still open: actual Android outbound-delay probing/cache parity; complete screen/state and visual comparison; account race validation across processes and live services; privileged service separation, signed packaging and live Windows VPN acceptance (withheld by the user's explicit restriction). Do not mark public release ready.

## 2026-11-19 publication follow-up
- Bumped application version consistently to 1.2.18 in Cargo, Tauri and the visible UI; synchronized the root crate version in Cargo.lock with an offline Cargo check.
- The full Node suite passed (122 tests). `cargo test --locked --release` passed (70 Rust tests), including synthetic validation of supported Xray profiles. `git diff --check` passed.
- No real tunnel, account mutation, route/DNS change, UAC prompt or Android device was used.
- User explicitly authorized pushing to GitHub and releases. Existing `v1.2.17` tag is already present; do not move it. Target new tag `v1.2.18` on the changes below. The repository workflow builds NSIS/MSI and creates a **draft prerelease** with audit warnings; it does not create a stable release.
- GitHub CLI is not authenticated in this environment. `git ls-remote` can read the public repository; test the configured Git credential helper by pushing the new branch commit and tag. If write access is unavailable, stop external mutations and report the auth blocker. Do not expose any credential material.
- Do not call the product ready for general clients: live Windows traffic/route/DNS acceptance, signed installers, least-privilege service, and Android full parity remain unverified or incomplete.
