import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createContext, runInContext} from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url),'utf8');
const html = read('ui/index.html');
const mobile = read('ui/mobile-parity.css');
const desktop = read('ui/desktop-layout.css');
const app = read('ui/app.js');
const native = read('src-tauri/src/service.rs');

test('both power controls contain the Android image and a working SVG fallback', () => {
  for (const id of ['vpn-power-ring', 'vpn-power-ring-off']) {
    assert.match(html, new RegExp('id="' + id + '"[^>]*>[\\s\\S]*?<svg class="vpn-shield-mark"'));
  }
  assert.equal(html.split('src="./assets/byme-connect-shield.png"').length - 1, 2);
  assert.match(mobile, /\.vpn-shield-image/);
  assert.match(app, /showVectorFallback/);
  assert.match(mobile, /\.vpn-shield-mark/);
  assert.doesNotMatch(mobile, /#vpn-power-ring \.inner-shield-circle::after/);
  assert.match(mobile, /prefers-reduced-motion/);
});

test('power shield asset is byte-for-byte the current Android drawable', () => {
  const png = readFileSync(new URL('../ui/assets/byme-connect-shield.png', import.meta.url));
  const gitBlob = createHash('sha1').update('blob ' + png.length).update(Uint8Array.of(0)).update(png).digest('hex');
  assert.equal(gitBlob, 'b1b269246a75c21742ebc968cb2c3ad6893a73d8');
});

test('unknown auto-renewal is neutral and does not imply disabled payments', () => {
  assert.match(app, /function renewalStatusPresentation\(/);
  assert.match(app, /renewal-status-neutral/);
  assert.doesNotMatch(app, /Статус автопродления неизвестен/);
  assert.match(html, /id="modal-account-settings"/);
  assert.match(html, /account-settings-section/);
});

test('account settings remain functionally complete and accessible', () => {
  const section = html.split('id="modal-account-settings"')[1]?.split('id="modal-language"')[0] || '';
  for (const id of ['btn-account-refresh','btn-account-copy-id','btn-acc-open-support',
    'btn-acc-logout','btn-acc-delete','btn-account-password-reset']) {
    assert.match(section, new RegExp('id="' + id + '"'));
  }
  const accountScreen = html.split('id="tab-account"')[1]?.split('id="tab-settings"')[0] || '';
  for (const id of ['btn-acc-open-devices','btn-account-open-pricing',
    'btn-account-open-renewal','btn-account-settings-open']) {
    assert.match(accountScreen, new RegExp('id="' + id + '"'));
  }
  assert.match(section, /data-i18n="account_id_label"[\s\S]*?id="btn-account-copy-id"[^>]*data-i18n="account_copy_id"/);
  assert.match(app, /btn-account-copy-id'\)\?\.addEventListener\('click', handleCopyAccountId\)/);
  assert.match(desktop, /\.account-settings-section/);
});

test('account ID copy uses the signed-in user and leaves the action enabled afterward', async () => {
  let copied = null;
  const attrs = new Map();
  const button = {
    disabled: false,
    setAttribute(name, value) { attrs.set(name, value); }
  };
  const context = createContext({
    navigator: { clipboard: { async writeText(value) { copied = value; } } },
    document: { addEventListener(){}, getElementById: id => id === 'btn-account-copy-id' ? button : null },
    setTimeout, clearTimeout
  });
  runInContext(app, context);
  runInContext("state.user = { id: 'account-42' }", context);
  await runInContext('handleCopyAccountId()', context);
  assert.equal(copied, 'account-42');
  assert.equal(button.disabled, false);
  assert.equal(attrs.get('aria-busy'), 'false');
});

test('VPN health reports real DNS resolution result, not a stale log keyword', () => {
  assert.match(native, /"dns_resolution"/);
  assert.match(native, /dns_resolution_check/);
  assert.match(native, /"egress_probe"/);
  assert.match(app, /report\?\.egress_probe/);

  assert.match(app, /report\?\.dns_resolution/);
  assert.match(app, /Системный DNS/);
});

test('unknown auto-renewal stays neutral in the rendered Account and Renewal views', () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      textContent:'', className:'hidden', disabled:false,
      classList:{toggle(){},add(){},remove(){}},
      querySelector(){return null}, setAttribute(){}
    });
    return nodes.get(id);
  };
  const context = createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    window:{},
    document:{addEventListener(){},querySelectorAll(){return[]},getElementById:node}
  });
  runInContext(app, context);
  runInContext("state.subscription={status:'active',auto_renew:null,plan_name:'Pro',seconds_remaining:86400};state.renewalChecked=true;updateSubscriptionUi()",context);
  assert.equal(node('acc-autorenew-badge').className,'hidden');
  assert.equal(node('renewal-status-line').textContent,'Статус: Не удалось проверить');
  runInContext("state.subscription.auto_renew=false;updateSubscriptionUi()",context);
  assert.equal(node('acc-autorenew-badge').className,'renewal-status-neutral');
  assert.equal(node('renewal-status-line').textContent,'Статус: Отключено');
  runInContext("state.subscription.auto_renew=true;updateSubscriptionUi()",context);
  assert.equal(node('renewal-status-line').textContent,'Статус: Включено');
  assert.equal(node('acc-autorenew-badge').className,'badge-auto-renew');
});

test('healthy live diagnostics reconcile egress and suppress false startup-error copy', async () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      textContent: '', disabled: false, className: '',
      classList: { add(){}, remove(){}, toggle(){} },
      querySelector(){return null}, setAttribute(){}, toggleAttribute(){}
    });
    return nodes.get(id);
  };
  const calls = [];
  const report = {
    process_tracked: true, ip_verified: true, baseline_known: true,
    adapter: 'up', ipv4_default: true, ipv6_default: true,
    dns_resolution: true, egress_probe: 'changed', runtime_healthy: true,
    xray_hint: 'xray'
  };
  const context = createContext({
    console, setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval: () => {},
    document: {
      hidden: false, addEventListener(){}, getElementById: node,
      querySelectorAll(){return []}, querySelector(){return null}
    },
    window: {__TAURI__: {core: {invoke: async name => {
      calls.push(name);
      if (name === 'vpn_health_report') return report;
      if (name === 'vpn_status') return {
        connected: true, verified: true, connected_seconds: 20,
        download_mbps: 0, upload_mbps: 0, ping_ms: 0
      };
      return null;
    }}}}
  });
  runInContext(app, context);
  runInContext("state.vpnConnected = true; state.subscription = {status: 'active'}", context);
  await runInContext("refreshVpnHealth()", context);
  const result = node('vpn-health-details').textContent;
  assert.match(result, /Проверка внешнего IP: подтверждена/);
  assert.match(result, /Текущие сетевые проверки пройдены/);
  assert.doesNotMatch(result, /ошибка запуска/);
  assert.equal(runInContext('state.vpnVerified', context), true);
  assert.ok(calls.includes('vpn_status'));
});

test('a completed diagnostic immediately updates Home and ignores older status responses', async () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      textContent: '', disabled: false, className: '',
      classList: { add(){}, remove(){}, toggle(){} },
      querySelector(){return null}, setAttribute(){}, toggleAttribute(){}
    });
    return nodes.get(id);
  };
  let finishOldStatus;
  const oldStatus = new Promise(resolve => { finishOldStatus = resolve; });
  let statusCalls = 0;
  const context = createContext({
    console, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {},
    document: { hidden: false, addEventListener(){}, getElementById: node,
      querySelectorAll(){return []}, querySelector(){return null} },
    window: {__TAURI__: {core: {invoke: async name => {
      if (name === 'vpn_status') {
        statusCalls++;
        return statusCalls === 1 ? oldStatus : new Promise(() => {});
      }
      if (name === 'vpn_health_report') return {
        process_tracked: true, ip_verified: true, runtime_healthy: true,
        baseline_known: true, adapter: 'up', ipv4_default: true,
        effective_ipv4: true, dns_resolution: true, egress_probe: 'paths_match'
      };
      return null;
    }}}}
  });
  runInContext(app, context);
  runInContext("state.vpnConnected = true; state.subscription = {status: 'active'}", context);
  const pendingStatus = runInContext('checkVpnStatus()', context);
  void runInContext('refreshVpnHealth()', context);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(runInContext('state.vpnVerified', context), true);
  finishOldStatus({ connected: true, verified: false, proof: 'traffic_observed_unverified' });
  await pendingStatus;
  assert.equal(runInContext('state.vpnVerified', context), true);
  assert.doesNotMatch(node('vpn-health-details').textContent, /выход Xray совпадает/i);
});
