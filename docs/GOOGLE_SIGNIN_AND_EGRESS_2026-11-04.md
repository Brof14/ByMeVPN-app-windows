# Windows Google login & IPv4 egress diagnostics — 2026-11-04

## Root cause of IP check failure
The prior Windows runtime checked only three external HTTPS IPv4 services, sequentially. If all returned errors after Xray launched, the client terminated Xray and claimed that the VPN had failed, even though this result was **not proof of a tunnel failure or leak**.

This patch concurrently probes six providers, including AWS and Cloudflare trace. Results:
- Verified: post-connect IPv4 differs from pre-connect IPv4, a limited sanity check.
- Observed leak: pre-connect IPv4 was actually observed after connect; stop Xray.
- Unavailable: all probes failed. Keep Xray running but explicitly display **IP not verified**, suppress protection badges, and retry. **Unknown is not secure**. For sensitive use, disconnect until end-to-end routing is verified.

These probes alone do not establish IPv6, DNS, kernel-level kill switch or leak-free operation. Windows networking acceptance is still required.

## Google Desktop OAuth (backend + app)
Android obtains a signed Google ID token via Credential Manager and the ByMeVPN server nonce. Windows uses the system browser and Google's officially supported Desktop OAuth Authorization Code flow with S256 PKCE and ephemeral localhost callback.

The native Windows process obtains the server nonce and Desktop Client ID, creates an unpredictable state and code verifier, validates the callback, exchanges the authorization code for an ID token over HTTPS, and submits the ID token + nonce to the ByMeVPN backend for signature, exact audience, issuer, expiry, email verification and nonce verification. Google tokens never enter the WebView.

## Mandatory setup by the owner
1. In the **same Google Cloud project** as the Android Web OAuth client, create a NEW OAuth 2.0 Client ID with application type **Desktop app**. The Android client ID must remain unchanged.
2. Deploy the ByMeVPN_bot backend commit containing Windows Desktop audience support.
3. Set GOOGLE_DESKTOP_CLIENT_ID on the backend to the new Desktop client ID; retain GOOGLE_SIGNIN_ENABLED=1 and GOOGLE_WEB_CLIENT_ID. Restart the API service.
4. Check https://bymevpn.duckdns.org/api/v1/auth/google/desktop-client returns a JSON object containing client_id. HTTP 503 indicates incomplete configuration.
5. Install the latest Windows preview and test real Google sign-in, cancel, wrong nonce/replay, logout and subscription/device refresh on Windows 10/11.

Do not commit Google OAuth client secrets or try to reuse the Android Web Client ID as a Desktop Client ID. Desktop app credentials are public clients and PKCE does not require embedding a secret.

Official Google documentation: https://developers.google.com/identity/protocols/oauth2/native-app

Until a real Desktop OAuth client ID is created and the server is deployed, the Google button will explain that configuration is missing; code alone cannot activate Google OAuth. This flow and the VPN tunnel remain unverified on a real customer machine.
