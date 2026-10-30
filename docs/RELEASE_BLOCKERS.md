# Windows release integration requirements

This list separates desktop work from server-side changes needed to deliver the requested account, checkout, and connection flow. The supplied repositories contain the Android client and Telegram bot, but not the ByMeVPN API implementation.

## Authentication

- **Email:** the desktop client calls the same `/auth/register` and `/auth/login` endpoints as Android.
- **Google:** the Android source uses a Google Web Client ID to request an ID token. Google desktop OAuth requires a registered Desktop OAuth client flow, and the API must accept that client audience. The Windows redirect/callback and the API audience allowlist are not present in the supplied source. Keep Google visibly unavailable until those are configured; never embed a web-client secret in the desktop binary.
- **Telegram:** the bot's `/start login` returns `bymevpn://login?sub=...` for an active Telegram subscription. Windows currently registers the URI scheme but does not import that subscription. The bot link is a bearer credential and must be validated, stored in Windows Credential Manager, and fetched only over verified TLS.
- **Unified account:** email/JWT accounts and Telegram/Happ subscription users currently follow different paths. The API needs a supported account-link or Telegram exchange flow so auth, entitlements, device limits, and server access describe the same customer.

## Subscription and payment

- The bot source contains the YooKassa checkout and payment-confirmation workflow. The client must never contain YooKassa shop secrets or activate a subscription based only on a browser return URL.
- Current Windows payment navigation opens the bot. Direct in-app checkout requires authenticated API endpoints to create an order, return a hosted checkout URL, query payment state, and refresh entitlement after the server-side YooKassa webhook confirms payment.
- The bot currently describes an introductory offer of 3 days for 1 ₽ followed by 89 ₽/month. Eligibility and recurring terms must stay server-authoritative and be shown before the customer leaves for checkout.

## Tunnel and entitlement

- The Android API exposes `/vpn/session`; Windows must use a documented response contract, convert it to a validated Xray configuration, and confirm the adapter, routes, DNS policy, and tunneled traffic before showing “connected”.
- The Telegram bot's subscription URL and the API session endpoint are separate credential paths. The API must define whether Windows imports the subscription URL or exchanges the Telegram account for a session token. Do not silently accept arbitrary URLs or copy Android's trust-all TLS behavior.
- Device inventory must come from the system that enforces the subscription's device limit. Confirm whether `/devices` is authoritative for Telegram/Happ device registrations or whether the API needs a unified device endpoint.
- A pinned, integrity-verified Xray Windows runtime and matching Wintun DLL, an isolated elevation strategy, safe route/DNS rollback, leak tests, and sleep/network recovery are required before release.

## Verification still required

- A configured Google Desktop OAuth client and account accepted by the API.
- A legitimate end-to-end test account and payment sandbox/test flow.
- Windows C++ Build Tools (`link.exe`) to compile the current MSVC target.
- Installed-package testing for Telegram deep links, YooKassa return, account/device synchronization, real traffic, IPv4/IPv6/DNS leak behavior, and clean disconnect.
