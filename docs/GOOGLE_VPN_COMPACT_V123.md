# ByMeVPN Windows v1.2.3 — compact UI, Google exchange and TUN diagnostics

## Scope

This branch improves diagnosability and latency; it **does not** claim that the
user's reported Google token exchange or Windows TUN failure is fixed on a real
machine. Both require fresh on-device results.

### Google sign-in

1. Server must return the Desktop OAuth client from
   `GET /api/v1/auth/google/desktop-client` and a nonce from
   `POST /api/v1/auth/google/nonce`.
2. Browser flow uses Desktop client, PKCE S256, random state, and local 127.0.0.1
   callback. The token exchange uses Google's documented optional
   `client_secret` omission; **no OAuth secret is shipped in the Windows app**.
3. The backend now optionally advertises `server_code_exchange: true` when
   `GOOGLE_DESKTOP_CLIENT_SECRET` is configured on VPS. Windows then sends the
   native authorization code + PKCE verifier + redirect URI + server nonce
   over the existing HTTPS API to `/auth/google/desktop-exchange`. The server
   performs the Google token exchange and the **existing** ID-token signature,
   audience, nonce replay and account checks. No secret ships in Windows.
4. Until the VPS is updated and configured, Windows retains the legacy native
   exchange. If the exchange fails, Windows reports only a known Google error
   code such as `invalid_client` or `invalid_grant`. Raw Google response
   bodies and tokens are not displayed or logged.
5. Retest on Windows after installing the **new** build. The specific returned
   code is necessary before choosing any credential/redirect/configuration
   change. Do not change Google Cloud clients based only on the previous
   generic banner.
6. If the consent screen is in Testing, the signing-in account must be on its
   tester list. Confirm both the Web client for Android and Desktop client
   are from the same intended Cloud project.

### VPN/TUN

- A successful Xray process launch does **not** prove protected traffic.
- Current TUN config requests IPv4+IPv6 OS routes, WFP DNS leak blocking
  and an automatic external outbound interface. Based on Android and official
  Xray TUN guidance, Windows now routes TUN port-53 DNS to an Xray DNS outbound
  and sends internal upstream DNS requests through VLESS. The config is tested
  using the bundled Xray executable. This still requires real-world DNS/IPv6
  leak testing on Windows.
- External HTTPS egress checks are bounded and concurrent. An unreachable
  probe means **unknown**, not verified. A verified unchanged baseline IP
  means a bypass and stops the tunnel.
- Xray's startup output is written locally to
  `%APPDATA%\space.parahin.bymevpn.desktop\xray_startup.log` or the
  Tauri app data directory reported by Windows. Check the actual app-data
  path if that guessed environment location does not exist.
- The log is overwritten on the next connection attempt; preserve a copy
  **locally**, redact domain names, tokens, server IPs and device identifiers
  before sharing.
- Read-only Windows diagnostics from a PowerShell terminal, **while the VPN
  is running**:

  ```powershell
  Get-NetAdapter | Where-Object Name -Match 'ByMeVPN|Wintun'
  Get-NetRoute -AddressFamily IPv4 | Where-Object DestinationPrefix -eq '0.0.0.0/0'
  Get-NetRoute -AddressFamily IPv6 | Where-Object DestinationPrefix -eq '::/0'
  Get-DnsClientServerAddress | Where-Object InterfaceAlias -Match 'ByMeVPN|Wintun'
  curl.exe -4 --max-time 8 https://api4.ipify.org
  ```

- Compare with the same public-IP check while the VPN is stopped.
  Report public IPs only when comfortable sharing them; never upload
  `active_tunnel.json`, since it may contain a VPN credential.
- WFP route setup, elevated permissions and DNS availability must be validated
  on a real Windows installation. Not running Xray as administrator may cause
  TUN setup to fail even if `xray run -test` succeeds.

### Efficiency and UI

- Default window 960 x 700, resizable with minimum 800 x 590.
- CSS compact layout uses narrower sidebar, smaller connection card and
  scrollable screens.
- HTTP client is reused (pooled connections).
- Connect no longer blocks on a TCP ping; a 45-second ping cache runs through
  the existing status poll.
- Visible UI status polling is every five seconds; the native watchdog
  remains active when the window is hidden.
- Initial external IPv4 verification makes two bounded attempts; if both
  fail, UI stays unverified and the watchdog retries.
- Do **not** claim an improvement in real VPN throughput or leak prevention
  without physical testing. Measure on the same server/network before/after.

## Acceptance criteria

1. CI: JS contracts, Rust unit tests, Tauri EXE/MSI builds and package smoke.
2. On-device: Google consent -> callback -> ByMeVPN user session.
3. On-device: Xray process -> actual OS route -> encrypted IPv4/IPv6 and
   non-leaking DNS -> changed public egress, including reconnect and
   network changes.
4. On-device: compact window at its minimum and default size; all pages and
   controls are accessible.
