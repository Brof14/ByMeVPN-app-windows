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
const html = read('ui/index.html');

test('external IP probe outage is not a proven leak', () => {
  assert.match(probes, /enum EgressFailure/);
  assert.match(probes, /Unavailable/);
  assert.match(probes, /Unchanged/);
  assert.match(probes, /https:\/\/www\.cloudflare\.com\/cdn-cgi\/trace/);
  assert.match(probes, /https:\/\/checkip\.amazonaws\.com/);
  assert.match(probes, /https:\/\/cp\.cloudflare\.com\/generate_204/);
  assert.match(probes, /https:\/\/www\.google\.com\/generate_204/);
  assert.match(probes, /pub async fn measure_xray_server_latency\(/);
  assert.match(probes, /SERVER_LATENCY_ENDPOINTS: \[&str; 2\]/);
  assert.match(probes, /average_server_latency_ms\(&measurements\)/);
  assert.match(probes, /JoinSet::new\(\)/);
  assert.match(probes, /PROBES\.iter\(\)\.take\(3\)/);
  assert.match(probes, /PROBES\.iter\(\)\.skip\(3\)/);
  assert.match(probes, /probe_https_reachability\(client\.clone\(\)\)/);
  assert.match(probes, /TrafficObservedUnverified/);
  assert.match(probes, /pub fn traffic_confirmed\(/);
  assert.match(rust, /verify_tunnel_path\(/);
  assert.match(rust, /active\.egress_verified = path_ready && result\.verified_ip\(\)\.is_some\(\)/);
  assert.match(rust, /if !proof\.traffic_confirmed\(\) \{/);
  assert.match(rust, /if !tunnel_ready \{/);
  assert.match(rust, /stop_failed_tun\(&mut child, &config_path\)\.await/);
  assert.match(rust, /let _ = active\.child\.kill\(\)/);
  assert.match(rust, /async fn stop_tunnel_and_restore_network\(/);
  assert.match(rust, /\.manually_stopped\(\);/);
  assert.match(main, /cleanup_bymevpn_routes_after_exit_sync\(\)/);
});

test('VPN UI only claims protection when native egress verification passed', () => {
  assert.match(rust, /pub verified: bool/);
  assert.match(ui, /state\.vpnVerified = metrics\?\.verified === true/);
  assert.match(ui, /state\.vpnVerified = status\.verified === true/);
  assert.match(ui, /status\?\.connected === true && status\?\.verified === true/);
  assert.match(ui, /uiText\('VPN подключён', 'VPN connected'\)/);
  assert.match(ui, /state\.vpnVerified \? uiText\('VPN подключён'/);
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

test('Google callback uses the ByMeVPN theme and does not force the account chooser', () => {
  assert.match(oauth, /text\/html; charset=utf-8/);
  assert.match(oauth, /Вход через Google подтверждён/);
  assert.match(oauth, /Google approved sign-in/);
  assert.match(oauth, /Content-Security-Policy/);
  assert.match(oauth, /#090f1d/i);
  assert.match(oauth, /#69d3bc/i);
  assert.doesNotMatch(oauth, /append_pair\("prompt", "select_account"\)/);
  assert.equal((html.match(/class="google-g-icon" viewBox="0 0 24 24"/g) || []).length, 2);
  assert.doesNotMatch(html, /<span class="google-g-icon">G<\/span>/);
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
  assert.match(rust, /add_attestation_http_inbound\(/);
  assert.match(rust, /verify_tunnel_path\(baseline_ip, probe_port, &probe_password\)/);
  assert.match(rust, /xray_startup\.log/);
  assert.match(rust, /cached_ping_ms/);
  const status = rust.split('pub async fn vpn_status(')[1].split('pub async fn auto_reconnect_if_due')[0];
  assert.doesNotMatch(status, /measure_real_ping\(/);
  assert.match(rust, /static API_CLIENT: OnceLock<Client>/);
  assert.match(probes, /timeout\(Duration::from_millis\(4500\)\)/);
});

test('desktop opens in a compact resizable window and UI polls conservatively', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  const w = config.app.windows[0];
  assert.ok(w.width <= 1100 && w.height <= 760);
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
