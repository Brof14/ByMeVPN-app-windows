import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const get = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const service = get('src-tauri/src/service.rs');
const tunConfig = get('src-tauri/src/tun_config.rs');
const tunHealth = get('src-tauri/src/tun_health.rs');
const egress = get('src-tauri/src/egress.rs');

test('selected VPN endpoint must respond before Xray takes over Windows TUN', () => {
  const start = service.slice(service.indexOf('pub async fn vpn_start('), service.indexOf('pub async fn vpn_stop('));
  const preflight = start.indexOf('preflight_xray_server(');
  const tunLaunch = start.indexOf('.arg(&config_path)', preflight);
  assert.ok(preflight > 0 && tunLaunch > preflight, 'preflight must finish before full tunnel starts');
  assert.match(start, /preflight_attestation_config\(&xray_config\)/);
  assert.match(start, /if !preflight_ok \{/);
  assert.match(start, /preflight_child\.kill\(\)/);
  assert.match(start, /preflight_child\.wait\(\)/);
  assert.match(tunConfig, /fn preflight_attestation_config\(/);
  assert.match(tunConfig, /"inbounds": \[probe\]/);
  assert.match(tunConfig, /"outboundTag": "proxy"/);
});

test('observed traffic without IP proof stays unverified; failed TUN proof is rolled back', () => {
  const start = service.slice(service.indexOf('pub async fn vpn_start('), service.indexOf('pub async fn vpn_stop('));
  assert.match(start, /if !proof\.traffic_confirmed\(\) \{/);
  assert.match(start, /let tunnel_ready = route_and_dns_ok && matches!\(child\.try_wait\(\), Ok\(None\)\)/);
  assert.match(start, /let verified_ip = tunnel_ready\.then\(\|\| proof\.verified_ip\(\)\)\.flatten\(\)/);
  assert.match(start, /if !tunnel_ready \{/);
  assert.match(start, /stop_failed_tun\(&mut child, &config_path\)\.await/);
  assert.match(start, /tokio::time::timeout\(Duration::from_secs\(9\)/);
  assert.match(start, /return Err\(/);
  assert.ok(start.indexOf('if !tunnel_ready') < start.indexOf('*lock = Some(ActiveTunnel {'));
  assert.match(egress, /TrafficObservedUnverified/);
  assert.match(egress, /BaselineUnavailable/);
  assert.match(start, /egress_verified: verified_ip\.is_some\(\)/);
  assert.match(service, /cleanup_bymevpn_routes_after_exit/);
  assert.match(tunHealth, /Remove-NetRoute/);
  assert.doesNotMatch(tunHealth, /Remove-NetRoute\s+-InterfaceIndex\s+\$env/);
});

test('missing transport proof is a failure, never a fabricated green status', () => {
  assert.match(egress, /pub async fn preflight_xray_server\(/);
  assert.match(egress, /timeout\(Duration::from_secs\(10\)/);
  assert.match(egress, /probe_egress\(client\)\.await\.is_some\(\)/);
  assert.match(service, /verify_tunnel_path\(/);
  assert.match(service, /last_tunnel_proof: proof/);
});
