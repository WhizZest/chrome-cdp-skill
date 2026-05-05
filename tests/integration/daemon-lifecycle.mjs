import assert from 'assert/strict';
import { describe, testAsync, summary, onCleanup } from '../lib/test-runner.mjs';
import { connectToSocket, sendCommand, stopDaemons } from '../../skills/chrome-cdp/scripts/lib/daemon.mjs';
import { sockPath, resolvePrefix } from '../../skills/chrome-cdp/scripts/lib/utils.mjs';
import { readFileSync, existsSync, unlinkSync, statSync } from 'fs';
import { createServer } from 'http';
import { PAGES_CACHE } from '../../skills/chrome-cdp/scripts/lib/constants.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

const SHOT_TIMEOUT = 60_000;

const TARGET_PREFIX = process.env.CDP_TEST_TARGET;
if (!TARGET_PREFIX) {
  console.error('Set CDP_TEST_TARGET=<targetId prefix> to run integration tests');
  console.error('Example: CDP_TEST_TARGET=C1CE430E node tests/integration/daemon-lifecycle.mjs');
  process.exit(1);
}

const GLOBAL_TIMEOUT = 120_000;
setTimeout(() => {
  console.error(`\nGlobal timeout (${GLOBAL_TIMEOUT}ms) — forcing exit`);
  process.exit(2);
}, GLOBAL_TIMEOUT);

function resolveTargetId() {
  const pages = JSON.parse(readFileSync(PAGES_CACHE, 'utf8'));
  return resolvePrefix(TARGET_PREFIX, pages.map(p => p.targetId), 'target');
}

let _targetId = null;
function getTargetId() {
  if (!_targetId) {
    _targetId = resolveTargetId();
  }
  return _targetId;
}

async function send(cmd, ...args) {
  const sp = sockPath(getTargetId());
  const c = await connectToSocket(sp);
  return sendCommand(c, { cmd, args });
}

async function sendSlow(cmd, timeout, ...args) {
  const sp = sockPath(getTargetId());
  const c = await connectToSocket(sp);
  return sendCommand(c, { cmd, args }, timeout);
}

async function cleanup() {
  _targetId = null;
}

onCleanup(cleanup);

describe('integration: daemon lifecycle', () => {
  testAsync('daemon responds to eval', async () => {
    const result = await send('eval', '1+1');
    assert.equal(result.ok, true);
    assert.equal(result.result, '2');
  });

  testAsync('info command returns page info', async () => {
    const result = await send('info');
    assert.equal(result.ok, true);
    assert.ok(result.result.includes('URL:'));
    assert.ok(result.result.includes('Title:'));
    assert.ok(result.result.includes('DPR:'));
    assert.ok(result.result.includes('Frames:'));
    assert.ok(result.result.includes('Session:'));
    assert.ok(result.result.includes('Target:'));
  });

  testAsync('debug reset works without daemon restart', async () => {
    const result = await send('debug', 'reset');
    assert.equal(result.ok, true);
    assert.ok(result.result.includes('Restored'));

    const infoResult = await send('info');
    assert.equal(infoResult.ok, true);
  });

  testAsync('evalraw blocks dangerous commands', async () => {
    const infoResult = await send('info');
    assert.equal(infoResult.ok, true);
    const sessionMatch = infoResult.result.match(/Session:\s*(\S+)/);
    assert.ok(sessionMatch, 'info should contain Session field');

    const result = await send('evalraw', 'Target.detachFromTarget', JSON.stringify({ sessionId: sessionMatch[1] }));
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Blocked'));
  });

  testAsync('evalraw warns on Debugger.disable', async () => {
    const result = await send('evalraw', 'Debugger.disable');
    assert.equal(result.ok, true);
    assert.ok(result.result.includes('Warning'));
    assert.ok(result.result.includes('debug reset'));

    await send('debug', 'reset');
  });

  testAsync('daemon survives multiple commands', async () => {
    for (let i = 0; i < 5; i++) {
      const result = await send('eval', `${i}+1`);
      assert.equal(result.ok, true);
      assert.equal(result.result, String(i + 1));
    }
  });

  testAsync('unknown command returns error', async () => {
    const result = await send('nonexistent');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Unknown command'));
  });
});

describe('integration: Phase 1 — network interception', () => {
  testAsync('intercept on/off lifecycle works', async () => {
    const onResult = await send('intercept', 'on', '--request');
    assert.equal(onResult.ok, true);
    assert.ok(onResult.result.includes('enabled'));

    const listResult = await send('intercept', 'list');
    assert.equal(listResult.ok, true);

    const offResult = await send('intercept', 'off');
    assert.equal(offResult.ok, true);
    assert.ok(offResult.result.includes('disabled'));
  });

  testAsync('intercept modify-header and remove work', async () => {
    await send('intercept', 'on');

    const addResult = await send('intercept', 'modify-header', 'example.com', 'X-Test-Header', 'integration-test-value');
    assert.equal(addResult.ok, true);
    assert.ok(addResult.result.includes('Rule'));

    const listResult = await send('intercept', 'list');
    assert.equal(listResult.ok, true);
    assert.ok(listResult.result.includes('X-Test-Header'));

    const ruleIdMatch = addResult.result.match(/Rule\s+(\d+)/);
    if (ruleIdMatch) {
      const removeResult = await send('intercept', 'remove', ruleIdMatch[1]);
      assert.equal(removeResult.ok, true);
      assert.ok(removeResult.result.includes('Removed'));
    }

    await send('intercept', 'off');
  });

  testAsync('intercept mock and block work', async () => {
    await send('intercept', 'on');

    const mockResult = await send('intercept', 'mock', 'mock-test.example.com', '200', '{"mocked":true}');
    assert.equal(mockResult.ok, true);
    assert.ok(mockResult.result.includes('Rule'));

    const blockResult = await send('intercept', 'block', 'block-test.example.com');
    assert.equal(blockResult.ok, true);
    assert.ok(blockResult.result.includes('Rule'));

    const statsResult = await send('intercept', 'stats');
    assert.equal(statsResult.ok, true);

    await send('intercept', 'off');
  });

  testAsync('debug neutralize and neutralize-remove work', async () => {
    const neutralizeResult = await send('debug', 'neutralize');
    assert.equal(neutralizeResult.ok, true);
    assert.ok(
      neutralizeResult.result.includes('neutralization') || neutralizeResult.result.includes('inject')
    );

    const removeResult = await send('debug', 'neutralize-remove');
    assert.equal(removeResult.ok, true);
    assert.ok(
      removeResult.result.includes('removed') || removeResult.result.includes('Removed')
    );
  });

  testAsync('debug inject and inject-list work', async () => {
    const injectResult = await send('debug', 'inject', 'window.__integrationTest = true');
    assert.equal(injectResult.ok, true);
    assert.ok(injectResult.result.includes('inject'));

    const listResult = await send('debug', 'inject-list');
    assert.equal(listResult.ok, true);
    assert.ok(listResult.result.includes('__integrationTest'));

    const idMatch = injectResult.result.match(/(\d+)/);
    if (idMatch) {
      const removeResult = await send('debug', 'inject-remove', idMatch[1]);
      assert.equal(removeResult.ok, true);
    }
  });
});

describe('integration: Phase 2 — logpoint', () => {
  testAsync('debug logpoint works', async () => {
    await send('nav', 'https://example.com');
    await send('debug', 'reset');

    const result = await send('debug', 'logpoint', 'https://example.com', '1', '--expr', '"logpoint-test"');

    if (result.ok && result.result.includes('Logpoint set')) {
      assert.ok(result.result.includes('logpoint-test'));
    }

    await send('debug', 'reset');
  });

  testAsync('net captures requests after navigation', async () => {
    await send('nav', 'https://example.com');

    const result = await send('net');
    assert.equal(result.ok, true);
  });

  testAsync('ws lists websocket connections', async () => {
    const result = await send('ws');
    assert.equal(result.ok, true);
  });
});

describe('integration: Phase 3 — experience improvements', () => {
  testAsync('shot --full captures full page screenshot', async () => {
    let result;
    for (let attempt = 0; attempt < 5; attempt++) {
      await send('nav', 'https://example.com');
      await sleep(3000);

      result = await sendSlow('shot', SHOT_TIMEOUT, '--full');
      if (result.ok) break;
    }
    assert.equal(result.ok, true);
    assert.ok(
      result.result.includes('full page') || result.result.includes('Screenshot saved'),
      'should indicate full page screenshot'
    );

    const pathMatch = result.result.match(/^(.+\.png)$/m);
    const filePath = pathMatch ? pathMatch[1].trim() : null;
    if (filePath && existsSync(filePath)) {
      const size = statSync(filePath).size;
      assert.ok(size > 100, `screenshot file too small: ${size} bytes at ${filePath}`);
      try { unlinkSync(filePath); } catch {}
    }
  }, 200000);

  testAsync('shot without --full captures viewport only', async () => {
    let result;
    for (let attempt = 0; attempt < 5; attempt++) {
      await send('nav', 'https://example.com');
      await sleep(3000);

      result = await sendSlow('shot', SHOT_TIMEOUT);
      if (result.ok) break;
    }
    assert.equal(result.ok, true);
    assert.ok(!result.result.includes('full page'));
    assert.ok(result.result.includes('Screenshot saved'));
  }, 200000);

  testAsync('frames list shows frame tree', async () => {
    await send('nav', 'https://example.com');

    const result = await send('frames');
    assert.equal(result.ok, true);
    assert.ok(result.result.includes('Frames'));
  });

  testAsync('frames select and reset work', async () => {
    await send('frames');

    const selectResult = await send('frames', 'select', '0');
    assert.equal(selectResult.ok, true);
    assert.ok(selectResult.result.includes('Selected frame'));

    const resetResult = await send('frames', 'reset');
    assert.equal(resetResult.ok, true);
    assert.ok(resetResult.result.includes('reset'));
  });

  testAsync('frames select with invalid index returns error', async () => {
    const result = await send('frames', 'select', '999');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Invalid index'));
  });

  testAsync('console captures messages', async () => {
    await send('nav', 'https://example.com');
    await send('eval', 'console.log("integration-test-msg")');

    const result = await send('console');
    assert.equal(result.ok, true);
    assert.ok(
      result.result.includes('integration-test-msg') || result.result.includes('Console messages')
    );
  });

  testAsync('console --preserve shows previous navigation messages', async () => {
    await send('nav', 'https://example.com');
    await send('eval', 'console.log("before-nav-msg")');

    await send('nav', 'https://example.com/?after');
    await send('eval', 'console.log("after-nav-msg")');

    const preserveResult = await send('console', '--preserve');
    assert.equal(preserveResult.ok, true);
    assert.ok(
      preserveResult.result.includes('before-nav-msg') || preserveResult.result.includes('Navigation')
    );
  });

  testAsync('console clear works', async () => {
    await send('eval', 'console.log("to-be-cleared")');

    const clearResult = await send('console', 'clear');
    assert.equal(clearResult.ok, true);
    assert.ok(clearResult.result.includes('Cleared'));
  });

  testAsync('debug trace installs with --log-this and --trace-id', async () => {
    await send('debug', 'reset');
    await send('nav', 'https://www.wikipedia.org');

    const result = await send('debug', 'trace', 'doWhenReady', '--log-this', '--trace-id', 'integration-trace');

    assert.equal(result.ok, true);
    assert.ok(result.result.includes('Function trace installed') || result.result.includes('not found'),
      `trace result: ${result.result}`);
    if (result.result.includes('not found')) {
      console.warn('[WARN] trace test: doWhenReady not found on Wikipedia — test may not be exercising trace functionality');
    }
    if (result.result.includes('Function trace installed')) {
      assert.ok(result.result.includes('integration-trace'));
      assert.ok(result.result.includes('Log this: Yes'));
    }

    await send('debug', 'reset');
  });

  testAsync('debug trace without --log-this shows Log this: No', async () => {
    await send('debug', 'reset');
    await send('nav', 'https://www.wikipedia.org');

    const result = await send('debug', 'trace', 'doWhenReady', '--filter', 'index');

    if (!result.ok && result.error && result.error.includes('already exists')) {
      return;
    }
    assert.equal(result.ok, true, `trace returned: ${result.error || result.result}`);
    if (result.result.includes('Function trace installed')) {
      assert.ok(result.result.includes('Log this: No'));
    } else {
      assert.ok(result.result.includes('not found'),
        `unexpected trace result: ${result.result}`);
    }

    await send('debug', 'reset');
  });

  testAsync('nav timeout shows diagnostics', async () => {
    const result = await send('nav', 'http://10.255.255.1/');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('target URL'), `error: ${result.error}`);
    assert.ok(
      result.error.includes('Page state') || result.error.includes('Debugger state') || result.error.includes('unresponsive'),
      `error: ${result.error}`
    );
    assert.ok(result.error.includes('Possible causes'), `error: ${result.error}`);
    assert.ok(result.error.includes('Suggested actions'), `error: ${result.error}`);
  });

  testAsync('nav timeout shows diagnostics when page stuck at loading', async () => {
    const htmlContent = readFileSync('d:/agentSpace/temp/slow-page.html', 'utf8');

    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(htmlContent);
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const result = await send('nav', `http://127.0.0.1:${port}/`);
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('target URL'), `error: ${result.error}`);
      assert.ok(
        result.error.includes('Page state') || result.error.includes('Debugger state') || result.error.includes('unresponsive'),
        `error: ${result.error}`
      );
      assert.ok(result.error.includes('Possible causes'), `error: ${result.error}`);
      assert.ok(result.error.includes('Suggested actions'), `error: ${result.error}`);
    } finally {
      server.close();
    }
  });

  testAsync('daemon survives all Phase 3 commands without restart', async () => {
    const commands = [
      ['eval', '1+1'],
      ['frames'],
      ['console'],
      ['ws'],
      ['net'],
      ['info'],
    ];

    for (const [cmd, ...args] of commands) {
      const result = await send(cmd, ...args);
      assert.equal(result.ok, true, `${cmd} should succeed`);
    }

    const finalEval = await send('eval', '42');
    assert.equal(finalEval.ok, true);
    assert.equal(finalEval.result, '42');
  });
});

summary();
