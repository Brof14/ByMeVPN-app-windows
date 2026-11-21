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
      querySelector() { return null; },
      querySelectorAll() { return []; }
    },
    window: { __TAURI__: { core: { invoke: async (cmd, args) => {
      if (Object.hasOwn(overrides, cmd)) return await overrides[cmd](args);
      if (cmd === 'get_plans') return await getPlans();
      if (cmd === 'get_servers') return [];
      return null;
    } } } },
    setTimeout: overrides.__setTimeout || setTimeout,
    clearTimeout: overrides.__clearTimeout || clearTimeout,
    setInterval, clearInterval
  };
  const sandbox = createContext(context);
  runInContext(source, sandbox);
  return { eval: code => runInContext(code, sandbox) };
}

test('all external links pass through the validated native Tauri broker', () => {
  assert.doesNotMatch(source, /window\.open\s*\(/);
  assert.match(source, /invoke\('open_external_url'/);
});

test('session recovery retries only a transient API outage once', () => {
  const app = harness();
  assert.equal(app.eval("isTransientSessionRestoreError('Не удалось связаться с ByMeVPN API: истекло время ожидания ответа')"), true);
  assert.equal(app.eval("isTransientSessionRestoreError('Запрос завершился ошибкой (HTTP 503)')"), true);
  assert.equal(app.eval("isTransientSessionRestoreError('Сеанс истёк. Войдите в аккаунт снова.')"), false);
  assert.match(source, /await new Promise\(resolve => setTimeout\(resolve, 450\)\)/);
  assert.match(source, /sessionRestoreErrorMessage\(restoreError\)/);
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

test('server catalog keeps a safe display-only cache when refresh fails', () => {
  const start = source.indexOf('async function loadAvailableServers(options = {})');
  const end = source.indexOf('async function fetchServerCatalog(epoch,', start);
  const loader = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(loader, /state\.servers\s*=\s*\[\]/);
  assert.match(loader, /state\.servers\s*=\s*readServerCatalogCache\(\)/);
  assert.match(source, /SERVER_CATALOG_CACHE_KEY/);
  assert.match(source, /function sanitizeCachedServerCatalog\(/);
  assert.doesNotMatch(source.slice(source.indexOf('function sanitizeCachedServerCatalog('), end), /config|uuid|password|public_key/);
});

test('concurrent server catalog loads share one request and forced probes run afterward', async () => {
  let releaseFirst;
  const firstRequest = new Promise(resolve => { releaseFirst = resolve; });
  const calls = [];
  const app = harness(undefined, {
    get_servers: async args => {
      calls.push(args);
      if (calls.length === 1) {
        await firstRequest;
        return [];
      }
      return [{ code: 'node-a', supported: true, ping: -3 }];
    }
  });
  const ordinary = app.eval('loadAvailableServers()');
  const forced = app.eval('loadAvailableServers({ forceProbe: true })');
  await Promise.resolve();
  assert.equal(calls.length, 1);
  releaseFirst();
  assert.deepEqual(await Promise.all([ordinary, forced]), [false, true]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].forceProbe, true);
});

test('server catalog retries a bounded number of times after temporary failure', async () => {
  const timers = [];
  let calls = 0;
  const app = harness(undefined, {
    get_servers: async () => {
      calls += 1;
      if (calls < 3) throw new Error('HTTP 403');
      return [{ code: 'node-a', supported: true }];
    },
    __setTimeout: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    __clearTimeout: id => { if (timers[id - 1]) timers[id - 1].cancelled = true; }
  });
  app.eval("state.user = { id: 'user-a' }; state.subscription = { status: 'active' }");
  assert.equal(await app.eval('loadAvailableServers()'), false);
  assert.equal(timers[0].delay, 8_000);
  await timers[0].callback();
  assert.equal(calls, 2);
  assert.equal(timers[1].delay, 30_000);
  await timers[1].callback();
  assert.equal(calls, 3);
  assert.equal(app.eval('state.servers.length'), 1);
  assert.equal(timers.length, 2);
});

test('a delayed server retry cannot cross into another signed-in account', async () => {
  const timers = [];
  let calls = 0;
  const app = harness(undefined, {
    get_servers: async () => { calls += 1; throw new Error('HTTP 403'); },
    __setTimeout: callback => { timers.push(callback); return timers.length; },
    __clearTimeout() {}
  });
  app.eval("state.user = { id: 'user-a' }; state.subscription = { status: 'active' }");
  assert.equal(await app.eval('loadAvailableServers()'), false);
  app.eval("state.sessionEpoch += 1; state.user = { id: 'user-b' }");
  await timers[0]();
  assert.equal(calls, 1);
  assert.equal(app.eval('serverCatalogRetryTimer'), null);
});

test('current-device identity is not mislabeled as an active connection', () => {
  assert.match(source, /devices_current_confirmed: "Это устройство"/);
  assert.match(source, /devices_current_confirmed: "This device"/);
  assert.doesNotMatch(source, /isCurrent \? `<span class="dot-green">●<\/span> \$\{uiText\('Онлайн', 'Online'\)\}`/);
  assert.match(source, /Подберём сервер/);
  assert.match(source, /We will choose a server/);
});

test('VPN controls use native buttons for built-in keyboard and screen-reader behavior', () => {
  const html = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
  for (const id of ['vpn-power-ring', 'vpn-power-ring-off']) {
    assert.match(html, new RegExp(`<button type="button" id="${id}"`));
    assert.doesNotMatch(html, new RegExp(`<div id="${id}"[^>]*role="button"`));
  }
  assert.match(source, /ring\.setAttribute\('aria-pressed', String\(isConn\)\)/);
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
    bypassRu: true, background: true, killSwitch: false,
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
    /saved == token && \*ticket_generation == generation/);
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
      if (!elements.has(id)) elements.set(id, {
        textContent: '', className: '', querySelector() { return null; },
        classList: { toggle() {}, add() {}, remove() {} },
        setAttribute() {}, removeAttribute() {}
      });
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
  assert.match(app.eval('I18N.en.auto_renew_note'), /Manage auto-renewal from Account/);
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
  const app = harness(undefined, {
    account_snapshot: async () => ({ subscription: { status: 'none', trial_available: true } }),
    activate_trial: async () => {
      calls += 1;
      return pending;
    }
  });
  app.eval("state.user = { id: 'account-A' }");
  const first = app.eval("handleActivateTrial(true)");
  const duplicate = app.eval("handleActivateTrial(true)");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(app.eval('state.trialBusy'), true);
  settle({ status: 'trial', max_devices: 2 });
  await Promise.all([first, duplicate]);
  assert.equal(app.eval('state.trialBusy'), false);
});

test('trial activation requires a fresh affirmative eligibility response', async () => {
  let activations = 0;
  const app = harness(undefined, {
    account_snapshot: async () => ({ subscription: { status: 'unknown', trial_available: true } }),
    activate_trial: async () => { activations += 1; return { status: 'trial' }; }
  });
  app.eval("state.user = { id: 'account-A' }");
  await app.eval('handleActivateTrial(true)');
  assert.equal(activations, 0);
  assert.equal(app.eval('state.subscription.status'), 'unknown');
});

test('trial activation refreshes account eligibility before the backend mutation', async () => {
  const calls = [];
  const app = harness(undefined, {
    account_snapshot: async () => {
      calls.push('account_snapshot');
      return { subscription: { status: 'none', trial_available: true } };
    },
    activate_trial: async () => {
      calls.push('activate_trial');
      return { status: 'trial', trial_available: false };
    }
  });
  app.eval("state.user = { id: 'account-A' }");
  await app.eval('handleActivateTrial(true)');
  assert.deepEqual(calls, ['account_snapshot', 'activate_trial']);
  assert.equal(app.eval('state.subscription.status'), 'trial');
});

test('late trial response cannot replace a different signed-in account', async () => {
  let settle;
  const pending = new Promise(resolve => { settle = resolve; });
  const app = harness(undefined, {
    account_snapshot: async () => ({ subscription: { status: 'none', trial_available: true } }),
    activate_trial: async () => pending
  });
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

test('server catalog retries a transient API failure once', async () => {
  let calls = 0;
  const app = harness(undefined, {
    get_servers: async () => {
      calls += 1;
      if (calls === 1) throw 'API temporarily unavailable (HTTP 503)';
      return [{ code: 'node-nl', supported: true }];
    }
  });
  const result = await app.eval('fetchServerCatalog(state.sessionEpoch)');
  assert.equal(calls, 2);
  assert.equal(result[0].code, 'node-nl');
});

test('server catalog does not retry authorization errors and explains recovery', async () => {
  let calls = 0;
  const app = harness(undefined, {
    get_servers: async () => { calls += 1; throw 'Invalid token (HTTP 401)'; }
  });
  await assert.rejects(app.eval('fetchServerCatalog(state.sessionEpoch)'), /HTTP 401/);
  assert.equal(calls, 1);
  assert.match(app.eval("serverCatalogErrorMessage('Invalid token (HTTP 401)')"), /сеанс|войдите/i);
  app.eval("state.settings.language = 'en'");
  assert.match(app.eval("serverCatalogErrorMessage('API temporarily unavailable (HTTP 503)')"), /temporarily unavailable/i);
});

test('cached server catalogs do not present stale latency as current', () => {
  const app = harness();
  const result = app.eval("sanitizeCachedServerCatalog([{code:'node-a',supported:true,ping:42,ping_method:'vpn_https'}])");
  assert.equal(result[0].ping, 0);
  assert.equal(result[0].ping_method, 'vpn_https');
});

test('automatic server choice uses the quickest measured proxy latency across supported protocols', () => {
  const app = harness();
  const result = app.eval(`chooseAutomaticServer([
    {code:'hy2',supported:true,security:'tls',ping_method:'vpn_https',ping:20},
    {code:'reality-slow',supported:true,security:'reality',ping_method:'vpn_https',ping:80},
    {code:'reality-fast',supported:true,security:'reality',ping_method:'vpn_https',ping:35},
    {code:'tls-fast',supported:true,security:'tls',ping_method:'vpn_https',ping:10}
  ])`);
  assert.equal(result.code, 'tls-fast');
  const unmeasured = app.eval("chooseAutomaticServer([{code:'first',supported:true,ping:0},{code:'measured-failure',supported:true,ping:-2}])");
  assert.equal(unmeasured, null);
  const unsupported = app.eval("chooseAutomaticServer([{code:'unsupported',supported:false,ping:1},{code:'unknown-method',supported:true,ping_method:'tcp_connect',ping:1}])");
  assert.equal(unsupported, null);
  assert.match(source, /chooseAutomaticServer\(state\.servers\)/);
  assert.match(source, /state\.selectedServer\.code === 'auto'[\s\S]{0,180}autoTarget\?\.code/);
});

test('automatic selection ignores measurements older than the native cache window', () => {
  const app = harness();
  app.eval(`state.measurementsAt = Date.now() - 11 * 60 * 1000;
    state.servers = [
      {code:'old-fast',supported:true,ping_method:'vpn_https',ping:12},
      {code:'reality',supported:true,protocol:'vless',security:'reality',ping:0}
    ];`);
  assert.equal(app.eval('chooseAutomaticServer(state.servers)'), null);
  assert.equal(app.eval('automaticFallbackCandidates(state.servers)[0].code'), 'reality');
  app.eval('state.measurementsAt = Date.now();');
  assert.equal(app.eval('chooseAutomaticServer(state.servers).code'), 'old-fast');
});

test('automatic connection uses a concrete unmeasured candidate instead of a backend guess', async () => {
  const calls = [];
  const app = harness(undefined, {
    vpn_start: async args => {
      calls.push(args);
      return { connected: true, verified: false };
    }
  });
  app.eval(`state.subscription = {status:'active', seconds_remaining:3600};
    state.servers = [{code:'first',supported:true,ping:0}];
    state.selectedServer = {code:'auto',name:'Автоматически',country:'',flag:'🌐',ping:0};
    state.serversStale = false;
    updateVpnUi = () => {}; showToast = () => {};
    startLiveTimer = () => {}; startStatusPolling = () => {};`);
  await app.eval('toggleVpn()');
  assert.equal(calls[0].nodeCode, 'first');

  const measuredCalls = [];
  const measured = harness(undefined, {
    vpn_start: async args => {
      measuredCalls.push(args);
      return { connected: true, verified: false };
    }
  });
  measured.eval(`state.subscription = {status:'active', seconds_remaining:3600};
    state.servers = [
      {code:'slow',supported:true,ping_method:'vpn_https',ping:60},
      {code:'fast',supported:true,ping_method:'vpn_https',ping:24}
    ];
    state.selectedServer = {code:'auto',name:'Автоматически',country:'',flag:'🌐',ping:0};
    state.serversStale = false;
    updateVpnUi = () => {}; showToast = () => {};
    startLiveTimer = () => {}; startStatusPolling = () => {};`);
  await measured.eval('toggleVpn()');
  assert.equal(measuredCalls[0].nodeCode, 'fast');
});

test('automatic connection retries one alternate only after a server reachability failure', async () => {
  const calls = [];
  const app = harness(undefined, {
    vpn_start: async args => {
      calls.push(args);
      if (args.nodeCode === 'first') {
        throw new Error('Выбранный сервер не передал проверочный HTTPS-запрос через свой протокол.');
      }
      return { connected: true, verified: false };
    }
  });
  app.eval(`state.subscription = {status:'active', seconds_remaining:3600};
    state.servers = [
      {code:'first',supported:true,ping_method:'vpn_https',ping:18},
      {code:'second',supported:true,ping_method:'vpn_https',ping:31},
      {code:'known-failure',supported:true,ping_method:'vpn_https',ping:-2}
    ];
    state.selectedServer = {code:'auto',name:'Автоматически',country:'',flag:'🌐',ping:0};
    state.serversStale = false;
    updateVpnUi = () => {}; showToast = () => {};
    startLiveTimer = () => {}; startStatusPolling = () => {};`);
  await app.eval('toggleVpn()');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {nodeCode:'first'}, {nodeCode:'second'}
  ]);

  const safeErrors = [];
  const unavailable = harness(undefined, {
    vpn_start: async args => {
      safeErrors.push(args);
      throw new Error('VPN не передаёт трафик (probe_unavailable). Сетевые настройки Windows восстановлены.');
    }
  });
  unavailable.eval(`state.subscription = {status:'active', seconds_remaining:3600};
    state.servers = [{code:'first',supported:true,ping_method:'vpn_https',ping:18}];
    state.selectedServer = {code:'auto',name:'Автоматически',country:'',flag:'🌐',ping:0};
    state.serversStale = false;
    updateVpnUi = () => {}; showToast = () => {};`);
  await unavailable.eval('toggleVpn()');
  assert.equal(safeErrors.length, 1);
});

test('automatic connection fails over even when no latency pinned a node', async () => {
  const calls = [];
  const app = harness(undefined, {
    vpn_start: async args => {
      calls.push(args.nodeCode);
      if (args.nodeCode === 'de') {
        throw new Error('VPN не передаёт трафик (server_unreachable). Сетевые настройки Windows восстановлены.');
      }
      return { connected: true, verified: false };
    }
  });
  app.eval(`state.subscription = {status:'active', seconds_remaining:3600};
    state.servers = [
      {code:'hy2',supported:true,protocol:'hysteria2',security:'tls',ping:-2},
      {code:'de',supported:true,protocol:'vless',security:'reality',ping:-2}
    ];
    state.selectedServer = {code:'auto',name:'Автоматически',country:'',flag:'🌐',ping:0};
    state.serversStale = false;
    updateVpnUi = () => {}; showToast = () => {};
    startLiveTimer = () => {}; startStatusPolling = () => {};`);
  await app.eval('toggleVpn()');
  // No measured node: the protocol-ranked VLESS Reality candidate failed,
  // then the next explicit catalog candidate was tried instead of stopping.
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), ['de', 'hy2']);
});

test('server latency action requests fresh outbound probes and identifies supported protocols', async () => {
  const app = harness();
  const html = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
  assert.equal(app.eval("serverProtocolLabel({protocol:'vless',security:'reality'})"), 'VLESS Reality');
  assert.equal(app.eval("serverProtocolLabel({protocol:'hysteria2',security:'tls'})"), 'Hysteria 2');
  assert.match(source, /loadAvailableServers\(\{ forceProbe: true \}\)/);
  assert.match(source, /invoke\('get_servers', forceProbe[\s\S]{0,100}clientEpoch: epoch/);
  assert.match(source, /events\.listen\('server-latency-update'/);
  assert.match(html, /id="btn-measure-server-latency"/);
  assert.match(html, /data-i18n="server_latency_help"/);
  assert.match(source, /server_latency_help: "Measures internet latency through each server/);
});

test('account deletion requires an explicit warning before invoking native IPC', () => {
  const backend = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
  assert.match(backend, /service::auth_delete_account,/);
  const action = source.split('async function handleDeleteAccount()')[1].split('// Local health report')[0];
  assert.match(action, /showConfirm\(/);
  assert.match(action, /Remaining paid time will be lost/);
  assert.match(action, /invoke\('auth_delete_account', \{ generation \}\)/);
});
