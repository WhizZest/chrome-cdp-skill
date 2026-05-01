import assert from 'assert/strict';
import { describe, test, testAsync, summary } from '../lib/test-runner.mjs';
import net from 'net';
import { sendCommand, connectToSocket } from '../../skills/chrome-cdp/scripts/lib/daemon.mjs';

describe('daemon IPC: sendCommand protocol', () => {
  testAsync('sendCommand receives response', async () => {
    const server = net.createServer((conn) => {
      let buf = '';
      conn.on('data', (chunk) => {
        buf += chunk.toString();
        const idx = buf.indexOf('\n');
        if (idx === -1) return;
        const req = JSON.parse(buf.slice(0, idx));
        conn.write(JSON.stringify({ ok: true, result: 'hello', id: req.id }) + '\n');
        conn.end();
        server.close();
      });
    });

    await new Promise(r => server.listen(0, r));
    const addr = server.address();

    const conn = net.connect(addr.port, '127.0.0.1');
    await new Promise(r => conn.on('connect', r));

    const result = await sendCommand(conn, { cmd: 'test' });
    assert.equal(result.ok, true);
    assert.equal(result.result, 'hello');
    assert.equal(result.id, 1);
  });

  testAsync('sendCommand handles error response', async () => {
    const server = net.createServer((conn) => {
      let buf = '';
      conn.on('data', (chunk) => {
        buf += chunk.toString();
        const idx = buf.indexOf('\n');
        if (idx === -1) return;
        const req = JSON.parse(buf.slice(0, idx));
        conn.write(JSON.stringify({ ok: false, error: 'something failed', id: req.id }) + '\n');
        conn.end();
        server.close();
      });
    });

    await new Promise(r => server.listen(0, r));
    const addr = server.address();

    const conn = net.connect(addr.port, '127.0.0.1');
    await new Promise(r => conn.on('connect', r));

    const result = await sendCommand(conn, { cmd: 'bad' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'something failed');
  });

  testAsync('sendCommand handles connection close', async () => {
    const server = net.createServer((conn) => {
      conn.end();
      server.close();
    });

    await new Promise(r => server.listen(0, r));
    const addr = server.address();

    const conn = net.connect(addr.port, '127.0.0.1');
    await new Promise(r => conn.on('connect', r));

    await assert.rejects(
      () => sendCommand(conn, { cmd: 'test' }),
      /Connection closed before response/
    );
  });

  testAsync('sendCommand handles timeout', async () => {
    const TEST_TIMEOUT = 500;
    const server = net.createServer((conn) => {
    });

    await new Promise(r => server.listen(0, r));
    const addr = server.address();

    const conn = net.connect(addr.port, '127.0.0.1');
    await new Promise(r => conn.on('connect', r));

    const start = Date.now();
    await assert.rejects(
      () => sendCommand(conn, { cmd: 'slow' }, TEST_TIMEOUT),
      /Timeout/
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= TEST_TIMEOUT - 100, `Timeout too early: ${elapsed}ms < ${TEST_TIMEOUT - 100}ms`);
    assert.ok(elapsed < TEST_TIMEOUT + 1000, `Timeout too late: ${elapsed}ms`);
    server.close();
  });
});

summary();
