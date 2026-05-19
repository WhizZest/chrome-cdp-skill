import assert from 'assert/strict';
import { describe, test, testAsync, summary, onCleanup } from '../lib/test-runner.mjs';
import { existsSync, readFileSync, writeFileSync, unlinkSync, copyFileSync } from 'fs';
import {
  LAST_BROWSER_FILE,
  BROWSERS,
} from '../../skills/chrome-cdp/scripts/lib/constants.mjs';
import {
  pickBrowser,
  saveLastBrowser,
  loadLastBrowser,
} from '../../skills/chrome-cdp/scripts/lib/cdp-client.mjs';

const IS_WINDOWS = process.platform === 'win32';

function backupLastBrowser() {
  if (existsSync(LAST_BROWSER_FILE)) {
    try {
      copyFileSync(LAST_BROWSER_FILE, LAST_BROWSER_FILE + '.backup');
    } catch {}
  }
}

function restoreLastBrowser() {
  try {
    if (existsSync(LAST_BROWSER_FILE + '.backup')) {
      copyFileSync(LAST_BROWSER_FILE + '.backup', LAST_BROWSER_FILE);
      unlinkSync(LAST_BROWSER_FILE + '.backup');
    } else if (existsSync(LAST_BROWSER_FILE)) {
      unlinkSync(LAST_BROWSER_FILE);
    }
  } catch {}
}

backupLastBrowser();
onCleanup(restoreLastBrowser);

describe('browser-picker: saveLastBrowser / loadLastBrowser', () => {
  test('loadLastBrowser returns null when no file exists', () => {
    try { unlinkSync(LAST_BROWSER_FILE); } catch {}
    assert.equal(loadLastBrowser(), null);
  });

  test('saveLastBrowser writes and loadLastBrowser reads back', () => {
    saveLastBrowser('edge');
    assert.equal(loadLastBrowser(), 'edge');
  });

  test('saveLastBrowser overwrites previous value', () => {
    saveLastBrowser('chrome');
    assert.equal(loadLastBrowser(), 'chrome');
    saveLastBrowser('edge');
    assert.equal(loadLastBrowser(), 'edge');
  });

  test('saveLastBrowser stores valid JSON', () => {
    saveLastBrowser('chrome');
    const raw = JSON.parse(readFileSync(LAST_BROWSER_FILE, 'utf8'));
    assert.equal(raw.browser, 'chrome');
  });
});

describe('browser-picker: pickBrowser', () => {
  test('throws on unknown browser id', () => {
    assert.throws(
      () => pickBrowser('firefox'),
      /Unknown browser: firefox/
    );
  });

  test('error message lists available browsers', () => {
    try {
      pickBrowser('safari');
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e.message.includes('chrome'), 'should mention chrome');
      if (IS_WINDOWS) {
        assert.ok(e.message.includes('edge'), 'should mention edge');
      }
    }
  });

  test('explicit browser: either succeeds or throws executable-not-found', () => {
    try {
      const result = pickBrowser('chrome');
      assert.equal(result.id, 'chrome');
      assert.equal(result.name, 'Google Chrome');
      assert.ok(existsSync(result.executable));
    } catch (e) {
      assert.ok(
        e.message.includes('executable not found'),
        `expected "executable not found" but got: ${e.message}`
      );
    }
  });

  test('auto-select returns valid browser object (or throws No browser found)', () => {
    try {
      const result = pickBrowser();
      assert.ok(result.id);
      assert.ok(result.name);
      assert.ok(result.executable);
      assert.ok(existsSync(result.executable));
    } catch (e) {
      assert.ok(
        e.message.includes('No browser found'),
        `expected "No browser found" but got: ${e.message}`
      );
    }
  });
});

summary();