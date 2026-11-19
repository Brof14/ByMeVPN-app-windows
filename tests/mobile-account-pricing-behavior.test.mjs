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

test('password reset sends the entered email once and shows a neutral confirmation', async () => {
  const app = makeHarness();
  app.get('login-email').value = 'user@example.test';
  app.get('login-email').checkValidity = () => true;
  app.run("window.resetCalls=[]; window.__TAURI__={core:{invoke:async (cmd,args)=>{window.resetCalls.push({cmd,args});}}}; window.messages=[]; showToast=(message)=>window.messages.push(message)");
  await app.run('handlePasswordReset()');
  assert.equal(app.run('window.resetCalls.length'), 1);
  assert.equal(app.run('window.resetCalls[0].cmd'), 'auth_request_password_reset');
  assert.equal(app.run('window.resetCalls[0].args.email'), 'user@example.test');
  assert.match(app.run('window.messages[0]'), /если/i);
});

test('signed-in account can request a reset; Google accounts cannot', async () => {
  const app = makeHarness();
  app.run("state.user={id:'a',email:'user@example.test',is_google:false}; window.calls=[]; window.__TAURI__={core:{invoke:async (cmd,args)=>window.calls.push({cmd,args})}}; showToast=()=>{}; updateUserUi()");
  assert.equal(app.get('btn-account-password-reset').hidden, false);
  await app.run('handleAccountPasswordReset()');
  assert.equal(app.run('window.calls[0].args.email'), 'user@example.test');
  app.run('state.user.is_google=true; updateUserUi()');
  assert.equal(app.get('btn-account-password-reset').hidden, true);
  await app.run('handleAccountPasswordReset()');
  assert.equal(app.run('window.calls.length'), 1);
});

test('renewal cancellation requires confirmation and the checked account generation', async () => {
  const app = makeHarness();
  app.run("state.user={id:'user-a'}; state.subscription={status:'active'}; window.calls=[]; window.__TAURI__={core:{invoke:async (cmd,args)=>{window.calls.push({cmd,args}); if(cmd==='get_auto_renewal') return {enabled:true,generation:7};}}}; showToast=()=>{}; showConfirm=(title,desc,callback)=>{window.confirm=callback}");
  await app.run('refreshRenewal()');
  app.run('confirmCancelRenewal()');
  assert.equal(app.run('window.calls.length'), 1);
  await app.run('window.confirm()');
  assert.equal(app.run('window.calls[1].cmd'), 'cancel_auto_renewal');
  assert.equal(app.run('window.calls[1].args.generation'), 7);
  assert.equal(app.run('state.subscription.auto_renew'), false);
});

test('a changed account cannot confirm an old renewal action', async () => {
  const app = makeHarness();
  app.run("state.user={id:'user-a'}; state.subscription={status:'active',auto_renew:true}; state.renewalChecked=true; state.renewalGeneration=7; window.calls=[]; window.__TAURI__={core:{invoke:async (...args)=>window.calls.push(args)}}; showConfirm=(title,desc,callback)=>{window.confirm=callback}");
  app.run('confirmCancelRenewal(); state.sessionEpoch++');
  await app.run('window.confirm()');
  assert.equal(app.run('window.calls.length'), 0);
});

test('trial click requires confirmation and does not activate a different account', async () => {
  const app = makeHarness();
  app.run("state.user={id:'user-a'}; window.calls=[]; window.__TAURI__={core:{invoke:async (...args)=>window.calls.push(args)}}; showConfirm=(title,desc,callback)=>{window.confirm=callback}");
  await app.run('handleActivateTrial({type:"click"})');
  assert.equal(app.run('window.calls.length'), 0);
  app.run("state.sessionEpoch++; state.user={id:'user-b'}");
  await app.run('window.confirm()');
  assert.equal(app.run('window.calls.length'), 0);
});

test('account deletion confirmation cannot act on a changed account', async () => {
  const app = makeHarness();
  app.run("state.user={id:'user-a'}; window.calls=[]; window.__TAURI__={core:{invoke:async (...args)=>{window.calls.push(args); return 7}}}; showConfirm=(title,desc,callback)=>{window.confirm=callback}");
  await app.run('handleDeleteAccount()');
  app.run("state.sessionEpoch++; state.user={id:'user-b'}");
  await app.run('window.confirm()');
  assert.equal(app.run('window.calls.length'), 1);
  assert.equal(app.run('window.calls[0][0]'), 'auth_session_generation');
});

test('account deletion cannot be sent twice while the first request is pending', async () => {
  const app = makeHarness();
  app.run("state.user={id:'user-a'}; window.calls=[]; window.__TAURI__={core:{invoke:(cmd,args)=>{window.calls.push({cmd,args}); if(cmd==='auth_session_generation') return Promise.resolve(7); return new Promise(resolve=>{window.finish=resolve})}}}; showConfirm=(title,desc,callback)=>{window.confirm=callback}; showToast=()=>{}; checkVpnStatus=async()=>{}");
  await app.run('handleDeleteAccount()');
  const first = app.run('window.confirm()');
  await app.run('window.confirm()');
  assert.equal(app.run('window.calls.length'), 2);
  assert.equal(app.run('window.calls[1].cmd'), 'auth_delete_account');
  assert.equal(app.run('window.calls[1].args.generation'), 7);
  app.run("window.finish(Promise.reject(new Error('unconfirmed')))");
  await first;
});

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

test('elapsed subscription is shown as unconfirmed until refreshed', () => {
  const app = makeHarness();
  app.run("state.subscription={status:'active',seconds_remaining:60,_receivedAt:Date.now()-61000,trial_available:true}; updateSubscriptionUi()");
  assert.equal(app.get('account-active-state').hidden, true);
  assert.equal(app.get('acc-user-status-pill').textContent, 'Проверяем');
  assert.equal(app.get('btn-account-trial').disabled, true);
});

test('elapsed subscription cannot start a new tunnel before refresh', async () => {
  const app = makeHarness();
  app.run("state.subscription={status:'active',seconds_remaining:60,_receivedAt:Date.now()-61000}; window.calls=[]; window.__TAURI__={core:{invoke:async (...args)=>window.calls.push(args)}}; showToast=()=>{}");
  await app.run('toggleVpn()');
  assert.equal(app.run('window.calls.length'), 0);
});

test('device upgrade link is shown only for active two- or five-device plans', () => {
  const app = makeHarness();
  app.run("state.subscription={status:'active',max_devices:2}; updateDevicesUi()");
  assert.equal(app.get('devices-upgrade-card').hidden, false);
  app.run("state.subscription={status:'active',max_devices:10}; updateDevicesUi()");
  assert.equal(app.get('devices-upgrade-card').hidden, true);
  app.run("state.subscription={status:'unknown',max_devices:2}; updateDevicesUi()");
  assert.equal(app.get('devices-upgrade-card').hidden, true);
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

test('monthly equivalent matches Android rounding from the confirmed duration', () => {
  const app = makeHarness();
  assert.match(app.run("priceNoteForOffer('year', {price:991, days:450})"), /67 ₽/);
  assert.equal(app.run("priceNoteForOffer('year', {price:991, days:0})"), 'Тариф недоступен');
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
