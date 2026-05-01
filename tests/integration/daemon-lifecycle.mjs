import assert from 'assert/strict';
import { describe, testAsync, summary } from '../lib/test-runner.mjs';
import { getOrStartTabDaemon, sendCommand, stopDaemons } from '../../skills/chrome-cdp/scripts/lib/daemon.mjs';
import { readFileSync, existsSync } from 'fs';
import { PAGES_CACHE } from '../../skills/chrome-cdp/scripts/lib/constants.mjs';

const TARGET_PREFIX = process.env.CDP_TEST_TARGET;
if (!TARGET_PREFIX) {
  console.error('Set CDP_TEST_TARGET=<targetId prefix> to run integration tests');
  console.error('Example: CDP_TEST_TARGET=C1CE430E node tests/integration/daemon-lifecycle.mjs');
  process.exit(1);
}

describe('integration: daemon lifecycle', () => {
  testAsync('daemon starts and responds to eval', async () => {
    const conn = await getOrStartTabDaemon(TARGET_PREFIX);
    const result = await sendCommand(conn, { cmd: 'eval', args: ['1+1'] });
    assert.equal(result.ok, true);
    assert.equal(result.result, '2');
  });

  testAsync('info command returns daemon metadata', async () => {
    const conn = await getOrStartTabDaemon(TARGET_PREFIX);
    const result = await sendCommand(conn, { cmd: 'info', args: [] });
    assert.equal(result.ok, true);
    const info = JSON.parse(result.result);
    assert.ok(info.targetId);
    assert.ok(info.sessionId);
    assert.ok(info.pid);
    assert.ok(typeof info.uptime === 'number');
  });

  testAsync('debug reset works without daemon restart', async () => {
    const conn = await getOrStartTabDaemon(TARGET_PREFIX);
    const result = await sendCommand(conn, { cmd: 'debug', args: ['reset'] });
    assert.equal(result.ok, true);
    assert.ok(result.result.includes('Restored'));

    const infoResult = await sendCommand(conn, { cmd: 'info', args: [] });
    assert.equal(infoResult.ok, true);
  });

  testAsync('evalraw blocks dangerous commands', async () => {
    const conn = await getOrStartTabDaemon(TARGET_PREFIX);
    const infoResult = await sendCommand(conn, { cmd: 'info', args: [] });
    const info = JSON.parse(infoResult.result);

    const result = await sendCommand(conn, {
      cmd: 'evalraw',
      args: ['Target.detachFromTarget', JSON.stringify({ sessionId: info.sessionId })],
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Blocked'));
  });

  testAsync('evalraw warns on Debugger.disable', async () => {
    const conn = await getOrStartTabDaemon(TARGET_PREFIX);
    const result = await sendCommand(conn, {
      cmd: 'evalraw',
      args: ['Debugger.disable'],
    });
    assert.equal(result.ok, true);
    assert.ok(result.result.includes('Warning'));
    assert.ok(result.result.includes('debug reset'));

    await sendCommand(conn, { cmd: 'debug', args: ['reset'] });
  });

  testAsync('daemon survives multiple commands', async () => {
    const conn = await getOrStartTabDaemon(TARGET_PREFIX);
    for (let i = 0; i < 5; i++) {
      const result = await sendCommand(conn, { cmd: 'eval', args: [`${i}+1`] });
      assert.equal(result.ok, true);
      assert.equal(result.result, String(i + 1));
    }
  });

  testAsync('unknown command returns error', async () => {
    const conn = await getOrStartTabDaemon(TARGET_PREFIX);
    const result = await sendCommand(conn, { cmd: 'nonexistent', args: [] });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Unknown command'));
  });
});

summary();
