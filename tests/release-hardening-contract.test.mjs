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
});

test('nonblocking validation and capped ping probes protect responsiveness', () => {
  assert.match(native, /spawn_blocking\(move \|\| \{/);
  assert.match(native, /Semaphore::new\(6\)/);
  assert.match(native, /let hysteria_ping_slots = .*Semaphore::new\(2\)/);
  assert.match(native, /if should_probe && probe_supported && cached_ping\.is_none\(\)/);
  assert.match(native, /measure_hysteria_latency\(runtime, directory, session\)/);
  assert.match(native, /measure_xray_server_latency\(port, &password\)/);
  assert.match(native, /JoinSet::new\(\)/);
  assert.match(native, /SERVER_PING_CACHE_TTL: Duration = Duration::from_secs\(600\)/);
  assert.match(native, /protocol\.eq_ignore_ascii_case\("hysteria2"\)/);
  assert.match(native, /tokio::time::timeout_at\(deadline, ping_tasks\.join_next\(\)\)/);
  assert.match(native, /ping_tasks\.abort_all\(\)/);
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
