import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL('../'+name,import.meta.url),'utf8');
const html = read('ui/index.html');
const desktop = read('ui/desktop-layout.css');

test('desktop shell uses persistent workstation navigation and full-width content', () => {
  assert.match(html, /<link rel="stylesheet" href="\.\/desktop-layout\.css">/);
  assert.ok(html.indexOf('mobile-parity.css') < html.indexOf('desktop-layout.css'));
  assert.match(desktop, /@media\s*\(min-width:\s*760px\)/);
  assert.match(desktop, /\.app-shell-layout\s+\.app-sidebar\s*\{[^}]*position:\s*relative/s);
  assert.match(desktop, /\.app-shell-layout\s+\.sidebar-nav\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(desktop, /\.app-shell-layout\s+\.app-main-frame\s*\{[^}]*flex:\s*1\s+1\s+auto/s);
  assert.match(desktop, /@media\s*\(min-width:\s*1180px\)[\s\S]*?#tab-home\.active\s*\{[^}]*grid-template-columns/s);
});

test('desktop server selection is a centered dialog with search available', () => {
  assert.match(desktop, /@media\s*\(min-width:\s*760px\)[\s\S]*?#tab-servers\.active\s*\{[^}]*align-items:\s*center/s);
  assert.match(desktop, /#tab-servers\s+\.mobile-sheet-drag\s*\{\s*display:\s*none/s);
  assert.match(desktop, /#tab-servers\s+\.search-input-box\s*\{\s*display:\s*flex/s);
});

test('desktop-only styles do not move Android snackbars into the titlebar area', () => {
  assert.doesNotMatch(desktop, /\.toast-popup\s*\{[^}]*top:\s*\d+px/s);
  assert.doesNotMatch(desktop, /\.toast-popup\s*\{[^}]*bottom:\s*auto/s);
});

test('a status verification failure is shown as persistent inline warning, not repeated toast', () => {
  assert.match(html, /id="home-verification-notice"/);
  const js = read('ui/app.js');
  assert.match(js, /home-verification-notice/);
  assert.doesNotMatch(js,/showToast\(state\.vpnVerified\s*\?/);
});
test('wide desktop sign-in gives the brand and form separate balanced columns', () => {
  assert.match(desktop, /@media\s*\(min-width:\s*1024px\)[\s\S]*?#view-auth\.auth-view\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(420px,\s*540px\)/s);
});

test('no-plan shield keeps the Android 130dp compact and 210dp full-size rules', () => {
  const parity = read('ui/mobile-parity.css');
  assert.match(parity, /#tab-home \.no-plan-shield-circle\s*\{[^}]*width:\s*clamp\(130px,\s*30dvh,\s*210px\)/s);
  assert.match(parity, /@media\s*\(max-height:\s*600px\)[\s\S]*?\.no-plan-shield-circle\s*\{\s*width:\s*130px;\s*height:\s*130px/s);
});

