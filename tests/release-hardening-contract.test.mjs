import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const native = read('src-tauri/src/service.rs');
const main = read('src-tauri/src/main.rs');
const job = read('src-tauri/src/windows_job.rs');
const cargo = read('src-tauri/Cargo.toml');
const ci = read('.github/workflows/ci.yml');
const transport = read('src-tauri/src/api_transport.rs');
const frontend = read('ui/app.js');

test('Windows VPN process is owned by kill-on-close Job Object', () => {
  assert.match(job, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(job, /AssignProcessToJobObject/);
  assert.match(job, /impl Drop for ChildJob/);
  assert.match(job, /closing_job_handle_terminates_tracked_child/);
  assert.match(native, /ChildJob::attach\(&child\)/);
  assert.match(native, /_job: child_job/);
  assert.match(cargo, /Win32_System_JobObjects/);
  assert.match(main, /mod windows_job;/);
});

test('VPN session is revoked on all post-creation start failures', () => {
  assert.match(native, /let connection_result: Result<TunnelMetrics, String> = async \{/);
  assert.match(native, /if connection_result\.is_err\(\) \{/);
  assert.match(native, /remove_file\(dir\.join\("active_tunnel\.json"\)\)/);
  assert.match(native, /request\(&app, Method::DELETE, "\/vpn\/session", None, true, false\)\.await/);
});

test('stale credential-bearing Hysteria ping configs are cleaned on startup', () => {
  const cleanup = native.split('pub fn cleanup_stale_server_ping_configs(')[1].split('\n}\n')[0];
  assert.match(cleanup, /extension\(\)/);
  assert.match(cleanup, /starts_with\("server-ping-"\)/);
  assert.match(main, /cleanup_stale_server_ping_configs\(&dir\)/);
});

test('VPN watchdog tolerates one missed probe, fails closed on proven leak, and can reconnect', () => {
  assert.match(native, /let mut revoke_session = false;/);
  assert.match(native, /should_restart_after_health_probe\(/);
  assert.match(native, /proof == TunnelProof::RoutingBypass/);
  assert.match(native, /\*consecutive_failures >= 2/);
  assert.match(native, /if restart \{/);
  assert.match(native, /cleanup_bymevpn_routes_after_exit\(\)\.await/);
  assert.match(native, /revoke_session = true;/);
  assert.match(native, /if revoke_session \{/);
  assert.match(main, /vpn_status\(\s*watchdog\.clone\(\),\s*watchdog\.state/);
  assert.match(main, /auto_reconnect_if_due\(watchdog\.clone\(\)\)/);
  assert.match(main, /interval\(std::time::Duration::from_secs\(2\)\)/);
});

test('catalogue latency is one TCP handshake and never starts Xray per row', () => {
  assert.match(native, /async fn measure_tcp_rtt\(/);
  assert.match(native, /tokio::net::TcpStream::connect\(\(host, port\)\)/);
  assert.match(native, /Semaphore::new\(6\)/);
  assert.match(native, /rtt_targets\.push\(/);
  assert.match(native, /JoinSet::new\(\)/);
  assert.match(native, /"ping_method": "vpn_https"/);
  assert.match(native, /app\.emit\(\s*"server-latency-update"/);
  // A fresh connect reports the endpoint round trip, not the HTTPS time of a
  // cold tunnel, so the displayed ping stays truthful.
  assert.match(native, /measure_tcp_rtt\(host, endpoint_port\)/);
});

test('preview builds stay drafts while a tagged release is published', () => {
  assert.match(ci, /preview-release:/);
  assert.match(ci, /draft: true/);
  const release = read('.github/workflows/release.yml');
  assert.match(release, /draft: false/);
  assert.doesNotMatch(release, /prerelease: true/);
});

test('Telegram login ticket is never sent in a URL on server errors', () => {
  const check = native.split('pub async fn telegram_check_session(')[1]
    .split('#[tauri::command]')[0];
  assert.match(check, /Method::POST,\s*"\/auth\/telegram\/check-session"/);
  assert.doesNotMatch(check, /check-session\?token=/);
});

test('account deletion requires explicit backend confirmation and clears only the same session', () => {
  assert.match(transport, /path == "\/me" && method == Method::DELETE/);
  assert.match(transport, /X-Confirm-Account-Deletion", "DELETE"/);
  const deletion = native.split('pub async fn auth_delete_account(')[1]
    .split('#[tauri::command]')[0];
  assert.match(deletion, /stop_tunnel_and_restore_network\(&state\)\.await\?/);
  assert.match(deletion, /request_in_session\([\s\S]*Some\(generation\)/);
  assert.match(deletion, /require_same_session\(generation, AUTH_GENERATION\.load/);
  assert.match(deletion, /clear_secrets\(\)/);
});

test('device deletion pins the request to the confirmed native session generation', () => {
  assert.match(native, /pub async fn delete_device\([\s\S]*?generation: u64/);
  const deleteDevice = native.split('pub async fn delete_device(')[1].split('#[tauri::command]')[0];
  assert.match(deleteDevice, /request_in_session\([\s\S]*?Some\(generation\)/);
  assert.match(frontend, /invoke\('delete_device', \{ deviceId, generation \}\)/);
  assert.match(frontend, /if \(!sameAccount\(\) \|\| state\.deviceRemovalBusy\) return;/);
});

test('server latency events are subscribed before the initial catalog request', () => {
  assert.match(frontend, /await setupServerLatencyListener\(\);\s*await loadInitialData\(\);/);
  assert.match(frontend, /async function setupServerLatencyListener\(\)/);
});
