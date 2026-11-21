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
- User explicitly authorized pushing to GitHub and releases. Existing `v1.2.17` tag is already present; do not move it. Tag `v1.2.18` was pushed and its workflow succeeded: 70 CI Rust tests, NSIS/MSI, MSI runtime smoke check, portable ZIP and SHA-256 file. It created a draft prerelease with four assets. Its release URL is under the `untagged-*` draft slug, so it is not public yet.
- An attempted change to expose a public prerelease was rejected by `tests/release-hardening-contract.test.mjs`, which explicitly requires experimental release builds to remain drafts so they are not auto-published to paying clients. The workflow and version files were restored to the tested v1.2.18 state. Do not override that release invariant without a deliberate product-policy change.
- GitHub CLI is not authenticated in this environment. `git ls-remote` can read the public repository; test the configured Git credential helper by pushing the new branch commit and tag. If write access is unavailable, stop external mutations and report the auth blocker. Do not expose any credential material.
- Do not call the product ready for general clients: live Windows traffic/route/DNS acceptance, signed installers, least-privilege service, and Android full parity remain unverified or incomplete.
- `v1.2.18` Actions run `44550737954` completed successfully. It passed 70 Rust CI tests, Tauri EXE/MSI build, MSI runtime smoke check, portable ZIP packaging and SHA-256 generation. GitHub created a draft prerelease with four assets (about 59.7 MB total). The release is not publicly published because its required draft policy and explicit audit blockers remain.
- The user request to upload to GitHub/releases is fulfilled as a pushed branch, pushed version tag, and populated draft release; publishing it publicly would contradict the existing draft-only release invariant. The earlier attempt to change that invariant was reverted before commit/tag.

## 2026-11-19 Android selection parity and ping cache
- Updated server TCP reachability cache: config-scoped SHA-256 key, ten-minute expiry, stores failed probes too, bounded to 512 records, and reuses results on subsequent catalog loads. This remains TCP endpoint connection time, not Android's configured-outbound tunnel latency. Hysteria2 remains excluded from TCP probes.
- Matched Android `20c76df` automatic-selection feedback: while automatic mode is connected, Windows now displays the assigned server and country in Home; the server picker subtitle updates with the assigned server and falls back to the original automatic-selection description when disconnected.
- Refreshed `docs/STATUS.md` for source version 1.2.18 and current release blockers.
- Added a bilingual behavior test for automatic-selection text. Corrected the frontend test DOM stub to implement `querySelector` required by account refresh rendering, and updated the release contract to assert the new cache-aware probe condition.
- Passed: all 71 Rust tests (`cargo test --locked`), full Node suite (`node --test --test-reporter=dot tests/*.test.mjs`), focused Rust cache test, focused UI parity suite, Rust formatting and `git diff --check`.
- Fresh `cargo build --locked --release` succeeded for current source. Tauri produced NSIS and MSI packages; MSI administrative extraction smoke-check verified Xray and Wintun assets at the runtime path used by the app. The packages are unsigned and are not being presented as public stable release artifacts.
- Full locked Rust tests (71) and the full Node suite passed after correcting two stale test harness expectations. Rust formatting, frontend syntax and whitespace checks passed.
- No live VPN, external server probes, Android device, route/DNS/proxy changes or account mutations were used.
- Stable/public release remains NO-GO under `docs/PRODUCTION_RELEASE_GATE.md`: privileged service/secure IPC, signed distribution and live protocol/network acceptance are still open. Existing v1.2.18 draft remains untouched; do not publish stable without evidence and do not claim Android tunnel-latency parity.

## 2026-11-19 EXE-only 1.2.19 packaging
- Bumped source version consistently to 1.2.19 (Cargo, Cargo.lock, Tauri and visible UI).
- Changed Tauri bundle target and CI/release artifacts to one complete NSIS `.exe` installer plus `SHA256SUMS.txt`; removed MSI and portable ZIP from both preview and release assets. Generated releases remain gated as drafts/prereleases.
- Replaced MSI extraction with a Windows-CI-only NSIS install/runtime-hash/uninstall smoke check. It never launches the app or VPN. Local install smoke was not run because the installer is per-machine/elevated; no local UAC or network changes were initiated.
- Hardened `scripts/package-installers.ps1`: it no longer recursively deletes `dist`, refuses to overwrite non-empty output, accepts `BYMEVPN_DIST_DIR`, and selects the exact versioned installer so stale `target` artifacts cannot be packaged. Existing ignored `dist` contents were preserved.
- Built `ByMeVPN_1.2.19_x64-setup.exe` and packaged it under `src-tauri/target/release-artifacts-v1.2.19/` with SHA-256 `3b82c98dc0cc44d858373bda90bc8f83d20d83321d949862ce4cbc503a393594`.
- Full Rust test suite: 71 passed. Full Node suite and focused packaging contract passed after the exact packaging-version filter; PowerShell parser, Rust formatting, JavaScript syntax and whitespace checks also passed.
- Packaged installer SHA-256 was rechecked and matches the recorded value. Authenticode status is `NotSigned`; release code signing remains unresolved.
- No live VPN session, real server probe, Android device/USB, account mutation, route/DNS/proxy change or local installer execution. Public stable release remains blocked by the production gate; do not tag/publish v1.2.19 as stable or change the draft policy.

## 2026-11-20 VPN probe and Hysteria latency fix
- Added Cloudflare and Google 204 endpoints to the paired HTTPS egress check so `probe_unavailable` is less dependent on Google connectivity-check and Microsoft endpoints alone.
- Hysteria2/Hy2 server ping now launches a short-lived, authenticated loopback-only Xray probe and measures a real HTTPS request through the configured QUIC/TLS outbound. It does not use TCP connect time as a Hysteria latency and owns the temporary process with a Windows kill-on-close job. Probe parallelism is capped at two, failed results are cached for 10 minutes, and the server catalog still has a four-second overall cap.
- App startup now deletes only stale `server-ping-*.json` temporary configs from its own app-data directory, preserving unrelated settings/files after a forced process exit.
- Ping tooltip distinguishes protocol-level HTTPS latency for Hysteria2 from TCP handshake time for TCP protocols. Cache retains only this safe method label and clears stale ping values.
- Verified offline: Cargo check; targeted Hysteria/UDP ping eligibility and stale-config cleanup tests; bundled Xray accepted synthetic Hysteria2 configuration test; focused Node contracts (62 passed); formatting, JavaScript syntax and `git diff --check`.
- No server, account, VPN session, system route, DNS, proxy, adapter, or Android device was touched. Automatic choice logic is covered offline, but actual selected-server reachability, Hysteria server latency, and the screenshot's environment-specific `probe_unavailable` symptom remain unverified until live connectivity can be tested.

## 2026-11-20 startup verification errors and automatic selection display
- Increased the preflight loopback-listener grace from 2s to 5s and replaced the single generic safe-check error with separate core-exit, listener-timeout, and remote HTTPS-probe errors; all occur before TUN routes are changed.
- Increased the bounded full TUN handoff window from 9s to 12s and its end-to-end HTTPS-path verification from 6s to 8s to accommodate slower Windows DNS startup without accepting a failed proof.
- The automatic-server card now retains and displays the locally selected server name even if the preflight attempt fails, so users can see which node was attempted.
- Bumped source/package version to 1.2.20 for this release candidate. Stable release remains blocked by the production release gate; an authorized tag would create only a draft prerelease under repository policy.
- Offline checks passed: Cargo check, 48 focused UI/startup Node checks, format and whitespace checks. No live VPN or system network settings were touched.
- Final v1.2.20 release build succeeded: Tauri produced `ByMeVPN_1.2.20_x64-setup.exe` (15,934,976 bytes). Packaged under `src-tauri/target/release-artifacts-v1.2.20/` with SHA-256 `4c560a47b3e0b3e8cc0d82f7dd03b574f9eec4c4f307eab78be7890729e3720b`; Authenticode reports `NotSigned`.
- Additional release-hardening contract checks passed (8 tests). Live tunnel, route/DNS behavior and external IP proof remain intentionally untested; this candidate must remain draft/prerelease under `docs/PRODUCTION_RELEASE_GATE.md`.

## 2026-11-20 Google sign-in UX and session-recovery retry
- Google OAuth no longer explicitly forces `select_account`; returning browser sessions can complete without a redundant chooser when Google already has consent. Loopback callback now displays a self-contained bilingual ByMeVPN success/error page using the Android dark/mint palette, restrictive CSP, no external resources, and no-store headers. Login/register buttons use the same multicolor Google SVG treatment as Android.
- Saved-session startup now makes one 450 ms retry only after a transient timeout/TLS/429/5xx failure; it avoids retrying expired/invalid sessions and reports a localized reason instead of discarding the native error into one generic toast.
- Focused Node contracts and the Rust callback-page unit test passed; JS syntax, Rust formatting and whitespace checks passed. No account, browser OAuth, VPN, route, DNS, or proxy action was run.
- Bumped source to `1.2.21`. If an authorized GitHub tag is pushed, repository workflow creates a draft prerelease only. Public stable release remains blocked by the production gate and live VPN acceptance is still intentionally unverified.

## 2026-11-21 automatic selection and event-order fixes
- Confirmed Android source reference is still `origin/main` at `f1c30829` (Android 1.0.50); did not modify the Android worktree.
- Fixed a client race where startup requested the server catalog before the Tauri latency event listener had finished registering. The UI now awaits listener setup, while a missing event bridge remains non-blocking. Added a focused contract.
- Fixed automatic connection selecting the first unmeasured server as if it were the fastest. The client now passes an explicit node only when a compatible protocol-level latency result exists; otherwise `node_code=auto` lets the API choose. The UI keeps the neutral “We will choose a server” label until a server is actually measured or assigned. Added behavioral coverage for both unmeasured fallback and fastest measured selection.
- Repaired a stale release-contract test binding (`source` was undefined) and updated the auto-selection assertion to the current copy.
- Verification: 7 focused Node checks passed (automatic connection/selection, latency event setup, and account-bound device removal); `node --check ui/app.js` and `git diff --check` passed. No Rust source changed in this increment, so no build was rerun.
- No real VPN session, account action, Android device, route/DNS/proxy change, or live-server speed test was performed. This UI/native source snapshot has not been rebuilt since these changes; existing release artifacts do not contain this increment. Full Android visual parity and stable public release acceptance remain incomplete.

## 2026-11-21 measured-node failover and startup latency
- Automatic mode now makes one bounded fallback attempt after the selected, measured node fails its protocol-level server reachability check. It orders alternatives by successful protocol HTTPS latency, skips known failed probes, and does not retry `probe_unavailable`/system-path errors that could hide a Windows routing problem. Manual node selection is unchanged.
- Moved the external pre-VPN IP check earlier and joined it after server Xray preflight but before any TUN route changes. Its result and verification meaning are unchanged; the initial probe overlaps more of configuration validation and server startup.
- Added focused frontend behavior coverage for one alternate-node retry and no retry on an unavailable system probe. Together with automatic selection/event-order tests, 6 connection checks passed.
- `cargo check --locked`, `cargo fmt --check`, `node --check ui/app.js`, and `git diff --check` passed. No real VPN session or Windows network configuration was used. Current release artifacts do not include these edits; a new installer build is still needed after implementation is complete.
- A targeted Rust unit test compiled, but the Windows test executable was not launched: Windows returned `os error 740` (elevation required). No UAC was invoked. `cargo check` remains successful; the pure Rust runtime test is unverified in this non-elevated session.

## 2026-11-21 reconnect detection interval
- The native watchdog previously polled every 8 seconds while reconnect backoff started at 2/4/8/16/30 seconds, so actual first recovery was often delayed to roughly 8–10 seconds. Changed the poll cadence to 2 seconds so scheduled retries can start near their intended delay; the backoff and retry limit are unchanged.
- `cargo check --locked`, `cargo fmt --check`, the focused watchdog contract, and `git diff --check` passed. A Rust unit-test executable requiring elevation was not run (Windows `os error 740`); no UAC or live VPN/network changes were performed.

## 2026-11-21 vector icons and parity contract repair
- Replaced platform-dependent emoji glyphs with SVGs in server search/automatic selection, device rows, Windows settings, support/legal tiles, pricing features, Telegram modal, and confirmation UI. Dynamic device entries now use consistent vector icons for phone, TV, and computer categories.
- Corrected a stale UI contract that expected the removed `card-support-channel` card; it now matches the current accessible support FAQ/email buttons and rejects the removed channel card.
- Verified JavaScript syntax and whitespace, then ran only the directly relevant frontend/UI parity group: 49 tests passed. No app launch, Android device, network request, VPN session, or Windows networking change was used. This is source-only work; no installer or release was rebuilt.

## 2026-11-21 Android typography parity
- The Android theme uses its default Roboto face, while Windows WebView fell back to Segoe UI. Bundled the official variable Roboto font with its OFL license and made it the local UI font; weights 100–900 and Cyrillic glyph coverage were verified from the font tables. System fallback remains available.
- Extended the existing visual-token contract for the local font. The focused UI-parity tests passed (5); JavaScript syntax, whitespace, and `cargo check --locked` passed. No app launch, VPN session, or Windows networking change was made. Release packaging remains pending.
- Local packaging then completed with the CI-equivalent `npx --yes @tauri-apps/cli@2 build`: `ByMeVPN_1.2.21_x64-setup.exe`, 16,211,876 bytes, SHA-256 `27360aa1c46607158f3a2d3489cabfdafa663fd411c2b88cc82ad4ba5a184346`. A separate versioned artifact folder and `SHA256SUMS.txt` were created under `src-tauri/target/release-artifacts-v1.2.21/`. The installer is not Authenticode-signed (`NotSigned`) and was not launched; the CI install/uninstall smoke test was not run locally. No GitHub push/release, live VPN, Android device, or Windows network mutation occurred.

## 2026-11-21 account-recovery and server-catalog lifecycle
- Compared the affected Windows home/recovery flow with Android `origin/main` (`6a09f090d60b57cd986f4e90b341e831266ac4b4`). The no-plan card now maps confirmed trial-used/inactive states to plans, unknown entitlement to retry, and eligible email/Google profiles to Telegram account recovery; the recovery control visibly disables while its session is created.
- Added single-flight server catalog loads, queued forced latency refreshes, and two bounded retry delays for transient catalog errors. Retry timers are invalidated by account/session or entitlement changes. Server latency probes are also cancelled on auth/session replacement and before tunnel start.
- Focused verification: mobile/account/pricing behavior (29 passed), catalog retry/concurrency contracts (4 passed), JavaScript syntax, whitespace check, Rust formatting, and the Rust probe-cancellation unit test (1 passed). No Android files were edited; the existing local Android `AccountScreen.kt` modification was preserved.
- Rebuilt the current Windows source with Tauri. The fresh local installer is `src-tauri/target/release-artifacts-v1.2.21-followup-2026-11-21/ByMeVPN_1.2.21_x64-setup.exe` (16,212,318 bytes; SHA-256 `8d1166acaee727db5f6ef65534571cb34a7061e948125d87fe9fcd295c72da86`). Authenticode is `NotSigned`; the earlier `release-artifacts-v1.2.21` copy was preserved. This installer was not launched and is not signed or publicly released.
- No live VPN, account mutation, route/DNS/proxy/adapter change, app launch, UAC, GitHub push, or release was performed. Public release remains NO-GO under `docs/PRODUCTION_RELEASE_GATE.md`.

## 2026-11-21 VLESS Encryption protocol parity
- Compared Android `XrayConfigGenerator` and current Xray-core configuration documentation/source. Windows previously rejected every VLESS client `encryption` except `none`, although Android forwards Xray's `mlkem768x25519plus` values and the bundled Windows Xray 26.10.31 accepts them.
- Windows now validates supported mode/RTT, bounded padding parameters and URL-safe client key sizes (32 or 1184 bytes), then forwards the original value unchanged. Unsupported or malformed values still fail before route changes. The backend's current Windows compatibility filter is transport/security based and does not strip or reject this field; the existing `vless-none` capability remains the correct transport/security hint.
- Added config-preservation, malformed-input and bundled-Xray parser checks. All 26 `tun_config` tests passed, including synthetic no-padding and padded ML-KEM configs; Rust formatting passed. This does not prove a server is configured with the matching key or that a live connection works.
- Rebuilt the current source with Tauri; the local package is `src-tauri/target/release-artifacts-v1.2.21-vless-encryption-2026-11-21/ByMeVPN_1.2.21_x64-setup.exe` (16,215,956 bytes; SHA-256 `1077751db966e53dca9db308ba150d21676f87cf222a28b918ed1664a810dd73`). Authenticode status is `NotSigned`. The prior local package was preserved; this installer was not launched or published.
- No live VPN, account, Android device, route/DNS/proxy/adapter change, UAC, GitHub push or release was used.

## 2026-11-21 PC-oriented Windows layout and release candidate
- Desktop CSS now restores a persistent left navigation rail and full-width work area, with the Android palette and screen content preserved. Wide Home and sign-in screens use desktop-sized columns; the server selector and account settings are centered desktop dialogs with server search visible. Narrow windows retain the compact layout. No new gestures or network actions were added.
- Updated the desktop responsive contract to assert the Windows layout behavior. Focused test passed (6/6); JavaScript syntax, Rust formatting and `git diff --check` passed.
- Source version is now 1.2.22. Remaining for this snapshot: run the complete local frontend and Rust checks once, create the final EXE installer, verify its hash, commit and push the source branch and `v1.2.22` tag. The tag workflow creates a draft prerelease only.
- Stable release is still blocked by the production release gate: no live VPN/network acceptance or signed installer, and no service/privilege isolation. No Android files or real Windows networking were touched.

## 2026-11-21 Android latency parity and final candidate
- Checked Android default branch through commit `b456c46926772cde4a122357309685cbb087a6fb` and its latency fix `f9bd419477e428fd20959acf4233293090dd8c39`. Windows keeps Automatic selected during connection and measures configs returned by `/servers` through each protocol outbound; it now uses the same Cloudflare/Google HTTPS latency signal, averaging successful samples and omitting failures. Hysteria2 continues to use a real HTTPS request through Xray/QUIC.
- Added the bilingual explanation below the desktop server-latency controls, and changed the failed-measurement copy to Android-aligned “Could not measure / Не удалось измерить”. Desktop search, persistent navigation, two-column home and sign-in remain Windows-adapted.
- Focused Node parity/latency checks passed (61 tests); the complete Node suite passed. Release-mode Rust suite passed 77/77. JavaScript syntax, Rust formatting and whitespace checks passed.
- Rebuilt from the final source snapshot as `ByMeVPN_1.2.22_x64-setup.exe` (16,214,284 bytes) into `src-tauri/target/release-artifacts-v1.2.22-github-candidate-2026-11-21/`. SHA-256: `e48f6fde19e4aa7f841818ee98da85fe1925f016ce632ef4cccffba9cf021124`. Authenticode status is `NotSigned`; the installer was not launched and clean-machine install/uninstall was not tested.
- Source version remains `1.2.22`. Commit `f55eaedcee619a87ac9e8df27c501212e3006bd8` and tag `v1.2.22` were pushed to `codex/release-v1.2.14`. GitHub Actions run `44883989247` succeeded: Rust tests, NSIS build, install/runtime-hash/uninstall smoke check and upload passed. The draft release contains the EXE and checksum; CI installer SHA-256 is `41cc13c4324956f656f1ed86553fe5d8b274387df6ff01dc900a8b7c0f72e52c`. Release URL: `https://github.com/Brof14/ByMeVPN-app-windows/releases/tag/untagged-2596f65f514fe051ff92`.
- Do not publish a stable release: the production gate still requires signed distribution, privilege-isolated service, clean-machine install/rollback, and real Windows network acceptance. No live VPN, route/DNS/proxy/adapter changes, app launch, Android edit, or account/session mutation was performed.

## 2026-11-21 privileged VPN service 1.2.23
- Added a separate LocalSystem Windows service for tunnel/session ownership so the Tauri UI can run with an `asInvoker` manifest. The installer registers the service once under Program Files, stops it for upgrades, and removes it on uninstall; only the disposable GitHub Actions smoke script installs it.
- The service accepts bounded intent over a local named pipe, checks the caller's SID and interactive session, owns only the Xray child it starts, monitors/reconnects it, restores routes/DNS on its own ByMeVPN adapter, and tears down that account's session on Windows logoff. No process-name scan/kill exists; the user's unrelated `xray.exe` was not inspected, stopped, or changed.
- Local checks/build: `cargo fmt --check`, `cargo check --locked --bins`, one bounded IPC validation test, release service build, Tauri NSIS `.exe` build, JS syntax, PowerShell parser, and `git diff --check` passed. The startup's baseline-IP measurement now overlaps the server preflight. Latest local installer `ByMeVPN_1.2.23_x64-setup.exe`: 17,228,160 bytes, SHA-256 `B99E5BB4DAE9861874425462E26530653CC16B7CD654824E5263D845CE42D924`; installer/UI/service are unsigned. The full frontend contract suite passed 157/157 after moving the source expectations to the service boundary.
- Current branch is `codex/release-v1.2.14` and remote branch is at `6b259b9cb7d4c89b9a2bcf009059361cf8553d99`; no `v1.2.23` tag exists yet. GitHub CLI is not authenticated. Next: commit only reviewed source/docs, push branch/tag using available GitHub credentials, then wait for hosted Rust/NSIS install-uninstall smoke and draft prerelease workflow. If native Git credentials are unavailable, use the connected GitHub integration only if it supports safely publishing the full tree; otherwise report the concrete auth block.
- Do not install/launch the app or installer locally, change routes/DNS/proxy, or test a real VPN. User's other VPN and its `xray.exe` must remain untouched. Do not mark this stable/public: clean-machine and live network acceptance were explicitly deferred, and Authenticode signing remains blocked by the missing private-key certificate.
