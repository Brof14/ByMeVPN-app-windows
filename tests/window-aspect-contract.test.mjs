import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const win = JSON.parse(read('src-tauri/tauri.conf.json')).app.windows[0];
const source = read('src-tauri/src/window_layout.rs');

test('desktop launches wide and remains resizable', () => {
  assert.equal(win.width, 1080);
  assert.equal(win.height, 720);
  assert.ok(win.width > win.height);
  assert.ok(win.minWidth <= win.width);
  assert.ok(win.minHeight <= win.height);
  // A hard floor keeps the desktop layout legible instead of collapsing into
  // unreadable millimetres when the window is dragged small.
  assert.ok(win.minWidth >= 880, 'minimum width must keep the layout readable');
  assert.ok(win.minHeight >= 560, 'minimum height must keep the layout readable');
  assert.equal(win.resizable, true);
  assert.equal(win.maximized, false);
});

test('initial window is capped to 70% of the monitor usable area', () => {
  assert.match(source, /MAX_MONITOR_AREA_SHARE: f64 = 0\.70/);
  assert.match(source, /work_area\(\)/);
  assert.match(source, /scale_factor\(\)/);
  assert.match(source, /window\.set_size\(tauri::LogicalSize::new\(width, height\)\)/);
  assert.match(read('src-tauri/src/main.rs'), /window_layout::fit_to_monitor/);
});
