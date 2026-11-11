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

test('unverified full tunnel is immediately aborted, never left blocking the internet', () => {
  const start = service.slice(service.indexOf('pub async fn vpn_start('), service.indexOf('pub async fn vpn_stop('));
  assert.match(start, /if verified_ip\.is_none\(\) \{/);
  assert.match(start, /stop_failed_tun\(&mut child, &config_path\)\.await/);
  assert.match(start, /tokio::time::timeout\(Duration::from_secs\(9\)/);
  assert.match(start, /return Err\(/);
  assert.ok(start.indexOf('if verified_ip.is_none()') < start.indexOf('*lock = Some(ActiveTunnel {'));
  assert.match(service, /cleanup_bymevpn_routes_after_exit/);
  assert.match(tunHealth, /Remove-NetRoute/);
  assert.doesNotMatch(tunHealth, /Remove-NetRoute\s+-InterfaceIndex\s+\$env/);
});

test('missing transport proof is a failure, never a fabricated green status', () => {
  assert.match(egress, /pub async fn preflight_xray_server\(/);
  assert.match(egress, /timeout\(Duration::from_secs\(7\)/);
  assert.match(service, /verify_tunnel_path\(/);
  assert.match(service, /last_tunnel_proof: proof/);
});
