import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const source = read('ui/app.js');
const html = read('ui/index.html');
const css = read('ui/styles.css');

function harness(native = async () => null, overrides = {}) {
  const calls = [];
  const controls = new Map();
  const document = {
    documentElement: { lang: 'ru' },
    activeElement: null,
    addEventListener() {},
    getElementById: id => {
      if (id === 'page-title') return { textContent: '' };
      return overrides.elements?.get(id) || null;
    },
    querySelectorAll: selector => selector === '.sidebar-tab' ? controls.get('tabs') || [] : [],
    querySelector: selector => selector === '.version-num' ? overrides.version || null : null
  };
  const sandbox = createContext({
    console, document, navigator: { language: 'en-US' },
    window: { __TAURI__: { core: { invoke: async (command, args) => {
      calls.push({ command, args });
      return native(command, args);
    } } } },
    setTimeout, clearTimeout, setInterval: overrides.setInterval || (() => 37),
    clearInterval: overrides.clearInterval || (() => {})
  });
  runInContext(source, sandbox);
  return { eval: code => runInContext(code, sandbox), calls, document, controls };
}

test('Android bottom tabs appear in the same Home / Settings / Account order', () => {
  const nav = html.match(/<nav class="sidebar-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(nav, 'missing bottom navigation');
  const order = [...nav.matchAll(/data-tab="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(order, ['tab-home', 'tab-settings', 'tab-account']);
  assert.match(css, /Android Compose navigation parity for the desktop WebView/);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /height: calc\(100% - 66px\)/);
});

test('a secondary page retains its Android parent tab and aria-current', () => {
  const app = harness();
  const tabs = ['tab-home', 'tab-settings', 'tab-account'].map(id => {
    const attrs = new Map();
    return {
      dataset: { tab: id }, attrs,
      classList: { toggle(name, value) { this[name] = value; } },
      setAttribute(name, value) { attrs.set(name, value); },
      removeAttribute(name) { attrs.delete(name); }
    };
  });
  app.controls.set('tabs', tabs);
  for (const [page, expected] of [
    ['tab-pricing', 'tab-home'],
    ['tab-servers', 'tab-home'],
    ['tab-devices', 'tab-account'],
    ['tab-renewal', 'tab-account'],
    ['tab-support', 'tab-account'],
    ['tab-advanced', 'tab-settings']
  ]) {
    app.eval('switchTab(' + JSON.stringify(page) + ')');
    assert.equal(tabs.filter(tab => tab.attrs.get('aria-current') === 'page').length, 1);
    assert.equal(tabs.find(tab => tab.attrs.has('aria-current')).dataset.tab, expected);
  }
});

test('Windows autostart registry state is rolled back if settings persistence fails', async () => {
  const app = harness(async (command, args) => {
    if (command === 'save_setting') throw Error('disk full');
    if (command === 'set_startup') return null;
  });
  await app.eval("handleSettingChange('autoStart', true)");
  assert.deepEqual(app.calls.map(({ command, args }) => [command, args.enabled]), [
    ['set_startup', true], ['save_setting', undefined], ['set_startup', false]
  ]);
  assert.equal(app.eval('state.settings.autoStart'), false);
});

test('browser failure keeps the Telegram auth session actionable', async () => {
  const app = harness(async command => {
    if (command === 'telegram_create_session') {
      return { session_token: 'test-ticket', bot_url: 'https://t.me/ByMeVPNbot' };
    }
    if (command === 'open_external_url') throw Error('browser disabled');
  });
  await app.eval('startTelegramAuthFlow()');
  assert.equal(app.eval('tgActiveToken'), 'test-ticket');
  assert.equal(app.eval('tgPollingInterval'), 37);
  assert.equal(app.eval('tgStarting'), false);
});

test('the in-app FAQ does not promise unsupported automatic cancellation or anonymity', () => {
  assert.doesNotMatch(html, /Отключить автопродление можно в любой момент/);
  assert.doesNotMatch(html, /неотличимым от посещения защищённых сайтов/);
  assert.match(source, /Условия платежей зависят от вашего заказа/);
});

test('version text follows the chosen language without changing the real build number', () => {
  const version = { dataset: { appVersion: '1.2.3' }, textContent: '' };
  const app = harness(undefined, { version });
  app.eval("state.settings.language = 'en'");
  app.eval("applyLanguage('en')");
  assert.equal(version.textContent, 'Version 1.2.3');
  app.eval("state.settings.language = 'ru'");
  app.eval("applyLanguage('ru')");
  assert.equal(version.textContent, 'Версия 1.2.3');
  assert.match(html, /data-app-version="1\.2\.3"/);
});

test('Android system locale resolves English variants and defaults to Russian otherwise', () => {
  for (const [locale, expected] of [
    ['en', 'en'], ['en-US', 'en'], ['EN-gb', 'en'],
    ['ru-RU', 'ru'], ['de-DE', 'ru'], ['', 'ru']
  ]) {
    const app = harness();
    app.eval("state.settings.language = 'system'");
    app.eval('navigator.language = ' + JSON.stringify(locale));
    assert.equal(app.eval('effectiveLanguage()'), expected, 'locale ' + locale);
    assert.equal(app.eval("uiText('Привет', 'Hello')"), expected === 'en' ? 'Hello' : 'Привет');
  }
  assert.match(read('src-tauri/src/service.rs'), /"language": "system"/);
  assert.match(read('ui/index.html'), /data-lang="system"/);
});

test('translation resources cover all visible data-i18n anchors', () => {
  const keys = [...new Set([...html.matchAll(/data-i18n="([^"]+)"/g)].map(match => match[1]))];
  const app = harness();
  for (const locale of ['ru', 'en']) {
    for (const key of keys) {
      assert.equal(typeof app.eval('I18N.' + locale + '[' + JSON.stringify(key) + ']'),
        'string', 'missing ' + locale + ' translation: ' + key);
    }
  }
});

test('startup switch reflects Windows registry instead of stale settings.json', async () => {
  const app = harness(async command => {
    if (command === 'get_settings') return { autoStart: true, autoConnect: false, language: 'ru' };
    if (command === 'startup_enabled') return false;
    if (command === 'restore_session') return null;
    if (command === 'vpn_status') return { connected: false, verified: false };
    return null;
  });
  await app.eval('loadInitialData()');
  assert.equal(app.eval('state.settings.autoStart'), false);
  assert.ok(app.calls.some(call => call.command === 'startup_enabled'));
});

test('Android primary settings contains only everyday connection toggles and language', () => {
  const primary = html.split('id="tab-settings"')[1].split('id="tab-devices"')[0];
  const advanced = html.split('id="tab-advanced"')[1].split('<!-- MODALS')[0];
  for (const id of ['set-autoconnect', 'set-bypass']) {
    assert.match(primary, new RegExp('id="' + id + '"'));
    assert.doesNotMatch(advanced, new RegExp('id="' + id + '"'));
  }
  for (const id of ['set-autostart', 'set-background', 'set-killswitch', 'adblock-group', 'set-dns-mode']) {
    assert.match(advanced, new RegExp('id="' + id + '"'));
    assert.doesNotMatch(primary, new RegExp('id="' + id + '"'));
  }
  assert.match(primary, /class="lang-segmented-control"/);
  assert.match(primary, /id="row-open-advanced-settings"/);
  assert.match(css, /\.android-settings-essential \.setting-item-row/);
});

test('Windows never allocates a VPN session before checking the original egress route', () => {
  const rust = read('src-tauri/src/service.rs');
  const start = rust.indexOf('pub async fn vpn_start(');
  const baseline = rust.indexOf('let baseline_ip = crate::egress::public_egress_ip().await', start);
  const session = rust.indexOf('"/vpn/session"', start);
  assert.ok(start > 0 && baseline > start && session > baseline);
  const startup = rust.slice(session, rust.indexOf('pub async fn vpn_stop', session));
  // Cleanup is centralized around the fallible startup block, rather than
  // repeated in each error branch. This includes invalid Xray config.
  assert.match(startup, /let xray_config = build_tun_config_ext/);
  assert.match(startup, /let connection_result: Result<TunnelMetrics, String> = async \\{/);
  assert.match(startup, /if connection_result\\.is_err\\(\\) \\{[\\s\\S]*Method::DELETE, "\\/vpn\\/session"/);
});
