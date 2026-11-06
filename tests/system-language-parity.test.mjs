import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const js = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
const rust = readFileSync(new URL('../src-tauri/src/service.rs', import.meta.url), 'utf8');

function localeHarness(language) {
  const document = {
    documentElement: { lang: 'ru' },
    addEventListener() {},
    getElementById() { return null; },
    querySelectorAll() { return []; }
  };
  const sandbox = createContext({
    console, document, navigator: { language },
    window: {}, setTimeout, clearTimeout, setInterval, clearInterval
  });
  runInContext(js, sandbox);
  return { eval: expression => runInContext(expression, sandbox), document };
}

test('Android parity: system mode is the persisted default and a selectable UI option', () => {
  assert.match(rust, /"language": "system"/);
  assert.match(rust, /Some\("ru" \| "en" \| "system"\)/);
  assert.match(html, /data-lang="system"/);
  assert.match(js, /system_language: 'Системный'/);
  assert.match(js, /system_language: 'System'/);
});

test('system language resolves English locale and English regional variants', () => {
  for (const locale of ['en', 'en-US', 'EN-gb']) {
    const app = localeHarness(locale);
    assert.equal(app.eval('effectiveLanguage()'), 'en');
    assert.equal(app.eval("uiText('Привет', 'Hello')"), 'Hello');
    app.eval("applyLanguage('system')");
    assert.equal(app.document.documentElement.lang, 'en');
  }
});

test('system language resolves unsupported locales to Russian', () => {
  for (const locale of ['ru-RU', 'de-DE', '']) {
    const app = localeHarness(locale);
    assert.equal(app.eval('effectiveLanguage()'), 'ru');
    app.eval("applyLanguage('system')");
    assert.equal(app.document.documentElement.lang, 'ru');
  }
});

test('explicit choice overrides the system locale', () => {
  const app = localeHarness('en-US');
  app.eval("state.settings.language = 'ru'");
  assert.equal(app.eval('effectiveLanguage()'), 'ru');
  app.eval("state.settings.language = 'en'");
  assert.equal(app.eval('effectiveLanguage()'), 'en');
});
