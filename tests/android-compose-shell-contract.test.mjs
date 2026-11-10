import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('ui/index.html');
const css=read('ui/mobile-parity.css');
const rust=read('src-tauri/src/window_layout.rs');

test('Android Compose home has one shared server and subscription dock for connected/disconnected',()=>{
  assert.match(html,/id="home-shared-dock"/);
  assert.match(html,/id="home-state-no-plan"/);
  assert.match(html,/id="home-state-connected"/);
  assert.match(html,/id="home-state-disconnected"/);
  assert.match(html,/data-i18n="home_connection_kicker"/);
  assert.match(html,/data-i18n="home_location_title"/);
  assert.match(html,/id="home-server-country">Автоматически/);
  assert.equal((html.match(/id="home-sub-title"/g)||[]).length,1);
  assert.match(read('ui/app.js'),/sharedDock\?\.classList\?\.toggle\('hidden', !hasPlan \|\| accessUnknown\)/);
});

test('Tauri frontend loads Android mobile parity CSS after historical desktop styles',()=>{
  assert.match(html,/<link rel="stylesheet" href="\.\/mobile-parity\.css">/);
  assert.ok(html.indexOf('styles.css') < html.indexOf('mobile-parity.css'));
  assert.match(css,/\.app-shell-layout \.app-sidebar/);
  assert.match(css,/\.mobile-connection-kicker/);
  assert.match(css,/\.mobile-home-dock/);
  assert.match(css,/\.app-shell-layout \.app-main-frame/);
});

test('desktop starts landscape at up to 70% of monitor usable area',()=>{
  assert.match(rust,/MAX_MONITOR_AREA_SHARE: f64 = 0\.70/);
  assert.match(rust,/fn initial_window_size/);
  assert.match(read('src-tauri/src/main.rs'),/window_layout::fit_to_monitor/);
  const w=JSON.parse(read('src-tauri/tauri.conf.json')).app.windows[0];
  assert.ok(w.width >= 900 && w.height < w.width);
  assert.equal(w.maximized,false);
});

test('Android-style bottom nav uses vector icons and active underline instead of pill cards',()=>{
  const nav=html.match(/<nav class="sidebar-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1]||'';
  assert.equal((nav.match(/class="tab-icon"/g)||[]).length,3);
  assert.equal((nav.match(/<svg /g)||[]).length,3);
  assert.match(css,/\.sidebar-tab\.active::after/);
});
