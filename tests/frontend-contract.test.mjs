import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
