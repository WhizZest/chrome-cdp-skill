import assert from 'assert/strict';
import { describe, test, summary } from '../lib/test-runner.mjs';
import { BROWSERS, LAST_BROWSER_FILE, RUNTIME_DIR } from '../../skills/chrome-cdp/scripts/lib/constants.mjs';

const IS_WINDOWS = process.platform === 'win32';

describe('constants: BROWSERS structure', () => {
  test('BROWSERS is non-empty array', () => {
    assert.ok(Array.isArray(BROWSERS));
    assert.ok(BROWSERS.length >= 1);
  });

  test('chrome entry exists with required fields', () => {
    const chrome = BROWSERS.find(b => b.id === 'chrome');
    assert.ok(chrome, 'chrome entry missing');
    assert.equal(chrome.name, 'Google Chrome');
    assert.ok(Array.isArray(chrome.executables));
    assert.ok(chrome.executables.length >= 1);
  });

  test('edge entry exists with required fields', () => {
    if (!IS_WINDOWS) return;
    const edge = BROWSERS.find(b => b.id === 'edge');
    assert.ok(edge, 'edge entry missing');
    assert.equal(edge.name, 'Microsoft Edge');
    assert.ok(Array.isArray(edge.executables));
    assert.ok(edge.executables.length >= 3);
  });

  test('all browsers have unique ids', () => {
    const ids = BROWSERS.map(b => b.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate browser ids');
  });

  test('all executables are absolute paths (Windows)', () => {
    if (!IS_WINDOWS) return;
    for (const browser of BROWSERS) {
      for (const exe of browser.executables) {
        assert.ok(exe.startsWith('C:\\'),
          `${browser.id}: ${exe} is not absolute`);
      }
    }
  });
});

describe('constants: LAST_BROWSER_FILE', () => {
  test('LAST_BROWSER_FILE is inside RUNTIME_DIR', () => {
    assert.ok(LAST_BROWSER_FILE.startsWith(RUNTIME_DIR),
      `LAST_BROWSER_FILE (${LAST_BROWSER_FILE}) should start with RUNTIME_DIR (${RUNTIME_DIR})`);
  });

  test('LAST_BROWSER_FILE ends with last-browser.json', () => {
    assert.ok(LAST_BROWSER_FILE.endsWith('last-browser.json'));
  });
});

summary();