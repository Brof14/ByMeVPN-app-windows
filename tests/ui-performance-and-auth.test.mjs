import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const js = read('ui/app.js');
const css = read('ui/styles.css');

function makeHarness() {
  const sandbox = createContext({
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      documentElement: { lang: 'ru' }
    },
    navigator: { language: 'ru-RU' },
    window: {},
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  });
  runInContext(js, sandbox);
  return { run: code => runInContext(code, sandbox) };
}

test('server search text survives latency updates and language changes', () => {
  const app = makeHarness();
  app.run("state.servers = [{ code: 'de', name: 'Германия' }]; filterServers('гер');");
  assert.equal(app.run('state.serverSearchQuery'), 'гер');
  app.run('renderServersList();');
  assert.equal(app.run('state.serverSearchQuery'), 'гер');
});

test('latency values keep their Android-aligned presentation states', () => {
  const app = makeHarness();
  assert.equal(app.run('serverLatencyPresentation({ ping: 42 }).tone'), 'measured');
  assert.equal(app.run('serverLatencyPresentation({ ping: 42 }).label'), '42 ms');
  assert.equal(app.run('serverLatencyPresentation({ ping: -2 }).tone'), 'failed');
  assert.equal(app.run('serverLatencyPresentation({ ping: -3 }).tone'), 'checking');
  assert.equal(app.run('serverLatencyPresentation({ ping: -4 }).tone'), 'queued');
  assert.equal(app.run('serverLatencyPresentation({ ping: 0 }).tone'), 'unknown');
  // A missing list must not throw while the server screen is closed.
  assert.equal(app.run("updateServerLatencyCard({ code: 'de', ping: 12 })"), undefined);
});

test('each latency event patches one row instead of rebuilding the catalog', () => {
  const start = js.indexOf("await events.listen('server-latency-update'");
  assert.ok(start > 0, 'latency listener missing');
  const listener = js.slice(start, js.indexOf('});', start) + 3);
  assert.doesNotMatch(listener, /renderServersList\(/);
  assert.match(listener, /updateServerLatencyCard\(updated\)/);
  assert.match(listener, /scheduleVpnUiUpdate\(\)/);
  assert.match(js, /function renderServersList\(filter = state\.serverSearchQuery\)/);
});

test('overlapping account refreshes share one native request', () => {
  assert.match(js, /const pending = accountSnapshotInFlight;/);
  assert.match(js, /if \(pending\?\.epoch === epoch\)/);
  assert.match(js, /if \(notify\) pending\.notify = true;/);
  assert.match(js, /if \(accountSnapshotInFlight === entry\) accountSnapshotInFlight = null;/);
  assert.match(js, /if \(entry\.notify\) showToast\('Данные аккаунта обновлены'\)/);
});

test('sign-in errors render beside the field and the retry panel can appear', () => {
  assert.match(js, /function setFieldError\(errorId, message, inputId = ''\)/);
  assert.match(js, /setFieldError\('login-auth-error', message\)/);
  assert.match(js, /setFieldError\('register-auth-error', message\)/);
  assert.match(js, /setFieldError\('register-password-confirm-error'/);
  assert.match(js, /function validEmailFormat\(email\)/);
  assert.match(js, /recovery\?\.classList\.toggle\('hidden', !restoreFailed\)/);
  assert.doesNotMatch(js, /btn\.textContent = visible \? '🙈' : '👁'/);
});

test('auth field icons are bounded and feedback styles exist', () => {
  assert.match(css, /\.field-icon\s*\{[^}]*width:\s*18px/s);
  assert.match(css, /\.btn-password-toggle svg\s*\{[^}]*width:\s*18px/s);
  assert.match(css, /\.btn-password-toggle\[aria-pressed="true"\] \.auth-eye-slash\s*\{\s*display:\s*inline/s);
  assert.match(css, /\.auth-form-error\s*\{[^}]*border-radius:\s*10px/s);
  assert.match(css, /\.auth-field-error,\s*\n\.auth-form-error\s*\{[^}]*color:\s*#ff8f96/s);
});

test('stylesheet declarations stay valid after the palette migration', () => {
  for (const file of ['ui/styles.css', 'ui/mobile-parity.css', 'ui/desktop-layout.css']) {
    const sheet = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    // A colour token followed by a bare alpha (e.g. `#031326, 0.65)`) is not a
    // valid CSS colour and silently drops the whole declaration.
    assert.doesNotMatch(sheet, /#[0-9a-fA-F]{6},\s*[0-9.]+\)/, file);
    assert.equal((sheet.match(/\{/g) || []).length, (sheet.match(/\}/g) || []).length, file);
    assert.doesNotMatch(sheet, /\b(?:#69d3bc|#69c8d8|#090f1d|#121c2b)\b/i, file);
  }
});
