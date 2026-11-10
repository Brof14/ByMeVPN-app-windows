import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL('../'+name,import.meta.url),'utf8');
const html = read('ui/index.html');
const desktop = read('ui/desktop-layout.css');

test('desktop screen has its own landscape grid without changing Android-sized mobile view', () => {
  assert.match(html, /<link rel="stylesheet" href="\.\/desktop-layout\.css">/);
  assert.ok(html.indexOf('mobile-parity.css') < html.indexOf('desktop-layout.css'));
  assert.match(desktop, /@media \(min-width: 760px\)/);
  assert.match(desktop, /#tab-home\.active/);
  assert.match(desktop, /grid-template-columns:\s*minmax\(0,/);
  assert.match(desktop, /\.app-sidebar/);
});

test('short lived toasts appear away from bottom navigation at every window size', () => {
  assert.match(desktop, /\.toast-popup/);
  assert.match(desktop, /top:\s*\d+px/);
  assert.match(desktop, /bottom:\s*auto/);
  assert.match(desktop, /max-width/);
});

test('a status verification failure is shown as persistent inline warning, not repeated toast', () => {
  assert.match(html, /id="home-verification-notice"/);
  const js = read('ui/app.js');
  assert.match(js, /home-verification-notice/);
  assert.doesNotMatch(js,/showToast\(state\.vpnVerified\s*\?/);
});
test('desktop sign-in balances Android branding and real auth form without horizontal clipping', () => {
  assert.match(desktop, /#view-auth\.auth-view/);
  assert.match(desktop, /\.auth-hero-side/);
  assert.match(desktop, /\.auth-card-side/);
  assert.match(desktop, /grid-template-columns:/);
});

