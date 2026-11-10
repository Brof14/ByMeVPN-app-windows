import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const win = JSON.parse(read('src-tauri/tauri.conf.json')).app.windows[0];
const source = read('src-tauri/src/window_layout.rs');

test('new default opens as a compact portrait window with full user resize control', () => {
  assert.equal(win.width, 480);
  assert.equal(win.height, 720);
  assert.ok(win.width < win.height);
  assert.ok(win.minWidth <= win.width);
  assert.ok(win.minHeight <= win.height);
  assert.equal(win.resizable, true);
  assert.equal(win.maximized, false);
});

test('initial window is capped to 70% of actual monitor work area', () => {
  assert.match(source, /MAX_MONITOR_SHARE: f64 = 0\.70/);
  assert.match(source, /work_area\(\)/);
  assert.match(source, /scale_factor\(\)/);
  assert.match(source, /window\.set_size\(tauri::LogicalSize::new\(width, height\)\)/);
  assert.match(read('src-tauri/src/main.rs'), /window_layout::fit_to_monitor/);
});
