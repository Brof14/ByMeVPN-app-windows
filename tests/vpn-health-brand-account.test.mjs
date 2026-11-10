import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
  assert.equal((html.match(/src="\\.\\/assets\\/byme-connect-shield\\.png"/g) || []).length, 2);
  assert.match(mobile, /\\.vpn-shield-image/);
  assert.match(app, /showVectorFallback/);
  assert.match(mobile, /\.vpn-shield-mark/);
  assert.doesNotMatch(mobile, /#vpn-power-ring \.inner-shield-circle::after/);
  assert.match(mobile, /prefers-reduced-motion/);
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
  for (const id of ['btn-account-refresh','btn-account-copy-id','btn-acc-manage',
    'btn-account-app-settings','btn-account-advanced','btn-acc-open-support',
    'btn-acc-logout','btn-acc-delete']) {
    assert.match(section, new RegExp('id="' + id + '"'));
  }
  assert.match(desktop, /\.account-settings-section/);
});

test('VPN health reports real DNS resolution result, not a stale log keyword', () => {
  assert.match(native, /"dns_resolution"/);
  assert.match(native, /dns_resolution_check/);
  assert.match(app, /report\?\.dns_resolution/);
  assert.match(app, /DNS[^\n]*провер/);
});

test('unknown auto-renewal stays neutral in the rendered Account and Renewal views', () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      textContent:'', className:'hidden', disabled:false,
      classList:{toggle(){},add(){},remove(){}},
      querySelector(){return null}
    });
    return nodes.get(id);
  };
  const context = createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    window:{},
    document:{addEventListener(){},querySelectorAll(){return[]},getElementById:node}
  });
  runInContext(app, context);
  runInContext("state.subscription={status:'active',auto_renew:null,plan_name:'Pro',seconds_remaining:86400};updateSubscriptionUi()",context);
  assert.equal(node('acc-autorenew-badge').className,'hidden');
  assert.equal(node('renewal-current-status-badge').className,'renewal-status-neutral');
  assert.equal(node('renewal-current-status-badge').textContent,'Информация недоступна');
  runInContext("state.subscription.auto_renew=false;updateSubscriptionUi()",context);
  assert.equal(node('acc-autorenew-badge').className,'renewal-status-neutral');
  assert.equal(node('renewal-current-status-badge').textContent,'Отключено');
  runInContext("state.subscription.auto_renew=true;updateSubscriptionUi()",context);
  assert.equal(node('renewal-current-status-badge').textContent,'Включено');
  assert.equal(node('acc-autorenew-badge').className,'badge-auto-renew');
});
