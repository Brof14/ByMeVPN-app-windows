import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

// Contract tests execute the actual shipping frontend with a stub native
// boundary. They test state transitions, not real Wintun or network routing.
const source = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');

function makeClient(native) {
  const calls = [];
  const auto = {
    classList: { toggle() {}, remove() {}, add() {} },
    setAttribute() {}
  };
  let nextTimer = 0;
  const sandbox = createContext({
    console,
    document: {
      addEventListener() {},
      getElementById(id) {
        if (id === 'page-title') return { textContent: '' };
        if (id === 'recommended-server-auto') return auto;
        return null;
      },
      querySelectorAll() { return []; },
      querySelector() { return null; }
    },
    window: { __TAURI__: { core: { invoke: async (name, args = {}) => {
      calls.push({ name, args });
      if (Object.hasOwn(native, name)) return native[name](args);
      return null;
    } } } },
    setInterval() { return ++nextTimer; },
    clearInterval() {},
    setTimeout,
    clearTimeout
  });
  runInContext(source, sandbox);
  return { calls, eval: expression => runInContext(expression, sandbox) };
}

function connected(client) {
  client.eval(`state.user = {id: 'account-1'};
    state.subscription = { status: 'active' };
    state.servers = [
      {code: 'de', name: 'Germany', supported: true},
      {code: 'nl', name: 'Netherlands', supported: true}
    ];
    state.selectedServer = state.servers[0];
    state.preferredServerCode = 'de';
    state.vpnConnected = true;
    state.vpnVerified = true;`);
}

test('switching a live Windows connection stops first, persists the new node, then reconnects', async () => {
  const client = makeClient({
    vpn_stop: async () => null,
    save_setting: async () => null,
    vpn_start: async () => ({connected: true, verified: true, connected_seconds: 0})
  });
  connected(client);
  await client.eval('selectServer(state.servers[1])');
  assert.deepEqual(client.calls.map(c => c.name), ['vpn_stop', 'save_setting', 'vpn_start']);
  assert.deepEqual(JSON.parse(JSON.stringify(client.calls[1].args)), {key: 'selectedServerCode', value: 'nl'});
  assert.deepEqual(JSON.parse(JSON.stringify(client.calls[2].args)), {nodeCode: 'nl'});
  assert.equal(client.eval('state.vpnConnected'), true);
  assert.equal(client.eval('state.vpnVerified'), true);
  assert.equal(client.eval('state.selectedServer.code'), 'nl');
  assert.equal(client.eval('state.serverSwitchBusy'), false);
});

test('failed native stop preserves the existing tunnel and blocks misleading server changes', async () => {
  const client = makeClient({
    vpn_stop: async () => { throw new Error('Stop failed'); }
  });
  connected(client);
  await client.eval('selectServer(state.servers[1])');
  assert.deepEqual(client.calls.map(c => c.name), ['vpn_stop']);
  assert.equal(client.eval('state.selectedServer.code'), 'de');
  assert.equal(client.eval('state.vpnConnected'), true);
  assert.equal(client.eval('state.serverSwitchBusy'), false);
});

test('disconnected selection saves without launching VPN', async () => {
  const client = makeClient({ save_setting: async () => null });
  connected(client);
  client.eval('state.vpnConnected = false');
  await client.eval('selectServer(state.servers[1])');
  assert.deepEqual(client.calls.map(c => c.name), ['save_setting']);
  assert.equal(client.eval('state.selectedServer.code'), 'nl');
});

test('server list refresh cannot relabel an existing tunnel', async () => {
  const client = makeClient({
    get_servers: async () => [{code: 'nl', name: 'Netherlands', supported: true}]
  });
  connected(client);
  await client.eval('loadAvailableServers()');
  assert.equal(client.eval('state.selectedServer.code'), 'de');
  assert.equal(client.eval('state.servers.length'), 1);
});

test('a delayed status check must not reassert Connected after native disconnect', async () => {
  let finishStatus;
  const pendingStatus = new Promise(resolve => { finishStatus = resolve; });
  const client = makeClient({
    vpn_status: async () => pendingStatus,
    vpn_stop: async () => null
  });
  connected(client);
  const staleCheck = client.eval('checkVpnStatus()');
  await client.eval('toggleVpn()');
  finishStatus({connected: true, verified: true, connected_seconds: 200});
  await staleCheck;
  assert.equal(client.eval('state.vpnConnected'), false);
  assert.equal(client.eval('state.vpnVerified'), false);
});

test('parity controls are reachable and error state remains visible', () => {
  const client = makeClient({});
  assert.match(html, /id="btn-toggle-bypass-quick"[^>]*role="button" tabindex="0"/);
  assert.match(html, /id="home-connection-error"[^>]*role="alert"/);
  assert.match(html, /id="btn-refresh-servers"/);
  assert.equal(client.eval('I18N.en.refresh_servers'), 'Refresh servers');
  assert.equal(client.eval('I18N.ru.no_plan_trial_badge'), '3 ДНЯ БЕСПЛАТНО');
  assert.match(source, /state\.connectionError = errMsg/);
  assert.match(source, /state\.serverSwitchBusy/);
});
