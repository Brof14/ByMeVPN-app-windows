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
  assert.match(rust, /Err\(EgressFailure::Unavailable\) => \{/);
  assert.match(rust, /active\.egress_verified = false/);
  assert.match(rust, /Err\(EgressFailure::Unchanged\) => \{/);
  assert.match(rust, /let _ = active\.child\.kill\(\)/);
});

test('VPN UI only claims protection when native egress verification passed', () => {
  assert.match(rust, /pub verified: bool/);
  assert.match(ui, /state\.vpnVerified = metrics\?\.verified === true/);
  assert.match(ui, /state\.vpnVerified = status\.verified === true/);
  assert.match(ui, /status\?\.connected === true && status\?\.verified === true/);
  assert.match(ui, /VPN запущен — IP не подтверждён/);
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
