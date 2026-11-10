import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const rust = read('src-tauri/src/service.rs');
const oauth = read('src-tauri/src/google_desktop.rs');
const probes = read('src-tauri/src/egress.rs');
const ui = read('ui/app.js');
const css = read('ui/styles.css');
const main = read('src-tauri/src/main.rs');

test('external IP probe outage is not a proven leak', () => {
  assert.match(probes, /enum EgressFailure/);
  assert.match(probes, /Unavailable/);
  assert.match(probes, /Unchanged/);
  assert.match(probes, /https:\/\/www\.cloudflare\.com\/cdn-cgi\/trace/);
  assert.match(probes, /https:\/\/checkip\.amazonaws\.com/);
  assert.match(probes, /JoinSet::new\(\)/);
  assert.match(probes, /PROBES\.iter\(\)\.take\(3\)/);
  assert.match(probes, /PROBES\.iter\(\)\.skip\(3\)/);
  assert.match(rust, /EgressCheck::Unavailable/);
  assert.match(rust, /active\.egress_verified = false/);
  assert.match(rust, /EgressCheck::Unchanged => \{/);
  assert.match(rust, /let _ = active\.child\.kill\(\)/);
});

test('VPN UI only claims protection when native egress verification passed', () => {
  assert.match(rust, /pub verified: bool/);
  assert.match(ui, /state\.vpnVerified = metrics\?\.verified === true/);
  assert.match(ui, /state\.vpnVerified = status\.verified === true/);
  assert.match(ui, /status\?\.connected === true && status\?\.verified === true/);
  assert.match(ui, /uiText\('VPN запущен', 'VPN started'\)/);
  assert.match(ui, /verificationMark\.textContent = state\.vpnVerified \? '✓' : '·'/);
  assert.match(ui, /home-verification-notice/);
  assert.match(ui, /Защита не подтверждена/);
});

test('Google login never sends raw tokens through UI and uses native PKCE S256', () => {
  assert.match(main, /mod google_desktop;/);
  assert.match(main, /service::auth_google_desktop/);
  assert.match(rust, /"\/auth\/google\/desktop-client"/);
  assert.match(rust, /"\/auth\/google\/nonce"/);
  assert.match(rust, /"\/auth\/google"/);
  assert.match(oauth, /code_challenge_method", "S256"/);
  assert.match(oauth, /response_type", "code"/);
  assert.match(oauth, /scope", "openid email profile"/);
  assert.match(oauth, /"127\.0\.0\.1:0"/);
  assert.match(oauth, /CLIENT_ID_NOT_CONFIGURED|Google OAuth для Windows настроен неверно/);
  assert.match(oauth, /https:\/\/oauth2\.googleapis\.com\/token/);
  assert.match(oauth, /state_values\.len\(\) != 1/);
  assert.match(ui, /invoke\('auth_google_desktop'\)/);
  assert.doesNotMatch(ui, /invoke\('auth_google',\s*\{\s*idToken/);
  assert.ok(!ui.includes('Google-вход пока недоступен. Используйте Telegram или Email.'));
  assert.doesNotMatch(css, /display: none; \/\* Google OAuth remains disabled/);
});


test('native Google token failures report OAuth codes without echoing upstream descriptions', () => {
  assert.match(oauth, /fn token_exchange_error\(/);
  assert.match(oauth, /"invalid_client"/);
  assert.match(oauth, /"invalid_grant"/);
  assert.match(oauth, /"redirect_uri_mismatch"/);
  assert.match(oauth, /response\.json\(\)\.await\.unwrap_or\(Value::Null\)/);
  assert.doesNotMatch(oauth, /Google отклонил авторизацию\. Проверьте OAuth Client ID/);
});

test('VPN startup is bounded, logs native TUN failures, and avoids an eager extra ping', () => {
  assert.match(rust, /let startup_checks = if baseline_ip\.is_some\(\) \{ 3 \} else \{ 1 \};/);
  assert.match(rust, /xray_startup\.log/);
  assert.match(rust, /cached_ping_ms/);
  assert.match(rust, /last_ping_probe\.elapsed\(\) >= Duration::from_secs\(45\)/);
  assert.match(rust, /static API_CLIENT: OnceLock<Client>/);
  assert.match(probes, /timeout\(Duration::from_millis\(4500\)\)/);
});

test('desktop opens in a compact resizable window and UI polls conservatively', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  const w = config.app.windows[0];
  assert.ok(w.width <= 1000 && w.height <= 750);
  assert.ok(w.minWidth <= w.width && w.minHeight <= w.height);
  assert.notEqual(w.maximized, true);
  assert.match(ui, /\}, 5000\);\s*state\.pollInterval = interval;\s*\}\s*\/\/ Pause heavy polling/);
  assert.match(ui, /sequence !== state\.vpnSequence/);
  assert.match(ui, /state\.pollInterval !== interval/);
  assert.match(css, /Compact native desktop window/);
});


test('Desktop Google OAuth uses server-side exchange when securely configured', () => {
  assert.match(oauth, /pub struct AuthorizationCode/);
  assert.match(oauth, /pub async fn acquire_code\(/);
  assert.match(rust, /"server_code_exchange"/);
  assert.match(rust, /"\/auth\/google\/desktop-exchange"/);
  assert.match(rust, /"code_verifier": code\.code_verifier/);
  assert.match(rust, /"redirect_uri": code\.redirect_uri/);
  assert.match(rust, /"nonce": nonce/);
  assert.doesNotMatch(rust, /GOOGLE_DESKTOP_CLIENT_SECRET/);
});
