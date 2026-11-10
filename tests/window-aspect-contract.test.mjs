import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const windowConfig = config.app.windows[0];

test('ByMeVPN starts in the requested 3:2 desktop window, with a proportional minimum', () => {
  assert.equal(windowConfig.width * 2, windowConfig.height * 3);
  assert.equal(windowConfig.minWidth * 2, windowConfig.minHeight * 3);
  assert.ok(windowConfig.minWidth < windowConfig.width);
  assert.ok(windowConfig.minHeight < windowConfig.height);
  assert.equal(windowConfig.resizable, true);
  assert.equal(windowConfig.maximized, false);
});
