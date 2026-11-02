import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');

const canonical = [
  { code: 'month', days: 30, options: [89, 109, 129] },
  { code: 'quarter', days: 120, options: [316, 396, 476] },
  { code: 'half_year', days: 240, options: [552, 712, 872] },
  { code: 'year', days: 450, options: [885, 1185, 1485] },
].map(plan => ({
  code: plan.code,
  device_options: [2, 5, 10].map((devices, index) => ({
    devices, price_rub: plan.options[index], days: plan.days
  }))
}));

function harness(getPlans = async () => canonical) {
  const context = {
    console,
    document: {
      addEventListener() {},
      getElementById() { return null; },
      querySelectorAll() { return []; }
    },
    window: { __TAURI__: { core: { invoke: async (cmd) => {
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

test('checkout prices and gift durations come from server catalog', async () => {
  const app = harness();
  await app.eval('loadPricingCatalog()');
  const result = JSON.parse(app.eval(`JSON.stringify({
    ready: state.catalogReady,
    price: PRICING_MATRIX[2].year.price,
    days: PRICING_MATRIX[2].year.days,
    bigger: PRICING_MATRIX[10].quarter.price
  })`));
  assert.deepEqual(result, { ready: true, price: 885, days: 450, bigger: 476 });
});

test('checkout prices parse correctly from live production flat catalog', async () => {
  const liveCatalog = [
    { code: 'trial', name: '3 дня бесплатно', price_rub: 0, days: 3 },
    { code: 'month', name: '1 месяц', price_rub: 149, days: 30 },
    { code: 'quarter', name: '3 месяца', price_rub: 380, days: 90 },
    { code: 'half_year', name: '6 месяцев', price_rub: 625, days: 180 },
    { code: 'year', name: '1 год', price_rub: 983, days: 365 }
  ];
  const app = harness(async () => liveCatalog);
  await app.eval('loadPricingCatalog()');
  const result = JSON.parse(app.eval(`JSON.stringify({
    ready: state.catalogReady,
    monthPrice: PRICING_MATRIX[2].month.price,
    yearPrice: PRICING_MATRIX[2].year.price,
    quarterDays: PRICING_MATRIX[2].quarter.days
  })`));
  assert.deepEqual(result, { ready: true, monthPrice: 149, yearPrice: 983, quarterDays: 90 });
});


test('real Android API plan aliases are accepted without fabricating prices for device upgrades', async () => {
  const oldApi = [
    { code: '1m', price_rub: 89, days: 30 },
    { code: '3m', price_rub: 316, days: 120 },
    { code: '6m', price_rub: 552, days: 240 },
    { code: '12m', price_rub: 885, days: 450 }
  ];
  const app = harness(async () => oldApi);
  await app.eval('loadPricingCatalog()');
  const state = JSON.parse(app.eval(`JSON.stringify({
    ready: state.catalogReady,
    available: state.availableDeviceCounts,
    price: PRICING_MATRIX[2].quarter.price
  })`));
  assert.deepEqual(state, { ready: true, available: [2], price: 316 });
});

test('missing server plans block checkout, even if cached defaults exist', async () => {
  const app = harness(async () => [{ code: '1m', price_rub: 89, days: 30 }]);
  await app.eval('loadPricingCatalog()');
  assert.equal(app.eval('state.catalogReady'), false);
});

test('new server catalog exposes three exact device variants', async () => {
  const app = harness();
  await app.eval('loadPricingCatalog()');
  assert.deepEqual(JSON.parse(app.eval('JSON.stringify(state.availableDeviceCounts)')), [2, 5, 10]);
});

test('failed catalog fetch blocks payment rather than selling old prices', async () => {
  const app = harness(async () => { throw new Error('offline'); });
  await app.eval('loadPricingCatalog()');
  assert.equal(app.eval('state.catalogReady'), false);
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

test('the Windows shield is byte-for-byte the approved Android V2 drawable', () => {
  const image = readFileSync(new URL('../ui/assets/byme-connect-shield.png', import.meta.url));
  const sha = createHash('sha1')
    .update(Buffer.from(`blob ${image.length}\0`))
    .update(image)
    .digest('hex');
  assert.equal(sha, 'b1b269246a75c21742ebc968cb2c3ad6893a73d8');
});
