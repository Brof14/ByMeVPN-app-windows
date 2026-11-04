import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');

// Android V2: GET /mobile/v2/plans?devices=2,5,10.
const canonical = [
  { sku: '1m', days: 30, options: [89, 109, 129] },
  { sku: '3m', days: 120, options: [316, 396, 476] },
  { sku: '6m', days: 240, options: [552, 712, 872] },
  { sku: '12m', days: 450, options: [885, 1185, 1485] }
].flatMap(plan => [2, 5, 10].map((devices, index) => ({
  code: plan.sku + '_d' + devices,
  devices, days: plan.days, price_rub: plan.options[index],
  purchase_enabled: true
})));

function harness(getPlans = async () => canonical, overrides = {}) {
  const context = {
    console,
    document: {
      addEventListener() {},
      getElementById(id) { return id === 'page-title' ? { textContent: '' } : null; },
      querySelectorAll() { return []; }
    },
    window: { __TAURI__: { core: { invoke: async (cmd) => {
      if (Object.hasOwn(overrides, cmd)) return await overrides[cmd]();
      if (cmd === 'get_plans') return await getPlans();
      if (cmd === 'get_servers') return [];
      return null;
    } } } },
    setTimeout, clearTimeout, setInterval, clearInterval
  };
  const sandbox = createContext(context);
  runInContext(source, sandbox);
  return { eval: code => runInContext(code, sandbox) };
}

test('all external links pass through the validated native Tauri broker', () => {
  assert.doesNotMatch(source, /window\.open\s*\(/);
  assert.match(source, /invoke\('open_external_url'/);
});

test('pending invoice survives app restart and is bound to the backend invoice', () => {
  const native = readFileSync(new URL('../src-tauri/src/service.rs', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
  assert.match(native, /PENDING_PAYMENT_KEY: &str = "pending_payment"/);
  assert.match(native, /save_secret\(PENDING_PAYMENT_KEY/);
  assert.match(native, /pub fn get_pending_payment\(\) -> Option<Value>/);
  assert.match(native, /clear_pending_payment\(\)/);
  assert.match(native, /payment_url_is_allowed/);
  assert.match(source, /invoke\('get_pending_payment'\)/);
  assert.match(source, /recovered\?\.invoice_id/);
  assert.match(app, /service::get_pending_payment/);
});

test('Telegram login wait expires after five minutes and revokes the native ticket', () => {
  assert.match(source, /const TG_SESSION_TIMEOUT_MS = 5 \* 60 \* 1000/);
  assert.match(source, /Date\.now\(\) - tgPollingStartedAt >= TG_SESSION_TIMEOUT_MS/);
  assert.match(source, /cancelTelegramPolling\(\);/);
  assert.match(source, /telegram_cancel_session/);
});

test('legacy subscription links cannot fabricate account activation', () => {
  const html = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
  const native = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /invoke\('telegram_login'/);
  assert.doesNotMatch(html, /id="btn-submit-manual-key"|id="btn-submit-tg-login"/);
  assert.doesNotMatch(native, /service::telegram_login,/);
  assert.match(source, /telegram_create_session/);
  assert.match(source, /telegram_check_session/);
});

test('checkout never displays historical prices before server verification', () => {
  const html = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
  for (const id of ['price-month', 'price-quarter', 'price-half_year', 'price-year']) {
    assert.match(html, new RegExp('id="' + id + '">—</strong>'));
  }
  assert.doesNotMatch(html, /class="tariff-price-bold">(?:89|885)\s*₽/);
  assert.match(source, /purchaseEnabled === true/);
});

test('production UI fails closed without Tauri rather than pretending to use a VPN', async () => {
  const context = createContext({
    console,
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    window: {},
    setTimeout, clearTimeout, setInterval, clearInterval
  });
  runInContext(source, context);
  await assert.rejects(runInContext("invoke('vpn_start')", context),
    /должно быть открыто через Windows-клиент/);
  await assert.rejects(runInContext("invoke('auth_login')", context),
    /должно быть открыто через Windows-клиент/);
});

test('Android V2 exact SKU prices, device counts and gift durations are confirmed', async () => {
  const app = harness();
  await app.eval('loadPricingCatalog()');
  const result = JSON.parse(app.eval('JSON.stringify({ ready: state.catalogReady, price: PRICING_MATRIX[2].year.price, days: PRICING_MATRIX[2].year.days, bigger: PRICING_MATRIX[10].quarter.price, sku: PRICING_MATRIX[5].year.planCode, checkout: PRICING_MATRIX[5].year.purchaseEnabled })'));
  assert.deepEqual(result, {
    ready: true, price: 885, days: 450, bigger: 476,
    sku: '12m_d5', checkout: true
  });
});

test('verified device-specific offers do not generate prices for absent tiers', async () => {
  const onlyTwo = canonical.filter(p => p.devices === 2);
  const app = harness(async () => onlyTwo);
  await app.eval('loadPricingCatalog()');
  const result = JSON.parse(app.eval('JSON.stringify({ready: state.catalogReady, available: state.availableDeviceCounts, price: PRICING_MATRIX[2].quarter.price, missing: PRICING_MATRIX[5].quarter || null})'));
  assert.deepEqual(result, { ready: true, available: [2], price: 316, missing: null });
});

test('missing or false purchase_enabled permits showing price, not checkout', async () => {
  const disabled = canonical.map(p => ({ ...p, purchase_enabled: false }));
  const app = harness(async () => disabled);
  await app.eval('loadPricingCatalog()');
  const result = JSON.parse(app.eval('JSON.stringify({ready: state.catalogReady, price: PRICING_MATRIX[2].year.price, checkout: PRICING_MATRIX[2].year.purchaseEnabled})'));
  assert.deepEqual(result, { ready: true, price: 885, checkout: false });
  const noFlag = harness(async () => canonical.map(({purchase_enabled, ...p}) => p));
  await noFlag.eval('loadPricingCatalog()');
  assert.equal(noFlag.eval('PRICING_MATRIX[2].year.purchaseEnabled'), false);
});

test('legacy or mismatched Android V2 SKU codes cannot authorize checkout', async () => {
  const oldApi = [
    { code: '1m', price_rub: 89, days: 30, devices: 2, purchase_enabled: true },
    { code: '12m_d5', price_rub: 885, days: 450, devices: 2, purchase_enabled: true },
    { code: '3m_d2', price_rub: 316, days: 90, devices: 2, purchase_enabled: true }
  ];
  const app = harness(async () => oldApi);
  await app.eval('loadPricingCatalog()');
  assert.equal(app.eval('state.catalogReady'), false);
  assert.deepEqual(JSON.parse(app.eval('JSON.stringify(state.availableDeviceCounts)')), []);
});

test('incomplete server catalog cannot fabricate unavailable plan durations', async () => {
  const app = harness(async () => [canonical[0]]);
  await app.eval('loadPricingCatalog()');
  assert.equal(app.eval('state.catalogReady'), true);
  assert.deepEqual(JSON.parse(app.eval('JSON.stringify(state.availableDeviceCounts)')), [2]);
  assert.equal(app.eval('PRICING_MATRIX[2].year'), undefined);
});

test('full confirmed Android V2 catalog exposes all three device variants', async () => {
  const app = harness();
  await app.eval('loadPricingCatalog()');
  assert.deepEqual(JSON.parse(app.eval('JSON.stringify(state.availableDeviceCounts)')), [2, 5, 10]);
});

test('failed authenticated Android V2 catalog request blocks checkout', async () => {
  const app = harness(async () => { throw new Error('offline'); });
  await app.eval('loadPricingCatalog()');
  assert.equal(app.eval('state.catalogReady'), false);
});

test('payment and catalog endpoints track current Android V2 and reject stale payment contracts', () => {
  const native = readFileSync(new URL('../src-tauri/src/service.rs', import.meta.url), 'utf8');
  assert.match(native, /\/mobile\/v2\/plans\?devices=\{devices\}/);
  assert.match(native, /\/mobile\/v2\/payment\/create/);
  assert.match(native, /\/mobile\/v2\/payment\/check/);
  assert.doesNotMatch(native, /"\/payment\/create"/);
  assert.match(source, /selected\.purchaseEnabled !== true/);
  assert.match(source, /state\.pendingCheckout\.invoiceId/);
});

test('default state contains neither imaginary countries nor fake measured bandwidth', () => {
  const app = harness();
  assert.equal(app.eval('state.servers.length'), 0);
  assert.equal(app.eval('state.metrics.download_mbps'), 0);
  assert.equal(app.eval('state.selectedServer.code'), 'auto');
});

test('desktop defaults match Android V2: direct RU traffic, no unimplemented protection', () => {
  const app = harness();
  const snapshot = JSON.parse(app.eval(`JSON.stringify({
    bypassRu: state.settings.bypassRu,
    background: state.settings.stayConnectedInBackground,
    killSwitch: state.settings.killSwitch,
    adBlock: state.settings.adBlock,
    authBusy: state.authBusy,
    verified: state.vpnVerified
  })`));
  assert.deepEqual(snapshot, {
    bypassRu: true, background: false, killSwitch: false,
    adBlock: 'none', authBusy: false, verified: false
  });
});

test('cancelling Telegram login invalidates the outstanding session generation', () => {
  const app = harness();
  const old = app.eval('tgPollingGeneration');
  app.eval('cancelTelegramPolling()');
  assert.equal(app.eval('tgPollingGeneration'), old + 1);
});

test('a canceled Telegram ticket is revoked at the native IPC boundary', () => {
  const app = harness();
  app.eval("tgActiveToken = 'auth_test_token'");
  app.eval('cancelTelegramPolling()');
  assert.equal(app.eval('tgActiveToken'), null);
  assert.equal(app.eval('tgPollingInterval'), null);
  // Assert the user-visible handler cannot restore a canceled auth token.
  assert.match(readFileSync(new URL('../src-tauri/src/service.rs', import.meta.url), 'utf8'),
    /ticket\.as_deref\(\) != Some\(token\)/);
});

test('pricing matrix has no purchasable prices before live API validation', () => {
  const app = harness(async () => { throw new Error('offline'); });
  assert.equal(app.eval('PRICING_MATRIX[2].month'), undefined);
});

test('autoconnect is opt-in; never start a tunnel before session restoration', () => {
  const app = harness();
  assert.equal(app.eval('state.settings.autoConnect'), false);
  assert.equal(app.eval('state.settings.bypassRu'), true);
});

test('legal terms and privacy anchors remain clickable after translation', () => {
  const html = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="link-pricing-terms"[^>]*data-i18n="terms_link"/);
  assert.match(html, /id="link-pricing-privacy"[^>]*data-i18n="privacy_link"/);
  assert.doesNotMatch(html, /data-i18n="terms_agreement"/);
});

test('language resources cover server search and authentication field placeholders', () => {
  const app = harness();
  assert.equal(app.eval("I18N.en.email_placeholder"), "Email address");
  assert.equal(app.eval("I18N.en.server_search_placeholder"), "Search servers or countries...");
});

test('unknown subscription never incorrectly claims the account is unpaid', () => {
  const app = harness();
  const result = app.eval(`(() => {
    const elements = new Map();
    document.getElementById = (id) => {
      if (!elements.has(id)) elements.set(id, { textContent: '', className: '', querySelector() { return null; } });
      return elements.get(id);
    };
    state.settings.language = 'en';
    state.subscription = { status: 'unknown' };
    updateSubscriptionUi();
    return {
      title: elements.get('home-sub-title').textContent,
      badge: elements.get('home-sub-badge').textContent,
      expiry: elements.get('home-sub-expiry').textContent
    };
  })()`);
  assert.equal(result.title, 'Checking subscription');
  assert.equal(result.badge, 'Unknown');
  assert.equal(result.expiry, 'Subscription status unavailable');
});

test('English messaging never promises unsupported account auto-renew controls', () => {
  const app = harness();
  assert.match(app.eval('I18N.en.auto_renew_note'), /Contact support/);
  assert.doesNotMatch(app.eval('I18N.en.auto_renew_note'), /cancel at any time in account settings/i);
  app.eval("state.settings.language = 'en'");
  assert.equal(app.eval("localizedToast('VPN отключён')"), 'VPN disconnected.');
  assert.equal(app.eval("localizedToast('Выбран сервер: Germany')"), 'Server selected: Germany');
});

test('privacy and service summaries are bilingual and never promise unaudited zero logs', () => {
  const app = harness();
  const content = app.eval(`(() => {
    const elements = new Map();
    document.getElementById = (id) => {
      if (!elements.has(id)) elements.set(id, {
        textContent: '', innerHTML: '', classList: { remove() {} }
      });
      return elements.get(id);
    };
    state.settings.language = 'en';
    openLegalModal('privacy');
    const english = elements.get('legal-modal-body').innerHTML;
    state.settings.language = 'ru';
    openLegalModal('privacy');
    return { english, russian: elements.get('legal-modal-body').innerHTML };
  })()`);
  assert.match(content.english, /independently verified/);
  assert.match(content.russian, /независимую проверку/);
  assert.doesNotMatch(content.english, /We NEVER log/);
});

test('the Windows shield is byte-for-byte the approved Android V2 drawable', () => {
  const image = readFileSync(new URL('../ui/assets/byme-connect-shield.png', import.meta.url));
  const sha = createHash('sha1')
    .update(Buffer.from(`blob ${image.length}\0`))
    .update(image)
    .digest('hex');
  assert.equal(sha, 'b1b269246a75c21742ebc968cb2c3ad6893a73d8');
});

test('trial activation sends only one request even after rapid repeated clicks', async () => {
  let calls = 0;
  let settle;
  const pending = new Promise(resolve => { settle = resolve; });
  const app = harness(undefined, { activate_trial: async () => {
    calls += 1;
    return pending;
  } });
  app.eval("state.user = { id: 'account-A' }");
  const first = app.eval("handleActivateTrial()");
  const duplicate = app.eval("handleActivateTrial()");
  assert.equal(calls, 1);
  assert.equal(app.eval('state.trialBusy'), true);
  settle({ status: 'trial', max_devices: 2 });
  await Promise.all([first, duplicate]);
  assert.equal(app.eval('state.trialBusy'), false);
});

test('late trial confirmation cannot replace a different signed-in account', async () => {
  let settle;
  const pending = new Promise(resolve => { settle = resolve; });
  const app = harness(undefined, { activate_trial: async () => pending });
  app.eval("state.user = { id: 'account-A' }");
  const first = app.eval("handleActivateTrial()");
  app.eval("state.sessionEpoch += 1; state.user = { id: 'account-B' }; state.subscription = {status:'none'}");
  settle({ status: 'trial', max_devices: 2 });
  await first;
  assert.equal(app.eval('state.subscription.status'), 'none');
  assert.equal(app.eval('state.trialBusy'), false);
});

test('trial paywall remains open until server confirms trial activation', () => {
  const src = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
  assert.match(src, /getElementById\('btn-paywall-trial'\)\?\.addEventListener\('click', handleActivateTrial\)/);
  assert.match(src, /if \(!sameAccount\(\)\) return;/);
  assert.match(src, /setTrialPending\(true\)/);
});

test('trial errors use Android-aligned, language-specific recovery copy', () => {
  const app = harness();
  assert.match(app.eval("trialActivationMessage('(HTTP 409)')"), /уже использован/);
  assert.match(app.eval("trialActivationMessage('(HTTP 422)')"), /устройство/);
  assert.match(app.eval("trialActivationMessage('(HTTP 503)')"), /временно недоступен/);
  app.eval("state.settings.language = 'en'");
  assert.match(app.eval("trialActivationMessage('(HTTP 409)')"), /already used/);
  assert.match(app.eval("trialActivationMessage('(HTTP 401)')"), /session expired/);
  assert.match(app.eval("trialActivationMessage('NETWORK_ERROR')"), /internet connection/);
});

test('account deletion remains a support request, not a destructive native IPC', () => {
  const backend = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
  assert.doesNotMatch(backend, /service::delete_account,/);
  assert.doesNotMatch(source, /invoke\('delete_account'/);
  assert.match(source, /Automatic account deletion is not available yet/);
});
