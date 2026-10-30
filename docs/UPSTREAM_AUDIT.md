# Upstream repository audit

## Update: 2026-10-29

- The mobile Xray generator emits a Hysteria2 outbound with `network: udp`. Pinned official Xray v26.10.29 rejects that transport; removing it also returns `unknown config id: hysteria2`. This proves incompatibility with these tested configurations, not that every possible Xray build lacks support. A compatible Windows engine or a verified alternative is needed before offering those servers.
- The Windows repository was cloned at `ade2b6f9fdff63a59d6035b221452ef37c8e07ce`. It is an experimental Tauri application that starts an externally supplied Xray executable and changes the Windows HTTP proxy. It does not implement a system VPN tunnel, authentication, or payment. Its proxy code does not restore a previously configured proxy, so it must not be reused as a full-tunnel implementation.
- The mobile repository's current `origin/main` is `f554a0db3dcead76ad7535f8bac08d313bec20d9`. The existing local checkout remains at `9ad6923ae2833d8242432dfa79f30548c6cdde0a`; current source was read from the Git ref without changing the checkout.
- The newer mobile client changes the API base to an HTTP IP address, adds Telegram session endpoints and payment creation/check endpoints, and substantially changes its screens and Xray configuration. The deployed contract and a TLS-protected endpoint must be confirmed before using these flows for credentials or payment. The older endpoint and pricing conclusions below are historical, not evidence of the current deployment.
- The mobile Telegram session code fabricates a refresh token from the access token; that behavior is not evidence of a valid refresh contract and must be verified with the API owner. Similarly, local tariff constants are not proof of current server prices.

Audit date: 2026-10-27 (Asia/Barnaul)

## Sources and provenance

The public repositories were resolved through the connected GitHub integration. `ByMeVPN-app` default branch `main` resolved to commit `9ad6923ae2833d8242432dfa79f30548c6cdde0a` (2026-10-26). The bot's default branch `main` resolved locally to `61763e5afcdf2f68bcb2822de3a2a5e0d38474fb` (2026-10-26). Both repositories were cloned locally and inspected. The app repository contains Kotlin Android sources under `app/src`, older Flutter sources under `lib/`, and an additional generated Flutter Android tree under `android/`; its old README explicitly says not to rely on it.

## Android client findings

| Area | Evidence | Windows implication |
|---|---|---|
| Backend root | `app/src/main/kotlin/com/example/bymevpn/data/api/ApiConfig.kt` | `https://api.parahin.space:8443/api/v1`; keep this configurable at build/runtime boundary, HTTPS validation on. |
| Authentication | `data/api/ByMeApiClient.kt`, `ApiModels.kt` | `POST /auth/register` (`email`, `password`, `name`, `install_id`), `POST /auth/login` (`email`, `password`, `install_id`), `POST /auth/google` (`id_token`, `install_id`), `POST /auth/refresh` (`refresh`); bearer access token; retry once after 401. |
| Account | `ByMeApiClient.kt` | `GET /me`, `DELETE /me`, `POST /auth/logout`; avoid logging response bodies or credentials. |
| Subscription | `ByMeApiClient.kt`, `SubscriptionManager.kt`, `ApiModels.kt` | `GET /subscription/status`, `POST /subscription/trial`, `GET /plans`; entitlement statuses include `none`, `trial`, `active`, `expired`, `grace`. |
| Servers and session | `ByMeApiClient.kt`, `ApiModels.kt` | `GET /servers`, `POST /vpn/session` (`node_code`, `install_id`), `DELETE /vpn/session`; server session includes protocol, host, port, UUID, security, SNI, Reality public key/short ID, fingerprint, transport. |
| Devices | `ByMeApiClient.kt` | `GET /devices`, `DELETE /devices/{id}`. Windows must use a persistent install ID and identify platform/model consistently. |
| Tunnel engine | `vpn/xray/XrayVpnEngine.kt`, `vpn/xray/XrayConfigGenerator.kt` | Android uses `libv2ray` with a VPN file descriptor and supports VLESS/Reality/Vision plus Hysteria2. Windows needs its own process/TUN lifecycle; the Android AAR is not a Windows runtime. |
| Routing/settings | `data/settings/SettingsRepository.kt`, `XrayConfigGenerator.kt` | RU bypass is enabled in the client; settings also include autostart, auto reconnect, kill switch, split tunneling, language, notifications. Windows routing needs a deliberate IPv4/IPv6/DNS policy and leak tests. |
| UI | `screens/{Welcome,SignIn,SignUp,Home,Account,Settings}Screen.kt`, `components/ShieldLogo.kt`, `theme/Color.kt` | Screenshots supplied by the user are the primary Windows layout target; native desktop layout can improve density while preserving identity. |

### Source risks that must not be copied as-is

- `ApiConfig.SERVER_ES256_PUBLIC_KEY` contains an obvious placeholder, so offline JWT entitlement validation cannot be considered production-ready from this source alone.
- The Android Xray config uses `allowInsecure: true` for TLS branches. Its direct subscription fetch also installs a trust-all certificate manager and accepts every hostname. The Windows client must keep certificate validation enabled and reject invalid certificates/hostnames.
- The upstream app includes direct subscription URL import paths. Those links are bearer secrets and must be masked in UI/logs and stored securely.
- Android's `libv2ray.aar` and Android permission/service lifecycle do not port to Windows.
- The screenshot's green connected state is not proof that the machine has a working system TUN. Windows acceptance must verify the adapter, routes, DNS, external egress, and clean disconnect.

## Telegram bot findings

Sources read: public `README.md`, `.env.example`, `config.py`, `xui_client.py`, `handlers/auth.py`, `subscription.py`, `constants.py`, `database.py`, `main.py`.

- The bot is a separate sales/support/provisioning service: Python 3.11, aiogram 3, SQLite, FastAPI webhooks/workers, 3x-ui (`py3xui`), YooKassa and optional Crypto Bot.
- The bot's own README describes payment → subscription provisioning → delivery of a connection/subscription link. It is not the Android client's REST API implementation.
- `config.py` fixes issuance to four 3x-ui inbound IDs (`12,13,14,15`) and labels them Germany-1..4; this is bot provisioning policy and does not establish the desktop `/servers` response or list of client-selectable API nodes.
- `constants.py` defines trial/pricing/device tiers. Values in the Android screenshots differ from some bot defaults and values read from client-side plan parsing. Windows must use live `/plans` data rather than hard-code screenshot prices.
- `handlers/auth.py` implements email-code linking of existing ByMeVPN clients to Telegram accounts; it is not the same flow as Android email/password JWT login.
- Bot `.env.example` contains configuration names and placeholders only. No credentials or private deployment values were copied into this project.

## API verification boundary

The source reveals the client contract, but these repositories do not contain the server application that implements `api.parahin.space`. A read-only `GET /plans` from this environment timed out after 12 seconds. Until the API owner/operator confirms deployment behavior or the endpoints can be exercised with a legitimate test account, the desktop client must treat response shapes and entitlement semantics as source-derived expectations, not independently verified live contracts.

The bot repository has no `/api/v1/auth/*`, `/api/v1/servers`, `/api/v1/vpn/session`, or `/api/v1/subscription/*` implementation. Its FastAPI service handles Telegram/payment webhooks, while customer API/auth code is outside these two repositories.

## Xray and Windows tunnel evidence

The official Xray TUN documentation says Windows is supported and requires the architecture-matched `wintun.dll` beside `xray.exe`. The Xray config owns creation of the Wintun adapter. This is the preferred route over pretending that a local SOCKS proxy is a system VPN. Sources: [Xray TUN inbound documentation](https://github.com/XTLS/Xray-docs-next/blob/main/docs/en/config/inbounds/tun.md), [Xray TUN implementation README](https://github.com/XTLS/Xray-core/blob/main/proxy/tun/README.md).

## User-provided design references

The ten attached screenshots define welcome, sign-in, sign-up, disconnected, connected, server selection, account, tariffs, and settings. The Windows design should retain the dark navy-green palette, shield/infinity mark, bright green primary actions, and sidebar structure, while improving hierarchy, readable scale, keyboard access, and loading/error/empty states.
