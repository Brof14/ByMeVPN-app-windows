import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const native = read('src-tauri/src/service.rs');
const main = read('src-tauri/src/main.rs');
const job = read('src-tauri/src/windows_job.rs');
const cargo = read('src-tauri/Cargo.toml');
const ci = read('.github/workflows/ci.yml');

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

test('VPN watchdog tears down server session on crash or proven leak', () => {
  assert.match(native, /let mut revoke_session = false;/);
  assert.match(native, /TunnelProof::RoutingBypass/);
  assert.match(native, /revoke_session = true;/);
  assert.match(native, /if revoke_session \{/);
  assert.match(main, /vpn_status\(\s*watchdog\.clone\(\),\s*watchdog\.state/);
});

test('nonblocking validation and capped ping probes protect responsiveness', () => {
  assert.match(native, /spawn_blocking\(move \|\| \{/);
  assert.match(native, /Semaphore::new\(6\)/);
  assert.match(native, /if supported\s*&& protocol_supports_tcp_ping\(config\)\s*&& !host\.is_empty\(\)/);
  assert.match(native, /protocol\.eq_ignore_ascii_case\("hysteria2"\)/);
  assert.match(native, /tokio::time::timeout_at\(deadline, &mut task\)/);
  assert.match(native, /task\.abort\(\)/);
});

test('experimental builds are not auto published to paying clients', () => {
  assert.match(ci, /preview-release:/);
  assert.match(ci, /draft: true/);
  assert.match(read('.github/workflows/release.yml'), /draft: true/);
});
