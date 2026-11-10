# VPN diagnostics and account/UI recovery — 10 November 2026

Source: current Windows `main` after PR #16; Android reference `app/src/main/kotlin/com/example/bymevpn/components/VpnPowerButton.kt` and `app/src/main/res/drawable-nodpi/byme_connect_shield_transparent.png`.

## Actual defects reproduced from the source and user screenshots

1. **Misleading DNS error.** The old `tun_health::log_hint` reported `dns` whenever *any* recent Xray log text contained “DNS” or “resolve”, including normal DNS routing and WFP status messages. That is not evidence of a DNS failure.
2. **Xray running ≠ verified egress.** A live TUN adapter and installed routes do not prove that Windows applications can resolve domains or reach the internet through Xray. There are six existing fallback HTTPS egress providers, but all may be unavailable on a particular network. Verification must remain unknown until it is independently confirmed.
3. **Blank power circle.** The Android shield was painted via a CSS pseudo-element. The exact Android PNG exists in `ui/assets/byme-connect-shield.png`, with identical Git blob SHA (`b1b269246a75c21742ebc968cb2c3ad6893a73d8`) to the Android drawable. The power control now embeds it directly and retains an inline SVG fallback.
4. **Misleading renewal badge.** `acc-autorenew-badge` was initialized `hidden` in HTML, but `updateSubscriptionUi` overwrote `className` with `badge-inactive` on unknown state. This made “status unknown” appear as a red error on the Account screen.

## Changes, in TDD order

1. Added native tests for normal DNS mentions vs explicit Xray errors, and frontend contracts for power controls, account state and diagnostics.
2. Fixed `log_hint` to classify only failure lines, most-recent first. Existing WFP DNS leak blocking stays enabled. No security downgrade or invented “DNS fixed” state.
3. Added **live read-only system DNS resolution** (`example.com` / `cloudflare.com`, five-second bound) in the user-invoked Diagnostics dialog, separate from Xray log hints. The response differentiates success, unsuccessful lookup and timeout/unknown. No keys, resolver IPs or raw log content are shown.
4. Added a **fresh HTTPS public IPv4 comparison** on explicit Diagnostics requests, with separate safe outcomes: changed, unchanged (possible bypass), observed-without-baseline and provider unavailable. It is serialized against the watchdog and does not invent positive verification.
5. Embedded the byte-identical Android shield PNG in **both** power controls; copied titlebar-brand SVG remains a fallback if the image fails to load. CSS opacity and scale match Android's `VpnPowerButton.kt` (88% fill, .62→1 opacity, .96→1 scale).
6. Removed the green success mark when exit verification has not passed. Unverified connection remains clearly indicated without covering the navigation.
7. Introduced one pure `renewalStatusPresentation` mapping for boolean true, false and unknown. Unknown auto-renewal no longer becomes a red Account badge; Renewal shows neutral “Information unavailable”, not “Off”.
8. Redesigned Account Settings into a responsive profile header and **Profile**, **Subscription**, **Application**, **Help** and **Security** sections. Kept all original actions and confirmation flows, including safe delete-via-support (the API cannot delete automatically). Localized new labels RU/EN.
9. Added behavior regression test exercising Account/Renewal states rather than only checking CSS.
10. Used GitHub Actions to catch and correct obsolete assertions and Rust formatting. No uncommitted local files or service configuration changes.

## What is and is not proven

**Verified by source and automated tests:** Android image identity, modelled Xray/DNS failure classification, Tauri IPC response shape, updated UI semantics, account action IDs and front-end state tests.

**Not verified on a physical Windows computer:** actual VLESS/Hysteria traffic reaching the intended VPS, DNS resolution on the user's active network, leak freedom for IPv4/IPv6/WebRTC, WFP compatibility with another VPN, outbound-interface routing, sleep/resume, UAC/service isolation and screenshot-perfect UI on every DPI.

### Real-world acceptance sequence

1. Install the CI-signed? **No: CI builds an installer but does not imply a signature.** Download and install the matching CI preview only in a controlled test environment.
2. Connect with a valid subscription and open **Диагностика соединения**. Confirm TUN, IPv4 and IPv6 routes, *system DNS lookup*, and the *fresh HTTPS IPv4 check* independently. Do not share raw logs or subscription credentials.
3. If the HTTPS check is unavailable, test actual browser navigation and DNS separately; “Xray running” does not prove encrypted traffic. If the exit matches the pre-VPN IP, disconnect and investigate split routes/WFP and bypass rules.
4. Check correct DNS and IPv4/IPv6 egress after disconnect/reconnect and across networks. Retain Xray's `autoSystemWfpBlockLeak=["dns","misconfigtun"]`, as documented by upstream, until any alternative is proved equally safe.
5. Review Account Settings at 100%, 150%, 200% Windows scaling, in both locales. Confirm logout, copy ID, devices, renewal and support actions.

Upstream TUN documentation: https://xtls.github.io/en/config/inbounds/tun.html

No VPS deployment, live tunnel acceptance or new signed release is claimed in this change.
