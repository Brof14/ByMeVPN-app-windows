import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

const read = path => readFileSync(new URL('../'+path, import.meta.url),'utf8');
const source = read('ui/app.js');
function makeHarness() {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, {
        textContent: '',
        disabled: false,
        classList: { toggle(name, on) { if(on) classes.add(name); else classes.delete(name); } },
        get hidden() {return classes.has('hidden');},
        toggleAttribute(name, val) { this[name] = val; },
        querySelector(){return null}
      });
    }
    return nodes.get(id);
  };
  const sandbox = createContext({
    document: {
      getElementById: get,
      querySelectorAll() { return []; },
      addEventListener() {},
      documentElement: {lang:'ru'}
    },
    navigator: {language:'ru-RU'},
    window: {},
    console, setTimeout,clearTimeout,setInterval,clearInterval
  });
  runInContext(source,sandbox);
  return {get,run:code => runInContext(code,sandbox)};
}

test('Android active account renders real remaining days and a single active access strip',()=>{
  const app=makeHarness();
  app.run("state.subscription={status:'active',plan_name:'Year',seconds_remaining:86401,trial_available:false}");
  app.run("updateSubscriptionUi()");
  assert.equal(app.get('acc-remaining-days').textContent,'2');
  assert.equal(app.get('home-sub-title').textContent,'Подписка активна');
  assert.equal(app.get('home-sub-expiry').textContent,'Осталось 2 дней');
  assert.equal(app.get('account-active-state').hidden,false);
  assert.equal(app.get('account-inactive-state').hidden,true);
  assert.equal(app.get('btn-account-trial').hidden,true);
});

test('unknown entitlement cannot imply paid access or activate a trial',()=>{
  const app=makeHarness();
  app.run("state.subscription={status:'unknown',trial_available:true}");
  app.run("updateSubscriptionUi()");
  assert.equal(app.get('account-active-state').hidden,true);
  assert.equal(app.get('acc-user-status-pill').textContent,'Проверяем');
  assert.equal(app.get('btn-account-trial').disabled,true);
  assert.equal(app.get('btn-account-pricing').hidden,true);
});

test('checkout amount is always hydrated from server-confirmed SKU; never invented',()=>{
  const app=makeHarness();
  app.run("state.selectedPlanCode='year';state.selectedDevicesCount=2;state.catalogReady=false;updatePricingMatrixUi()");
  assert.equal(app.get('pricing-selected-plan-price').textContent,'—');
  assert.equal(app.get('btn-pay-yookassa').disabled,true);
  app.run("PRICING_MATRIX[2].year={price:885,purchaseEnabled:true,days:450,planCode:'12m_d2'};state.catalogReady=true;updatePricingMatrixUi()");
  assert.equal(app.get('pricing-selected-plan-price').textContent,'885 ₽');
  assert.equal(app.get('btn-pay-yookassa').textContent,'Оплатить · 885 ₽');
  assert.equal(app.get('btn-pay-yookassa').disabled,false);
  assert.equal(app.get('pricing-selected-plan-note').textContent,'Доступ на 15 мес. · до 2 устройств');
  app.run("PRICING_MATRIX[2].year.purchaseEnabled=false;updatePricingMatrixUi()");
  assert.equal(app.get('btn-pay-yookassa').disabled,true);
  assert.equal(app.get('pricing-selected-plan-price').textContent,'885 ₽');
});

test('Android mobile pricing preserves four exact plans and licensed payments',()=>{
  const html=read('ui/index.html');
  for(const [code,id] of [['month','price-month'],['quarter','price-quarter'],['half_year','price-half_year'],['year','price-year']]){
    assert.match(html,new RegExp('class="tariff-card[^"]*" data-plan="'+code+'"'));
    assert.match(html,new RegExp('id="'+id+'">—<\\/strong>'));
  }
  assert.match(html,/id="btn-pay-yookassa"/);
  assert.match(html,/id="modal-account-settings"/);
  assert.match(html,/id="modal-language"/);
});
