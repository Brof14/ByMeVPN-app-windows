import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Tauri bundles the entire VPN runtime at its canonical installed location', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.deepEqual(config.bundle.resources, {
    '../vendor/runtime/windows-x64/': 'vendor/runtime/windows-x64/'
  });
  assert.deepEqual(config.bundle.targets, ['nsis']);
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

test('NSIS installer smoke test checks installed runtime and uninstall', () => {
  const script = read('scripts/smoke-nsis.ps1');
  assert.match(script, /ByMeVPN_\$\(\$config\.version\)_x64-setup\.exe/);
  assert.match(script, /Split-Path -Parent \$executables\[0\]\.FullName/);
  assert.match(script, /Join-Path \$installedRoot "vendor\/runtime\/windows-x64"/);
  assert.match(script, /Get-FileHash -LiteralPath \$installed/);
  assert.match(script, /Get-FileHash -LiteralPath \$source/);
  assert.match(script, /uninstall\.exe/);
  assert.match(script, /\/S/);
  for (const name of ['xray.exe', 'wintun.dll', 'geoip.dat', 'geosite.dat']) {
    assert.ok(script.includes('"' + name + '"'), 'missing check for ' + name);
  }
});

test('CI and release package only the NSIS installer and checksum', () => {
  const ci = read('.github/workflows/ci.yml');
  const release = read('.github/workflows/release.yml');
  assert.match(ci, /\.\/scripts\/smoke-nsis\.ps1/);
  assert.match(ci, /ParseFile\(\(Resolve-Path scripts\/package-installers\.ps1\)/);
  assert.match(release, /\.\/scripts\/smoke-nsis\.ps1/);
  assert.match(ci, /dist\/\*\.exe/);
  assert.match(release, /dist\/\*\.exe/);
  assert.doesNotMatch(ci, /dist\/\*\.msi|package-installers\.ps1[\s\S]{0,400}\.msi/);
  assert.doesNotMatch(release, /\.msi|ByMeVPN-portable-win-x64\.zip/);
  assert.match(ci, /node --test tests\/\*\.test\.mjs/);
});

test('packaging refuses to delete or overwrite a non-empty destination', () => {
  const script = read('scripts/package-installers.ps1');
  assert.match(script, /ByMeVPN_\$\(\$config\.version\)_x64-setup\.exe/);
  assert.match(script, /BYMEVPN_DIST_DIR/);
  assert.match(script, /Refusing to overwrite non-empty output directory/);
  assert.doesNotMatch(script, /Remove-Item\s+\$dist\s+-Recurse/);
});
