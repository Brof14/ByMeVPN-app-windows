import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const native = read('src-tauri/src/service.rs');
const engine = read('src-tauri/src/vpn_service_engine.rs');
const vpnService = read('src-tauri/src/vpn_service.rs');
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
  assert.match(engine, /ChildJob::attach\(&child\)/);
  assert.match(engine, /_job: job/);
  assert.match(cargo, /Win32_System_JobObjects/);
  assert.match(main, /mod windows_job;/);
});

test('VPN session is revoked on all post-creation start failures', () => {
  const connect = engine.slice(engine.indexOf('async fn connect('), engine.indexOf('fn api_client('));
  const startup = connect.slice(connect.indexOf('let active = match start_tunnel('));
  assert.match(startup, /Err\(error\) => \{/);
  assert.match(startup, /cleanup_bymevpn_routes_after_exit_sync/);
  assert.match(startup, /Method::DELETE,[\s\S]*?"\/vpn\/session"/);
});

test('stale credential-bearing Hysteria ping configs are cleaned on startup', () => {
  const cleanup = native.split('pub fn cleanup_stale_server_ping_configs(')[1].split('\n}\n')[0];
  assert.match(cleanup, /extension\(\)/);
  assert.match(cleanup, /starts_with\("server-ping-"\)/);
  assert.match(main, /cleanup_stale_server_ping_configs\(&dir\)/);
});

test('VPN watchdog tolerates one missed probe, fails closed on proven leak, and can reconnect', () => {
  assert.match(engine, /fn should_disconnect_after_health\(/);
  assert.match(engine, /proof == TunnelProof::RoutingBypass/);
  assert.match(engine, /\*failures >= 2/);
  assert.match(engine, /async fn disconnect_lost_tunnel\(/);
  assert.match(engine, /stop_active\(active, true\)/);
  assert.match(engine, /pub async fn watchdog\(\)/);
  assert.match(engine, /plan\.auto_reconnect/);
  assert.match(engine, /const DELAYS: \[u64; 5\] = \[2, 4, 8, 16, 30\]/);
  assert.match(vpnService, /for _ in 0\.\.20/);
  assert.match(vpnService, /Duration::from_millis\(100\)/);
  assert.doesNotMatch(main, /auto_reconnect_if_due/);
});

test('protocol latency probes run asynchronously and never delay server catalog delivery', () => {
  assert.match(native, /spawn_blocking\(move \|\| \{/);
  assert.match(native, /Semaphore::new\(2\)/);
  assert.match(native, /force_probe == Some\(true\) \|\| cached_ping\.is_none\(\)/);
  assert.match(native, /measure_proxy_latency\(runtime_dir, app_dir, session\)/);
  assert.match(native, /measure_xray_server_latency\(port, &password\)/);
  assert.match(native, /JoinSet::new\(\)/);
  assert.match(native, /SERVER_PING_CACHE_TTL: Duration = Duration::from_secs\(600\)/);
  assert.match(native, /"ping_method": "vpn_https"/);
  assert.match(native, /app\.emit\(\s*"server-latency-update"/);
  assert.match(native, /Return the server list immediately/);
  assert.match(native, /SERVER_PING_EPOCH\.fetch_add\(1, Ordering::SeqCst\)/);
  assert.match(native, /wait_for_server_probe_cancellation\(probe_epoch\)/);
  assert.match(native, /timeout\(\s*Duration::from_secs\(7\)/);
  assert.doesNotMatch(native, /measure_real_ping|tcp_ping_target/);
  assert.doesNotMatch(native, /timeout_at\(deadline, ping_tasks\.join_next\(\)\)/);
});

test('experimental builds are not auto published to paying clients', () => {
  assert.match(ci, /preview-release:/);
  assert.match(ci, /draft: true/);
  assert.match(read('.github/workflows/release.yml'), /draft: true/);
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
