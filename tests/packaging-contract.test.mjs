import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Tauri bundles the entire VPN runtime at its canonical installed location', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.deepEqual(config.bundle.resources, {
    '../vendor/runtime/windows-x64/': 'vendor/runtime/windows-x64/'
  });
  assert.deepEqual(config.bundle.targets, ['nsis', 'msi']);
});

test('Rust loader prioritizes packaged resources and recognizes pre-fix Tauri layout', () => {
  const code = read('src-tauri/src/service.rs');
  assert.match(code, /resource_dir\(\)/);
  assert.match(code, /bundled_runtime_candidates\(&resources\)/);
  assert.match(code, /resource_root\.join\("vendor\/runtime\/windows-x64"\)/);
  assert.match(code, /resource_root\.join\("_up_\/vendor\/runtime\/windows-x64"\)/);
  assert.match(code, /verify_runtime\(&directory\)/);
  assert.doesNotMatch(code, /if\s+dir\.exists\(\)\s*&&\s*dir\.join\("xray\.exe"\)\.exists\(\)/);
});

test('installer smoke test checks exact installed path and hashes, not mere file presence', () => {
  const script = read('scripts/smoke-msi.ps1');
  assert.match(script, /Split-Path -Parent \$executables\[0\]\.FullName/);
  assert.match(script, /Join-Path \$installedRoot "vendor\/runtime\/windows-x64"/);
  assert.match(script, /Get-FileHash -LiteralPath \$installed/);
  assert.match(script, /Get-FileHash -LiteralPath \$source/);
  for (const name of ['xray.exe', 'wintun.dll', 'geoip.dat', 'geosite.dat']) {
    assert.ok(script.includes('"' + name + '"'), 'missing check for ' + name);
  }
});

test('both CI and release run the installed-layout regression', () => {
  const ci = read('.github/workflows/ci.yml');
  const release = read('.github/workflows/release.yml');
  assert.match(ci, /\.\/scripts\/smoke-msi\.ps1/);
  assert.match(release, /\.\/scripts\/smoke-msi\.ps1/);
  assert.match(ci, /node --test tests\/\*\.test\.mjs/);
});
