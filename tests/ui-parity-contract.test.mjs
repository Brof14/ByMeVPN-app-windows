import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const js = read('ui/app.js');
const html = read('ui/index.html');
const css = read('ui/styles.css');

test('home navigation and visual tokens match current Android V2 baseline', () => {
  assert.match(js, /nav_connection: 'Главная'/);
  assert.match(js, /nav_connection: 'Home'/);
  for (const token of ['#090f1d', '#121c2b', '#69d3bc']) {
    assert.ok(css.toLowerCase().includes(token), 'Android V2 token missing: ' + token);
  }
  assert.match(css, /assets\/byme-connect-shield\.png/);
});

test('unknown or unavailable entitlement never renders active VPN controls', () => {
  assert.match(js, /const accessUnknown = !sub \|\| sub\.status === 'unknown'/);
  assert.match(js, /const hasPlan = sub && \['active', 'trial', 'grace'\]\.includes\(sub\.status\)/);
  assert.match(js, /else if \(accessUnknown\) \{/);
  assert.match(js, /Retry verification/);
  assert.match(js, /ring\?\.setAttribute\('aria-disabled', String\(accessUnknown && !isConn\)\)/);
  assert.match(js, /void refreshAccountSnapshot\(true\)/);
  assert.doesNotMatch(js, /'active', 'trial', 'grace', 'unknown'\]\.includes\(sub\.status\)/);
});

test('all clickable non-button cards are keyboard-operable', () => {
  const ids = [
    'btn-acc-open-devices', 'btn-open-server-picker', 'btn-active-location-pill',
    'row-server-info', 'btn-open-manage-pricing', 'card-support-channel',
    'card-support-faq', 'tile-faq-modal', 'tile-support-telegram',
    'tile-privacy-policy', 'tile-terms-of-use'
  ];
  for (const id of ids) {
    const tag = html.match(new RegExp('<div[^>]*id="' + id + '"[^>]*>'));
    assert.ok(tag, 'Missing card ' + id);
    assert.match(tag[0], /role="button"/);
    assert.match(tag[0], /tabindex="0"/);
  }
  assert.match(js, /element\.click\(\)/);
});

test('no invented German server or unsupported no-advertising promise on the home screen', () => {
  assert.match(html, /id="home-server-country">Автоматически/);
  assert.doesNotMatch(html, /id="home-server-country">Германия/);
  assert.doesNotMatch(html, /<span>Без рекламы<\/span>/);
});
