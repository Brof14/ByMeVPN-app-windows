import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const source = read('ui/app.js');
const html = read('ui/index.html');
const css = read('ui/styles.css');
const parityCss = read('ui/mobile-parity.css');
const native = read('src-tauri/src/service.rs');
const nativeMain = read('src-tauri/src/main.rs');

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
  assert.match(parityCss, /\.app-shell-layout \.page-title\s*\{[^}]*font-size:\s*27px;[^}]*font-weight:\s*600;[^}]*letter-spacing:\s*-1\.15px/);
  assert.match(parityCss, /\.app-shell-layout \.switch-control input:checked \+ \.switch-slider\s*\{[^}]*background:\s*#71d0c4/);
  assert.match(parityCss, /\.app-shell-layout \.switch-control input:checked \+ \.switch-slider::before\s*\{[^}]*background:\s*#0a2230/);
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

test('Support preserves the Android source tab and returns there on Back', () => {
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
  for (const sourceTab of ['tab-home', 'tab-account']) {
    app.eval(`state.currentTab=${JSON.stringify(sourceTab)}; openSupportScreen()`);
    assert.equal(app.eval('state.supportReturnTab'), sourceTab);
    assert.equal(tabs.find(tab => tab.attrs.has('aria-current')).dataset.tab, sourceTab);
    app.eval('handlePageBack()');
    assert.equal(app.eval('state.currentTab'), sourceTab);
  }
});

test('Support page follows current Android Telegram hero, email row, and information groups', () => {
  const support = html.slice(html.indexOf('id="tab-support"'), html.indexOf('id="tab-advanced"'));
  assert.match(support, /id="btn-open-support-telegram"/);
  assert.match(support, /support_contact_desc/);
  assert.match(support, /id="card-support-email"/);
  assert.match(support, /support_faq_title/);
  assert.match(support, /support_legal/);
  assert.match(support, /class="version-num"/);
  assert.doesNotMatch(support, /support_bonus_explained|support-news|card-support-channel/);
  assert.match(source, /https:\/\/t\.me\/ByMeVPNSupportBot/);
  assert.match(source, /invoke\('open_support_email', \{ isRussian: effectiveLanguage\(\) === 'ru' \}\)/);
  assert.match(nativeMain, /service::open_support_email/);
  assert.match(native, /mailto:support@bymevpn\.com\?subject=ByMeVPN%20support/);
});

test('FAQ follows the current Android five-question single-open accordion', () => {
  const faq = html.slice(html.indexOf('id="modal-faq"'), html.indexOf('<!-- Legal Terms/Privacy Modal -->'));
  assert.equal((faq.match(/class="faq-accordion-item"/g) || []).length, 5);
  assert.match(faq, /data-i18n="faq_subtitle"/);
  assert.match(faq, /aria-expanded="false"/);
  assert.match(faq, /id="faq-answer-5"/);
  assert.match(source, /function nextFaqExpandedIndex\(expandedIndex, selectedIndex\)/);
  assert.match(source, /aria-expanded/);
  assert.match(parityCss, /#modal-faq \.faq-item-body\s*\{[^}]*display:\s*none/);
  assert.match(parityCss, /#modal-faq \.faq-accordion-item\.expanded \.faq-item-body/);
  const app = harness();
  assert.equal(app.eval('nextFaqExpandedIndex(null,0)'), 0);
  assert.equal(app.eval('nextFaqExpandedIndex(0,0)'), null);
  assert.equal(app.eval('nextFaqExpandedIndex(0,1)'), 1);
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

test('auto reconnect remains visible in the UI after a drop and recognizes recovery', async () => {
  const callbacks = [];
  const replies = [
    { connected: false, proof: 'disconnected' },
    { connected: true, verified: true, connected_seconds: 1 }
  ];
  const app = harness(async command => command === 'vpn_status' ? replies.shift() : null, {
    setInterval: callback => { callbacks.push(callback); return callbacks.length; },
    clearInterval() {}
  });
  app.eval("state.user = { id: 'user' }; state.settings.autoReconnect = true; state.vpnConnected = true; startStatusPolling()");
  await callbacks[0]();
  assert.equal(app.eval('state.vpnConnected'), false);
  assert.equal(app.eval('state.reconnectPending'), true);
  assert.equal(app.eval('state.vpnPhase'), 'reconnecting');
  assert.notEqual(app.eval('state.pollInterval'), null);
  await callbacks[0]();
  assert.equal(app.eval('state.vpnConnected'), true);
  assert.equal(app.eval('state.reconnectPending'), false);
  assert.equal(app.eval('state.vpnPhase'), 'connected');
  assert.equal(app.eval('state.vpnVerified'), true);
  assert.equal(app.eval('state.connectionError'), null);
});

test('auto reconnect does not show a false recovery state before any connection', async () => {
  const callbacks = [];
  const app = harness(async () => ({ connected: false, proof: 'disconnected' }), {
    setInterval: callback => { callbacks.push(callback); return callbacks.length; },
    clearInterval() {}
  });
  app.eval("state.user = { id: 'user' }; state.settings.autoReconnect = true; startStatusPolling()");
  await callbacks[0]();
  assert.equal(app.calls.filter(call => call.command === 'vpn_status').length, 0);
  assert.equal(app.eval('state.reconnectPending'), false);
  assert.equal(app.eval('state.vpnPhase'), 'idle');
});

test('the power control cancels pending automatic retries on manual disconnect', async () => {
  const app = harness(async () => null);
  app.eval("state.user = { id: 'user' }; state.subscription = { status: 'active' }; state.reconnectPending = true; state.vpnPhase = 'reconnecting'");
  await app.eval('toggleVpn()');
  assert.deepEqual(app.calls.map(call => call.command), ['vpn_stop']);
  assert.equal(app.eval('state.reconnectPending'), false);
  assert.equal(app.eval('state.vpnConnected'), false);
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
  assert.match(source, /auto_renew_note: 'Проверьте условия продления перед оплатой/);
  assert.doesNotMatch(source, /Условия платежей зависят от вашего заказа/);
});

test('version text follows the chosen language without changing the real build number', () => {
  const version = { dataset: { appVersion: '1.2.15' }, textContent: '' };
  const app = harness(undefined, { version });
  app.eval("state.settings.language = 'en'");
  app.eval("applyLanguage('en')");
  assert.equal(version.textContent, 'Version 1.2.15');
  app.eval("state.settings.language = 'ru'");
  app.eval("applyLanguage('ru')");
  assert.equal(version.textContent, 'Версия 1.2.15');
  const buildVersion = JSON.parse(read('src-tauri/tauri.conf.json')).version;
  assert.ok(html.includes(`data-app-version="${buildVersion}"`));
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
  const missing = [];
  for (const locale of ['ru', 'en']) {
    for (const key of keys) {
      if (typeof app.eval('I18N.' + locale + '[' + JSON.stringify(key) + ']') !== 'string') {
        missing.push(locale + ': ' + key);
      }
    }
  }
  assert.deepEqual(missing, [], 'missing visible translations');
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

test('Android primary settings contains the three everyday connection toggles and language', () => {
  const primary = html.split('id="tab-settings"')[1].split('id="tab-devices"')[0];
  const advanced = html.split('id="tab-advanced"')[1].split('<!-- MODALS')[0];
  for (const id of ['set-autoconnect', 'set-autoreconnect', 'set-bypass']) {
    assert.match(primary, new RegExp('id="' + id + '"'));
    assert.doesNotMatch(advanced, new RegExp('id="' + id + '"'));
  }
  for (const id of ['set-autostart', 'set-background', 'set-killswitch', 'adblock-group', 'set-dns-mode']) {
    assert.match(advanced, new RegExp('id="' + id + '"'));
    assert.doesNotMatch(primary, new RegExp('id="' + id + '"'));
  }
  assert.match(primary, /id="btn-language-dialog"/);
  assert.doesNotMatch(primary, /class="lang-segmented-control"/);
  assert.match(html, /id="modal-language"/);
  assert.match(html, /class="lang-segmented-control"/);
  assert.match(primary, /id="row-open-advanced-settings"/);
  assert.match(css, /\.android-settings-essential \.setting-item-row/);
  assert.doesNotMatch(html.match(/id="set-background"[^>]*>/)?.[0] || '', /disabled/);
  assert.match(source, /set-background.*handleSettingChange\('stayConnectedInBackground'/);
});

test('Android account places devices, plans, and renewal in the management group', () => {
  const account = html.slice(html.indexOf('id="tab-account"'), html.indexOf('id="tab-settings"'));
  const settings = html.slice(html.indexOf('id="modal-account-settings"'), html.indexOf('id="modal-language"'));
  assert.match(account, /id="btn-acc-open-devices"/);
  assert.match(account, /id="btn-account-open-pricing"[\s\S]*?data-i18n="account_manage_plans"[\s\S]*?account_manage_plans_desc/);
  assert.match(account, /id="btn-account-open-renewal"[\s\S]*?data-i18n="account_manage_renewal"[\s\S]*?account_manage_renewal_desc/);
  assert.match(account, /id="btn-account-settings-open"/);
  assert.doesNotMatch(settings, /btn-account-open-pricing|btn-account-open-renewal|account-summary-/);
  assert.match(settings, /class="account-settings-profile-card"[\s\S]*?account-settings-profile-name[\s\S]*?account-settings-profile-email/);
  assert.match(settings, /id="btn-account-password-reset"/);
  assert.match(settings, /id="btn-acc-open-support"/);
  assert.match(settings, /id="btn-account-refresh"[\s\S]*?id="btn-acc-logout"[\s\S]*?id="btn-acc-delete"/);
  assert.match(source, /btn-account-open-pricing.*openPricingScreen/);
  assert.match(source, /btn-account-open-renewal[\s\S]*?switchTab\('tab-renewal'\)[\s\S]*?refreshRenewal\(\)/);
});

test('VPN captures original egress before starting the full tunnel and rolls back failed sessions', () => {
  const rust = read('src-tauri/src/service.rs');
  const start = rust.indexOf('pub async fn vpn_start(');
  const startupHeader = rust.slice(start, rust.indexOf('let connection_result:', start));
  assert.ok(start > 0);
  const baselineStart = startupHeader.indexOf('let baseline_task = tauri::async_runtime::spawn');
  const session = rust.indexOf('"/vpn/session"', start);
  const startup = rust.slice(session, rust.indexOf('pub async fn vpn_stop', session));
  const baselineAwait = startup.indexOf('let baseline_ip = baseline_task.await');
  const preflightEnd = startup.indexOf('if !preflight_server_reachable');
  const fullTunnelStart = startup.indexOf(
    'let mut child = match std::process::Command::new(runtime_dir.join("xray.exe"))', baselineAwait
  );
  assert.ok(baselineStart >= 0 && baselineStart < session - start,
    'capture baseline while session and no-TUN preflight start');
  assert.ok(preflightEnd >= 0 && baselineAwait > preflightEnd,
    'await baseline after no-TUN preflight to keep setup responsive');
  assert.ok(fullTunnelStart > baselineAwait,
    'never start the TUN until the original egress capture has completed');
  assert.ok(session > start);
  // Any post-session failure, including invalid Xray config, must revoke it.
  assert.ok(startup.includes('let mut xray_config = build_tun_config_ext('));
  assert.ok(startup.includes('add_attestation_http_inbound('));
  assert.ok(startup.includes('let connection_result: Result<TunnelMetrics, String> = async {'));
  const rollback = startup.indexOf('if connection_result.is_err() {');
  assert.ok(rollback > 0, 'missing shared startup-failure handler');
  assert.match(startup.slice(rollback), /request_in_session\([\s\S]*?Method::DELETE,\s*"\/vpn\/session"[\s\S]*?Some\(generation\)/);
});
