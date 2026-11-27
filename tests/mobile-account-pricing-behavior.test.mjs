import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

const read = path => readFileSync(new URL('../'+path, import.meta.url),'utf8');
const source = read('ui/app.js');
const html = read('ui/index.html');
function makeHarness() {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, {
        textContent: '',
        disabled: false,
        style: {},
        dataset: {},
        classList: {
          add(name) { classes.add(name); },
          remove(name) { classes.delete(name); },
          toggle(name, on) { if(on) classes.add(name); else classes.delete(name); }
        },
        get hidden() {return classes.has('hidden');},
        setAttribute(name, value) { this[name] = value; },
        removeAttribute(name) { delete this[name]; },
        toggleAttribute(name, val) { this[name] = val; },
        querySelector(){return null}
      });
    }
    return nodes.get(id);
  };
  const sandbox = createContext({
    document: {
      getElementById: get,
      querySelector() { return null; },
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

test('home trial card follows Android entitlement states and routes its primary action correctly', () => {
  const app = makeHarness();
  const trial = app.run("homeNoPlanPresentation({status:'none',trial_available:true},false)");
  assert.equal(trial.heading, '3 дня бесплатно');
  assert.equal(trial.action, 'trial');
  assert.equal(trial.button, 'Активировать бесплатно');

  const used = app.run("homeNoPlanPresentation({status:'none',trial_available:false,trial_unavailable_reason:'trial_already_used'},false)");
  assert.equal(used.heading, 'Пробный период использован');
  assert.equal(used.description, 'Выберите тариф, чтобы продолжить пользоваться VPN.');
  assert.equal(used.button, 'Посмотреть тарифы');
  assert.equal(used.action, 'plans');
  assert.equal(used.disabled, false);

  const pending = app.run("homeNoPlanPresentation({status:'none',trial_unavailable_reason:'trial_activation_pending'},false)");
  assert.equal(pending.heading, 'Проверяем активацию');
  assert.equal(pending.button, 'Обновить статус');
  assert.equal(pending.action, 'refresh');

  const busy = app.run("homeNoPlanPresentation({status:'none',trial_available:true},true)");
  assert.equal(busy.button, 'Подключаем пробный период…');
  assert.equal(busy.disabled, true);

  const checking = app.run("homeNoPlanPresentation({status:'unknown'},false,true)");
  assert.equal(checking.heading, 'Проверяем подписку…');
  assert.equal(checking.button, 'Проверяем…');
  assert.equal(checking.disabled, true);

  const preparing = app.run("homeNoPlanPresentation({status:'active'},true,false,true)");
  assert.equal(preparing.button, 'Готовим серверы…');
  assert.equal(preparing.disabled, true);

  app.run("state.settings.language='en'");
  const english = app.run("homeNoPlanPresentation({status:'none',trial_available:false},false)");
  assert.equal(english.heading, 'Subscription inactive');
  assert.equal(english.description, 'Choose a plan that works for you.');
  assert.equal(english.button, 'View plans');
  assert.equal(english.action, 'plans');
  assert.equal(english.disabled, false);
});

test('home recovery actions match Android unknown, inactive, and Telegram account states', () => {
  const app = makeHarness();
  const unavailable = app.run("homeNoPlanPresentation({status:'none',trial_available:false},false)");
  assert.equal(unavailable.heading, 'Подписка не активна');
  assert.equal(unavailable.button, 'Посмотреть тарифы');
  assert.equal(unavailable.action, 'plans');

  app.run("state.user={id:'user',email:'user@example.com',is_google:true}; state.subscription={status:'none'}; updateNoPlanPresentation()");
  assert.equal(app.get('btn-no-plan-telegram').hidden, false);
  assert.equal(app.get('btn-no-plan-pricing').hidden, false);
  app.run("state.subscription={status:'unknown'}; updateVpnUi(); updateNoPlanPresentation()");
  assert.equal(app.get('home-state-no-plan').hidden, false);
  assert.equal(app.get('home-state-disconnected').hidden, true);
  assert.equal(app.get('btn-no-plan-telegram').hidden, true);
  assert.equal(app.get('btn-no-plan-pricing').hidden, true);
  assert.equal(app.get('no-plan-trial-heading').textContent, 'Не удалось проверить подписку');
});

test('home Telegram recovery is an accessible native action and trial errors remain inline', () => {
  assert.match(html, /id="no-plan-trial-error"[^>]*role="status"[^>]*aria-live="polite"/);
  const noPlan = html.slice(html.indexOf('id="home-state-no-plan"'), html.indexOf('id="home-state-connected"'));
  assert.match(noPlan, /<button type="button" id="btn-no-plan-telegram"[^>]*data-i18n="no_plan_telegram_restore"/);
  assert.match(html, /id="btn-no-plan-trial"[^>]*>[\s\S]*?class="mobile-cta-arrow"/);
  assert.match(source, /btn-no-plan-telegram'\)\?\.addEventListener\('click', startTelegramAuthFlow\)/);
  const parityCss = read('ui/mobile-parity.css');
  assert.match(parityCss, /\.no-plan-telegram-recovery:focus-visible/);
  assert.match(parityCss, /\.mobile-primary-cta:disabled\s*\{[^}]*background:\s*linear-gradient\(90deg,\s*#11254e,\s*#14284e\)/);
  assert.match(parityCss, /\.no-plan-trial-dock p\s*\{[^}]*text-align:\s*left/);
  const app = makeHarness();
  assert.equal(app.run('I18N.en.no_plan_pricing_button'), 'See all plans');
});

test('home Telegram recovery reflects session creation while sign-in starts', async () => {
  const app = makeHarness();
  app.run("state.user={id:'user',email:'user@example.com'}; state.subscription={status:'none'}; window.__TAURI__={core:{invoke:(cmd)=>cmd==='telegram_create_session' ? new Promise(resolve=>{window.resolveTelegramSession=resolve}) : Promise.resolve()}}; showToast=()=>{}; updateNoPlanPresentation(); window.telegramAuthPromise=startTelegramAuthFlow()");
  assert.equal(app.get('btn-no-plan-telegram').disabled, true);
  assert.equal(app.get('btn-no-plan-telegram')['aria-busy'], 'true');

  app.run("window.resolveTelegramSession({session_token:'session-token',bot_url:'https://t.me/example_bot'});");
  await app.run('window.telegramAuthPromise');
  assert.equal(app.get('btn-no-plan-telegram').disabled, false);
  assert.equal(app.get('btn-no-plan-telegram')['aria-busy'], 'false');
  app.run('cancelTelegramPolling()');
});

test('trial page follows the current Android eligibility and navigation flow', () => {
  const app = makeHarness();
  const available = app.run("trialPagePresentation({status:'none',trial_available:true},true,false)");
  assert.equal(available.heading, 'Пробный период');
  assert.equal(available.description, 'Доступность пробного периода зависит от аккаунта.');
  assert.equal(available.canActivate, true);
  assert.equal(available.activateDisabled, true);
  assert.equal(available.showUsedNote, false);

  const used = app.run("trialPagePresentation({status:'none',trial_available:false,trial_unavailable_reason:'trial_already_used'},false,false)");
  assert.equal(used.heading, 'Пробный период использован');
  assert.equal(used.usedNote, 'Пробный период уже использован.');
  assert.equal(used.canActivate, false);
  assert.equal(used.showPlans, true);

  const active = app.run("trialPagePresentation({status:'active',trial_available:true},false,false)");
  assert.equal(active.canActivate, false);
  const unknown = app.run("trialPagePresentation({status:'unknown',trial_available:true},false,false)");
  assert.equal(unknown.canActivate, false);

  app.run("state.currentTab='tab-account'; openTrialScreen()");
  assert.equal(app.run('state.currentTab'), 'tab-trial');
  assert.equal(app.get('app-sidebar').hidden, true);
  assert.equal(app.run('getPageBackTarget(\'tab-trial\')'), 'tab-account');
  app.run('openPricingScreen()');
  assert.equal(app.run('state.currentTab'), 'tab-pricing');
  assert.equal(app.get('app-sidebar').hidden, true);
  assert.equal(app.run('getPageBackTarget(\'tab-pricing\')'), 'tab-trial');
  app.run('handlePageBack()');
  assert.equal(app.run('state.currentTab'), 'tab-trial');
  app.run('handlePageBack()');
  assert.equal(app.run('state.currentTab'), 'tab-account');
  assert.equal(app.get('app-sidebar').hidden, false);

  assert.match(html, /id="tab-trial"/);
  assert.match(source, /btn-account-trial'\)\?\.addEventListener\('click', openTrialScreen\)/);
  assert.match(html, /id="btn-trial-activate"/);
  assert.match(html, /id="btn-trial-plans"/);
});

test('trial activation follows Android directly and confirms success after bounded server refresh', () => {
  const activation = source.slice(source.indexOf('async function handleActivateTrial('), source.indexOf('async function handlePayYooKassa('));
  assert.doesNotMatch(activation, /showConfirm\(/);
  assert.match(activation, /attempt < 2/);
  assert.match(activation, /openModal\('modal-trial-success'\)/);
  assert.match(html, /id="modal-trial-success"/);
});

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
  app.run("state.user={id:'user-a'}; state.subscription={status:'active'}; window.calls=[]; window.__TAURI__={core:{invoke:async (cmd,args)=>{window.calls.push({cmd,args}); if(cmd==='get_auto_renewal') return {enabled:true,can_enable:false,generation:7};}}}; showToast=()=>{}; showConfirm=(title,desc,callback)=>{window.confirm=callback}");
  await app.run('refreshRenewal()');
  app.run('confirmCancelRenewal()');
  assert.equal(app.run('window.calls.length'), 1);
  await app.run('window.confirm()');
  assert.equal(app.run('window.calls[1].cmd'), 'cancel_auto_renewal');
  assert.equal(app.run('window.calls[1].args.generation'), 7);
  assert.equal(app.run('state.subscription.auto_renew'), false);
});

test('renewal can be enabled only after server eligibility and explicit confirmation', async () => {
  const app = makeHarness();
  app.run("state.user={id:'user-a'}; state.subscription={status:'active',auto_renew:false}; window.calls=[]; window.__TAURI__={core:{invoke:async (cmd,args)=>{window.calls.push({cmd,args}); if(cmd==='get_auto_renewal') return {enabled:false,can_enable:true,generation:8}; if(cmd==='enable_auto_renewal') return true;}}}; showToast=()=>{}; window.confirmation=null; showConfirm=(title,desc,callback)=>{window.confirmation={title,desc,callback}}");
  await app.run('refreshRenewal()');
  assert.equal(app.run('state.renewalCanEnable'), true);
  app.run('confirmEnableRenewal()');
  assert.equal(app.run('window.calls.length'), 1);
  assert.equal(app.run('window.confirmation.title'), 'Включить автопродление?');
  assert.match(app.run('window.confirmation.desc'), /ранее сохранённый способ оплаты/);
  await app.run('window.confirmation.callback()');
  assert.equal(app.run('window.calls[1].cmd'), 'enable_auto_renewal');
  assert.equal(app.run('window.calls[1].args.generation'), 8);
  assert.equal(app.run('state.subscription.auto_renew'), true);
  assert.equal(app.run('state.renewalCanEnable'), false);
  assert.equal(app.run('state.renewalChecked'), true);

  const stale = makeHarness();
  stale.run("state.user={id:'user-a'}; state.subscription={status:'active',auto_renew:false}; window.calls=[]; window.__TAURI__={core:{invoke:async (cmd,args)=>{window.calls.push({cmd,args}); if(cmd==='get_auto_renewal') return {enabled:false,can_enable:true,generation:9};}}}; showToast=()=>{}; window.confirmation=null; showConfirm=(title,desc,callback)=>{window.confirmation=callback}");
  await stale.run('refreshRenewal()');
  stale.run('confirmEnableRenewal()');
  stale.run("state.sessionEpoch++; state.user={id:'user-b'}");
  await stale.run('window.confirmation()');
  assert.equal(stale.run('window.calls.length'), 1);
});

test('renewal screen exposes only confirmed actions and binds Android actions', () => {
  const app = makeHarness();
  const unchecked = app.run('renewalPagePresentation(false,false,null,false)');
  assert.equal(unchecked.showCancel, false);
  assert.equal(unchecked.showEnable, false);
  assert.equal(unchecked.showTelegram, false);

  const refreshing = app.run('renewalPagePresentation(false,true,null,false)');
  assert.equal(refreshing.statusLine, 'Статус: Проверяем…');
  assert.equal(refreshing.refreshLabel, 'Обновляем…');

  const eligible = app.run('renewalPagePresentation(true,false,false,true)');
  assert.equal(eligible.showEnable, true);
  assert.equal(eligible.showTelegram, false);
  assert.equal(eligible.showSavedMethodHint, false);

  const notEligible = app.run('renewalPagePresentation(true,false,false,false)');
  assert.equal(notEligible.showEnable, false);
  assert.equal(notEligible.showTelegram, true);
  assert.equal(notEligible.showSavedMethodHint, true);

  const enabled = app.run('renewalPagePresentation(true,false,true,false)');
  assert.equal(enabled.showCancel, true);
  assert.equal(enabled.showEnable, false);

  assert.match(source, /btn-renewal-enable'\)\?\.addEventListener\('click', confirmEnableRenewal\)/);
  assert.match(source, /btn-renewal-telegram'\)\?\.addEventListener\('click', openRenewalTelegram\)/);
  assert.doesNotMatch(source, /btn-renewal-switch-pricing/);
});

test('renewal confirmation cannot be dismissed while the confirmed action is pending', async () => {
  const app = makeHarness();
  app.run("openModal=()=>{}; closeModal=(id)=>{window.closed=id}; showConfirm('title','description',()=>new Promise(resolve=>{window.finish=resolve}),'Enable',{keepOpenWhileBusy:true,busyLabel:'…'})");
  const action = app.run("document.getElementById('btn-confirm-accept').onclick()");
  assert.equal(app.get('btn-confirm-accept').disabled, true);
  assert.equal(app.get('btn-confirm-accept').textContent, '…');
  assert.equal(app.run('window.closed'), undefined);
  app.run('window.finish()');
  await action;
  assert.equal(app.run('window.closed'), 'modal-confirm');
  assert.equal(app.get('btn-confirm-accept').disabled, false);
});

test('renewal confirmation buttons match Android action labels in both locales', () => {
  const app = makeHarness();
  app.run("openModal=()=>{}; showConfirm('title','description',()=>{},I18N.ru.renewal_enable_confirm_action)");
  assert.equal(app.get('btn-confirm-accept').textContent, 'Включить');
  app.run("state.settings.language='en'; showConfirm('title','description',()=>{},I18N.en.renewal_cancel_confirm_action)");
  assert.equal(app.get('btn-confirm-accept').textContent, 'Turn off');
});

test('a changed account cannot confirm an old renewal action', async () => {
  const app = makeHarness();
  app.run("state.user={id:'user-a'}; state.subscription={status:'active',auto_renew:true}; state.renewalChecked=true; state.renewalGeneration=7; window.calls=[]; window.__TAURI__={core:{invoke:async (...args)=>window.calls.push(args)}}; showConfirm=(title,desc,callback)=>{window.confirm=callback}");
  app.run('confirmCancelRenewal(); state.sessionEpoch++');
  await app.run('window.confirm()');
  assert.equal(app.run('window.calls.length'), 0);
});

test('trial activation starts from the Android CTA without an extra confirmation prompt', () => {
  const activation = source.slice(source.indexOf('async function handleActivateTrial('), source.indexOf('async function handlePayYooKassa('));
  assert.doesNotMatch(activation, /showConfirm\(/);
  assert.match(activation, /const accountId = String\(state\.user\.id\)/);
  assert.match(activation, /if \(!sameAccount\(\)\) return;/);
  assert.match(source, /btn-no-plan-trial'\)\?\.addEventListener\('click', handleHomeNoPlanAction\)/);
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

test('account security sheet displays the signed-in profile and hides password reset for Google', () => {
  const app=makeHarness();
  app.run("state.user={name:'Alex',email:'alex@example.test',is_google:false}; updateUserUi()");
  assert.equal(app.get('account-settings-profile-name').textContent,'Alex');
  assert.equal(app.get('account-settings-profile-email').textContent,'alex@example.test');
  assert.equal(app.get('btn-account-password-reset').hidden,false);
  app.run("state.user={name:'Alex',email:'alex@example.test',is_google:true}; updateUserUi()");
  assert.equal(app.get('btn-account-password-reset').hidden,true);
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

test('device screen mirrors Android loading, confirmed-empty, retry, and local-device states', () => {
  const app = makeHarness();
  const styles = read('ui/styles.css');
  assert.match(html, /id="devices-current-card"|class="glass-card device-item-row devices-current-device"/);
  assert.match(html, /id="devices-unavailable-card"[^>]*role="status"/);
  assert.match(html, /id="btn-devices-retry"/);
  assert.match(html, /id="devices-limit-progress"[^>]*role="progressbar"/);
  assert.match(html, /data-i18n="devices_add_title"/);
  assert.match(styles, /\.devices-current-device \.device-info-col\s*\{[^}]*flex-direction:\s*column/);
  assert.match(styles, /\.device-current-status::before\s*\{[^}]*border-radius:\s*50%/);

  app.run('updateDevicesUi()');
  assert.equal(app.get('devices-stat-hint').textContent, 'Загружаем список устройств с сервера.');
  assert.equal(app.get('devices-unavailable-card').hidden, true);
  assert.equal(app.get('devices-empty-other').hidden, true);
  assert.equal(app.get('devices-current-status').textContent, 'Ещё не подтверждено сервером');
  assert.equal(app.get('devices-current-status')['data-confirmed'], 'false');

  app.run("state.devices=[{id:'desktop',is_current:true}];updateDevicesUi()");
  assert.equal(app.get('devices-current-status').textContent, 'Это устройство');
  assert.equal(app.get('devices-current-status')['data-confirmed'], 'true');
  app.run('state.devices=[];updateDevicesUi()');

  app.run("state.devicesLoaded=true;state.devicesSupported=true;state.devicesUnavailable=false;state.subscription={status:'active',max_devices:2};updateDevicesUi()");
  assert.equal(app.get('devices-hero-current').textContent, '0');
  assert.equal(app.get('devices-hero-max').textContent, '2');
  assert.equal(app.get('devices-limit-progress').hidden, false);
  assert.equal(app.get('devices-limit-progress-fill').style.width, '0%');
  assert.equal(app.get('devices-empty-other').hidden, false);

  app.run('state.devicesLoaded=true;state.devicesSupported=false;state.devicesUnavailable=true;updateDevicesUi()');
  assert.equal(app.get('devices-hero-current').textContent, '—');
  assert.equal(app.get('devices-limit-progress').hidden, true);
  assert.equal(app.get('devices-unavailable-card').hidden, false);
  assert.equal(app.get('devices-empty-other').hidden, true);

  app.run('state.devicesRefreshing=true;updateDevicesUi()');
  assert.equal(app.get('btn-devices-retry').disabled, true);
  assert.equal(app.get('devices-retry-label').textContent, 'Загружаем…');
});

test('device removal confirmation and request stay bound to the original account session', async () => {
  const stale = makeHarness();
  stale.run("state.user={id:'account-a'}; window.calls=[]; window.__TAURI__={core:{invoke:async (cmd,args)=>{window.calls.push({cmd,args}); if(cmd==='auth_session_generation') return 19;}}}; showConfirm=(title,desc,callback)=>{window.confirm=callback}; showToast=()=>{}");
  await stale.run("handleDeleteDevice('device-a')");
  assert.equal(stale.run('window.calls[0].cmd'), 'auth_session_generation');
  stale.run("state.sessionEpoch++; state.user={id:'account-b'}");
  await stale.run('window.confirm()');
  assert.equal(stale.run('window.calls.length'), 1);

  const current = makeHarness();
  current.run("state.user={id:'account-a'}; window.calls=[]; window.__TAURI__={core:{invoke:async (cmd,args)=>{window.calls.push({cmd,args}); if(cmd==='auth_session_generation') return 21; if(cmd==='delete_device') return true;}}}; showConfirm=(title,desc,callback)=>{window.confirm=callback}; showToast=()=>{}; refreshAccountSnapshot=async ()=>{}");
  await current.run("handleDeleteDevice('device-a')");
  await current.run('window.confirm()');
  assert.equal(current.run('window.calls[1].cmd'), 'delete_device');
  assert.equal(current.run('window.calls[1].args.generation'), 21);
});

test('checkout amount is always hydrated from server-confirmed SKU; never invented',()=>{
  const app=makeHarness();
  app.run("state.selectedPlanCode='year';state.selectedDevicesCount=2;state.catalogReady=false;updatePricingMatrixUi()");
  assert.equal(app.get('pricing-selected-plan-price').textContent,'Цена не подтверждена');
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
  assert.equal(app.run("priceNoteForOffer('year', {price:991, days:0})"), 'Тариф пока недоступен');
});

test('pricing follows Android default selection, best-value eligibility, and retry feedback', () => {
  const app = makeHarness();
  assert.equal(app.run('state.selectedPlanCode'), 'month');
  assert.match(html, /class="tariff-card selected" data-plan="month"[^>]*aria-pressed="true"/);
  assert.match(html, /id="pricing-catalog-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="btn-pricing-retry"/);
  assert.equal(app.run("androidBestValuePlan({month:{price:300,days:30},quarter:{price:800,days:120},half_year:{price:1600,days:240},year:{price:2700,days:450}})"), 'year');
  assert.equal(app.run("androidBestValuePlan({month:{price:300,days:30},quarter:{price:800,days:120}})"), null);
  assert.equal(app.run("pricingCatalogPresentation({pricingLoading:true,catalogReady:false,pricingLoadError:''},{})").retry, false);
  assert.equal(app.run("pricingCatalogPresentation({pricingLoading:false,catalogReady:false,pricingLoadError:'load failed'},{}).retry"), true);
  assert.match(source, /state\.pricingLoading \? uiText\('Проверяем цену…'/);
  assert.match(source, /uiText\('Оплата временно недоступна', 'Checkout temporarily unavailable'\)/);
  assert.doesNotMatch(source, /state\.selectedDevicesCount = state\.availableDeviceCounts\[0\]/);
  assert.doesNotMatch(source, /state\.selectedPlanCode = \['year', 'half_year', 'quarter', 'month'\]/);
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
