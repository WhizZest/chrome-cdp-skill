import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import net from 'net';
import {
  IDLE_TIMEOUT,
  DAEMON_CONNECT_RETRIES, DAEMON_CONNECT_DELAY,
  IS_WINDOWS, PAGES_CACHE,
} from './constants.mjs';
import { sleep, sockPath, resolvePrefix } from './utils.mjs';
import { CDP, getWsUrl } from './cdp-client.mjs';
import { getCommandHandler } from './command-registry.mjs';
import * as dbg from './debugger-context.mjs';

async function runDaemon(targetId) {
  const sp = sockPath(targetId);

  const cdp = new CDP();
  try {
    await cdp.connect(getWsUrl());
  } catch (e) {
    process.stderr.write(`Daemon: cannot connect to Chrome: ${e.message}\n`);
    process.exit(1);
  }

  let sessionId;
  try {
    const res = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    sessionId = res.sessionId;
  } catch (e) {
    process.stderr.write(`Daemon: attach failed: ${e.message}\n`);
    cdp.close();
    process.exit(1);
  }

  try {
    await cdp.send('Network.enable', {}, sessionId);
  } catch (e) {
    process.stderr.write(`Daemon: Network.enable failed: ${e.message}\n`);
  }

  const MAX_CACHED_REQUESTS = 500;
  const SKIP_TYPES = new Set(['image', 'font', 'stylesheet', 'media', 'script', 'other']);
  const cachedRequests = [];
  const pendingRequests = new Map();
  const requestIdState = { next: 1 };

  function addCachedRequest(req) {
    if (cachedRequests.length >= MAX_CACHED_REQUESTS) {
      cachedRequests.shift();
    }
    req.id = requestIdState.next++;
    cachedRequests.push(req);
    return req.id;
  }

  cdp.onEvent('Network.requestWillBeSent', (params) => {
    const type = (params.type || 'other').toLowerCase();
    if (SKIP_TYPES.has(type)) return;

    pendingRequests.set(params.requestId, {
      requestId: params.requestId,
      url: params.request.url,
      method: params.request.method,
      type: type,
      requestHeaders: params.request.headers || {},
      requestBody: params.request.postData || null,
    });
  });

  cdp.onEvent('Network.responseReceived', (params) => {
    const pending = pendingRequests.get(params.requestId);
    if (!pending) return;

    pending.status = params.response.status;
    pending.statusText = params.response.statusText;
    pending.responseHeaders = params.response.headers || {};
    pending.mimeType = params.response.mimeType || '';
  });

  cdp.onEvent('Network.loadingFinished', (params) => {
    const pending = pendingRequests.get(params.requestId);
    if (!pending) return;

    pendingRequests.delete(params.requestId);
    addCachedRequest(pending);
  });

  cdp.onEvent('Network.loadingFailed', (params) => {
    const pending = pendingRequests.get(params.requestId);
    if (!pending) return;

    pendingRequests.delete(params.requestId);
    pending.status = 0;
    pending.statusText = params.errorText || 'Failed';
    pending.errorText = params.errorText;
    pending.blockedReason = params.blockedReason;
    pending.canceled = params.canceled;
    addCachedRequest(pending);
  });

  let alive = true;
  function shutdown() {
    if (!alive) return;
    alive = false;
    server.close();
    if (!IS_WINDOWS) try { unlinkSync(sp); } catch {}
    cdp.close();
    process.exit(0);
  }

  cdp.onEvent('Target.targetDestroyed', (params) => {
    if (params.targetId === targetId) shutdown();
  });
  cdp.onEvent('Target.detachedFromTarget', (params) => {
    if (params.sessionId === sessionId) shutdown();
  });
  cdp.onClose(() => shutdown());
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  let idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
  }

  async function handleCommand({ cmd, args }) {
    resetIdle();
    try {
      if (cmd === 'stop') return { ok: true, result: '', stopAfter: true };
      const handler = getCommandHandler(cmd);
      if (handler) {
        const result = await handler({ cdp, sessionId, cachedRequests, requestIdState, args, targetId, dbg });
        return { ok: true, result: result ?? '' };
      }
      return { ok: false, error: `Unknown command: ${cmd}` };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let req;
        try {
          req = JSON.parse(line);
        } catch {
          conn.write(JSON.stringify({ ok: false, error: 'Invalid JSON request', id: null }) + '\n');
          continue;
        }
        handleCommand(req).then((res) => {
          const payload = JSON.stringify({ ...res, id: req.id }) + '\n';
          if (res.stopAfter) conn.end(payload, shutdown);
          else conn.write(payload);
        });
      }
    });
  });

  server.on('error', (e) => {
    process.stderr.write(`Daemon server listen failed: ${e.message}\n`);
    process.exit(1);
  });

  if (!IS_WINDOWS) try { unlinkSync(sp); } catch {}
  server.listen(sp);
}

function connectToSocket(sp) {
  return new Promise((resolve, reject) => {
    const conn = net.connect(sp);
    conn.on('connect', () => resolve(conn));
    conn.on('error', reject);
  });
}

async function getOrStartTabDaemon(targetId) {
  const sp = sockPath(targetId);
  try { return await connectToSocket(sp); } catch {}

  if (!IS_WINDOWS) try { unlinkSync(sp); } catch {}

  const child = spawn(process.execPath, [process.argv[1], '_daemon', targetId], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  for (let i = 0; i < DAEMON_CONNECT_RETRIES; i++) {
    await sleep(DAEMON_CONNECT_DELAY);
    try { return await connectToSocket(sp); } catch {}
  }
  throw new Error('Daemon failed to start — did you click Allow in Chrome?');
}

function sendCommand(conn, req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let settled = false;

    const cleanup = () => {
      conn.off('data', onData);
      conn.off('error', onError);
      conn.off('end', onEnd);
      conn.off('close', onClose);
    };

    const onData = (chunk) => {
      buf += chunk.toString();
      const idx = buf.indexOf('\n');
      if (idx === -1) return;
      settled = true;
      cleanup();
      resolve(JSON.parse(buf.slice(0, idx)));
      conn.end();
    };

    const onError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Connection closed before response'));
    };

    const onClose = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Connection closed before response'));
    };

    conn.on('data', onData);
    conn.on('error', onError);
    conn.on('end', onEnd);
    conn.on('close', onClose);
    req.id = 1;
    conn.write(JSON.stringify(req) + '\n');
  });
}

async function stopDaemons(targetPrefix) {
  if (!existsSync(PAGES_CACHE)) return;
  const pages = JSON.parse(readFileSync(PAGES_CACHE, 'utf8'));
  const targets = targetPrefix
    ? [resolvePrefix(targetPrefix, pages.map(p => p.targetId), 'target')]
    : pages.map(p => p.targetId);

  for (const targetId of targets) {
    const sp = sockPath(targetId);
    try {
      const conn = await connectToSocket(sp);
      await sendCommand(conn, { cmd: 'stop' });
    } catch {
      if (!IS_WINDOWS) try { unlinkSync(sp); } catch {}
    }
  }
}

export { runDaemon, connectToSocket, getOrStartTabDaemon, sendCommand, stopDaemons };
