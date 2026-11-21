import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const get = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const engine = get('src-tauri/src/vpn_service_engine.rs');
const tunConfig = get('src-tauri/src/tun_config.rs');
const tunHealth = get('src-tauri/src/tun_health.rs');
const egress = get('src-tauri/src/egress.rs');
const startTunnel = engine.slice(engine.indexOf('async fn start_tunnel('), engine.indexOf('#[cfg(windows)]\nfn spawn_xray'));

test('selected VPN endpoint must respond before Xray takes over Windows TUN', () => {
  const preflight = startTunnel.indexOf('preflight_xray_server(');
  const tunLaunch = startTunnel.indexOf('spawn_xray(&runtime, &config_path)');
  assert.ok(preflight > 0 && tunLaunch > preflight, 'preflight must finish before full tunnel starts');
  assert.match(startTunnel, /preflight_attestation_config\(&config\)/);
  assert.match(startTunnel, /if !reachable \{/);
  assert.match(startTunnel, /Duration::from_secs\(5\)/);
  assert.match(startTunnel, /child\.kill\(\)/);
  assert.match(startTunnel, /child\.wait\(\)/);
  assert.match(tunConfig, /fn preflight_attestation_config\(/);
  assert.match(tunConfig, /"inbounds": \[probe\]/);
  assert.match(tunConfig, /"outboundTag": "proxy"/);
});

test('observed traffic without IP proof stays unverified; failed TUN proof is rolled back', () => {
  assert.match(startTunnel, /if !proof\.traffic_confirmed\(\) \{/);
  assert.match(startTunnel, /if !healthy \|\| !matches!\(child\.try_wait\(\), Ok\(None\)\)/);
  assert.match(startTunnel, /tokio::time::timeout\(Duration::from_secs\(12\)/);
  assert.match(startTunnel, /return Err\(/);
  assert.ok(startTunnel.indexOf('if !healthy') < startTunnel.indexOf('Ok(ActiveTunnel {'));
  assert.match(engine, /verified: active\.verified_ip\.is_some\(\)/);
  assert.match(egress, /TrafficObservedUnverified/);
  assert.match(egress, /BaselineUnavailable/);
  assert.match(startTunnel, /verified_ip: proof\.verified_ip\(\)/);
  assert.match(startTunnel, /cleanup_bymevpn_routes_after_exit_sync/);
  assert.match(tunHealth, /Remove-NetRoute/);
  assert.doesNotMatch(tunHealth, /Remove-NetRoute\s+-InterfaceIndex\s+\$env/);
});

test('missing transport proof is a failure, never a fabricated green status', () => {
  assert.match(egress, /pub async fn preflight_xray_server\(/);
  assert.match(egress, /timeout\(Duration::from_secs\(10\)/);
  assert.match(egress, /probe_egress\(client\)\.await\.is_some\(\)/);
  assert.match(engine, /verify_tunnel_path\(/);
  assert.match(engine, /active\.proof = proof/);
  assert.match(engine, /proof\.status\(\)/);
});
