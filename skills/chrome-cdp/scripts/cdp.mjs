#!/usr/bin/env node
// cdp - lightweight Chrome DevTools Protocol CLI
// Uses raw CDP over WebSocket, no Puppeteer dependency.
// Requires Node 22+ (built-in WebSocket).
//
// Per-tab persistent daemon: page commands go through a daemon that holds
// the CDP session open. Chrome's "Allow debugging" modal fires once per
// daemon (= once per tab). Daemons auto-exit after 120min idle.

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import net from 'net';
import {
  TIMEOUT, NAVIGATION_TIMEOUT, IDLE_TIMEOUT,
  DAEMON_CONNECT_RETRIES, DAEMON_CONNECT_DELAY,
  IS_WINDOWS, RUNTIME_DIR, PAGES_CACHE,
  NEEDS_TARGET,
} from './lib/constants.mjs';
import { sleep, sockPath, resolvePrefix, redactHeaders, isTextMimeType } from './lib/utils.mjs';
import { CDP, getWsUrl, getPages, formatPageList } from './lib/cdp-client.mjs';
import { getCommandHandler } from './lib/command-registry.mjs';
import { evalStr } from './commands/eval.mjs';
import './commands/page.mjs';
import './commands/interact.mjs';

async function netStr(cdp, sid) {
  const raw = await evalStr(cdp, sid, `JSON.stringify(performance.getEntriesByType('resource').map(e => ({
    name: e.name.substring(0, 120), type: e.initiatorType,
    duration: Math.round(e.duration), size: e.transferSize
  })))`);
  return JSON.parse(raw).map(e =>
    `${String(e.duration).padStart(5)}ms  ${String(e.size || '?').padStart(8)}B  ${e.type.padEnd(8)}  ${e.name}`
  ).join('\n');
}

function netListStr(cachedRequests, args) {
  const filter = args[0];

  if (cachedRequests.length === 0) {
    return 'No cached requests. Navigate to a page first.';
  }

  let filtered = cachedRequests;

  if (filter === 'xhr') {
    filtered = cachedRequests.filter(r => r.type === 'xhr' || r.type === 'fetch');
  } else if (filter === 'img' || filter === 'image') {
    filtered = cachedRequests.filter(r => r.type === 'image');
  } else if (filter === 'css') {
    filtered = cachedRequests.filter(r => r.type === 'stylesheet');
  } else if (filter === 'js' || filter === 'script') {
    filtered = cachedRequests.filter(r => r.type === 'script');
  } else if (filter === 'error') {
    filtered = cachedRequests.filter(r => r.status >= 400 || r.status === 0 || r.errorText);
  } else if (filter && filter !== 'clear' && !filter.startsWith('--')) {
    filtered = cachedRequests.filter(r => r.url.toLowerCase().includes(filter.toLowerCase()));
  }

  if (filtered.length === 0) {
    return `No requests matching "${filter}"`;
  }

  const lines = [`Showing ${filtered.length} of ${cachedRequests.length} cached requests`];
  for (const req of filtered) {
    const method = req.method.padEnd(6);
    let statusStr;
    if (req.status === 0 || req.errorText) {
      statusStr = 'ERR';
    } else {
      statusStr = String(req.status || '?');
    }
    const status = statusStr.padStart(3);
    const type = (req.type || 'other').padEnd(6);
    const url = req.url.length > 80 ? req.url.substring(0, 77) + '...' : req.url;
    lines.push(`[${req.id}]  ${method} ${url}  ${status}  ${type}`);
  }
  return lines.join('\n');
}

async function netDetailStr(cdp, sid, cachedRequests, id, options) {
  const req = cachedRequests.find(r => r.id === id);
  if (!req) throw new Error(`Request ${id} not found`);

  const raw = options.includes('--raw');
  const showBody = options.includes('--body');
  const showRequestBody = options.includes('--request-body');
  const showHeaders = options.includes('--headers');
  const saveIdx = options.indexOf('--save');
  const saveFile = saveIdx >= 0 && options[saveIdx + 1] ? options[saveIdx + 1] : null;

  // Get response body on demand
  let responseBody = null;
  let base64Encoded = false;
  try {
    const result = await cdp.send('Network.getResponseBody', { requestId: req.requestId }, sid);
    if (result.base64Encoded) {
      base64Encoded = true;
      // Only decode if it's a known text type
      if (isTextMimeType(req.mimeType)) {
        responseBody = Buffer.from(result.body, 'base64').toString('utf-8');
      } else {
        responseBody = result.body; // Keep as base64
      }
    } else {
      responseBody = result.body;
    }
  } catch (e) {
    responseBody = `[Failed to get response body: ${e.message}]`;
  }
  
  // Handle --save option
  if (saveFile) {
    try {
      if (base64Encoded && !isTextMimeType(req.mimeType)) {
        const buf = Buffer.from(responseBody, 'base64');
        writeFileSync(saveFile, buf);
        return `Saved ${buf.length} bytes to ${saveFile}`;
      } else {
        writeFileSync(saveFile, responseBody, 'utf8');
        return `Saved ${Buffer.byteLength(responseBody, 'utf8')} bytes to ${saveFile}`;
      }
    } catch (e) {
      return `Failed to save to ${saveFile}: ${e.message}`;
    }
  }

  // Handle --body option
  if (showBody && !showHeaders && !showRequestBody) {
    if (base64Encoded && !isTextMimeType(req.mimeType)) {
      return `[Base64 encoded, use --raw to see raw base64]\n${raw ? responseBody : ''}`;
    }
    return responseBody;
  }

  // Handle --request-body option
  if (showRequestBody && !showHeaders && !showBody) {
    return req.requestBody || '[No request body]';
  }

  // Handle --headers option
  if (showHeaders && !showBody && !showRequestBody) {
    return JSON.stringify({
      request: redactHeaders(req.requestHeaders, raw),
      response: redactHeaders(req.responseHeaders, raw)
    }, null, 2);
  }

  // Default: return full JSON
  const responseObj = {
    status: req.status,
    statusText: req.statusText,
    headers: redactHeaders(req.responseHeaders, raw),
  };

  if (base64Encoded && !isTextMimeType(req.mimeType)) {
    responseObj.body = { base64Encoded: true, body: responseBody };
    if (!raw) responseObj.body.hint = 'Use --raw to see raw base64';
  } else {
    responseObj.body = responseBody;
  }

  return JSON.stringify({
    request: {
      method: req.method,
      url: req.url,
      headers: redactHeaders(req.requestHeaders, raw),
      body: req.requestBody
    },
    response: responseObj
  }, null, 2);
}

async function netHandleCommand(cdp, sid, cachedRequests, requestIdState, args) {
  const filter = args[0];

  // Clear cache
  if (filter === 'clear') {
    const count = cachedRequests.length;
    cachedRequests.length = 0;
    requestIdState.next = 1;
    return `Cleared ${count} cached requests`;
  }

  // Detail view: net <id> [--option...]
  if (filter && /^\d+$/.test(filter)) {
    const options = args.slice(1);
    return await netDetailStr(cdp, sid, cachedRequests, parseInt(filter), options);
  }

  // List view
  return netListStr(cachedRequests, args);
}

// ---------------------------------------------------------------------------
// Per-tab daemon
// ---------------------------------------------------------------------------

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

  // Enable Network domain for request monitoring
  try {
    await cdp.send('Network.enable', {}, sessionId);
  } catch (e) {
    process.stderr.write(`Daemon: Network.enable failed: ${e.message}\n`);
  }

  // Network request cache
  const MAX_CACHED_REQUESTS = 500;
  const SKIP_TYPES = new Set(['image', 'font', 'stylesheet', 'media', 'script', 'other']);
  const cachedRequests = [];
  const pendingRequests = new Map(); // requestId -> request data
  const requestIdState = { next: 1 };

  function addCachedRequest(req) {
    if (cachedRequests.length >= MAX_CACHED_REQUESTS) {
      cachedRequests.shift();
    }
    req.id = requestIdState.next++;
    cachedRequests.push(req);
    return req.id;
  }

  // Network event listeners
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

  // Shutdown helpers
  let alive = true;
  function shutdown() {
    if (!alive) return;
    alive = false;
    server.close();
    if (!IS_WINDOWS) try { unlinkSync(sp); } catch {}
    cdp.close();
    process.exit(0);
  }

  // Exit if target goes away or Chrome disconnects
  cdp.onEvent('Target.targetDestroyed', (params) => {
    if (params.targetId === targetId) shutdown();
  });
  cdp.onEvent('Target.detachedFromTarget', (params) => {
    if (params.sessionId === sessionId) shutdown();
  });
  cdp.onClose(() => shutdown());
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Idle timer
  let idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
  }

  // Handle a command
  async function handleCommand({ cmd, args }) {
    resetIdle();
    try {
      const handler = getCommandHandler(cmd);
      if (handler) {
        const result = await handler({ cdp, sessionId, cachedRequests, requestIdState, args, targetId });
        return { ok: true, result: result ?? '' };
      }
      let result;
      switch (cmd) {
        case 'list': {
          const pages = await getPages(cdp);
          result = formatPageList(pages);
          break;
        }
        case 'list_raw': {
          const pages = await getPages(cdp);
          result = JSON.stringify(pages);
          break;
        }
        case 'net': case 'network': result = await netHandleCommand(cdp, sessionId, cachedRequests, requestIdState, args); break;
        case 'stop': return { ok: true, result: '', stopAfter: true };
        default: return { ok: false, error: `Unknown command: ${cmd}` };
      }
      return { ok: true, result: result ?? '' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Unix socket server — NDJSON protocol
  // Wire format: each message is one JSON object followed by \n (newline-delimited JSON).
  // Request:  { "id": <number>, "cmd": "<command>", "args": ["arg1", "arg2", ...] }
  // Response: { "id": <number>, "ok": <boolean>, "result": "<string>" }
  //           or { "id": <number>, "ok": false, "error": "<message>" }
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop(); // keep incomplete last line
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

// ---------------------------------------------------------------------------
// CLI ↔ daemon communication
// ---------------------------------------------------------------------------

function connectToSocket(sp) {
  return new Promise((resolve, reject) => {
    const conn = net.connect(sp);
    conn.on('connect', () => resolve(conn));
    conn.on('error', reject);
  });
}

async function getOrStartTabDaemon(targetId) {
  const sp = sockPath(targetId);
  // Try existing daemon
  try { return await connectToSocket(sp); } catch {}

  // Clean stale socket
  if (!IS_WINDOWS) try { unlinkSync(sp); } catch {}

  // Spawn daemon
  const child = spawn(process.execPath, [process.argv[1], '_daemon', targetId], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Wait for socket (includes time for user to click Allow)
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

// ---------------------------------------------------------------------------
// Stop daemons
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const USAGE = `cdp - lightweight Chrome DevTools Protocol CLI (no Puppeteer)

Usage: cdp <command> [args]

  list                              List open pages (shows unique target prefixes)
  snap  <target>                    Accessibility tree snapshot
  eval  <target> <expr>             Evaluate JS expression
  shot  <target> [file]             Screenshot (default: screenshot-<target>.png in runtime dir); prints coordinate mapping
  html  <target> [selector]         Get HTML (full page or CSS selector)
  nav   <target> <url>              Navigate to URL and wait for load completion
  net   <target>                    List cached HTTP requests (captured via CDP Network domain)
  net   <target> <id>               View request details (JSON)
  net   <target> <id> --body        Response body only
  net   <target> <id> --request-body Request body only
  net   <target> <id> --headers     Request + response headers
  net   <target> <id> --raw         Show raw values (no redaction)
  net   <target> <id> --save <file> Save response body to file
  net   <target> xhr                Filter by type: XHR/Fetch
  net   <target> error              Filter: status >= 400 or failed
  net   <target> <keyword>          Filter by URL keyword
  net   <target> clear              Clear request cache
  click   <target> <selector>       Click an element by CSS selector
  clickxy <target> <x> <y>          Click at CSS pixel coordinates (see coordinate note below)
  type    <target> <text>           Type text at current focus via Input.insertText
                                    Works in cross-origin iframes unlike eval-based approaches
  keypress <target> <key>           Press a key via Input.dispatchKeyEvent
                                    Keys: ArrowUp/Down/Left/Right, Enter, Tab, Escape,
                                    Backspace, Delete, Home, End, PageUp/PageDown, Space, F1-F12
                                    Or single characters: a-z, 0-9
  loadall <target> <selector> [ms]  Repeatedly click a "load more" button until it disappears
                                    Optional interval in ms between clicks (default 1500)
  evalraw <target> <method> [json]  Send a raw CDP command; returns JSON result
                                    e.g. evalraw <t> "DOM.getDocument" '{}'
  open  [url]                       Open a new tab (default: about:blank)
                                    Note: each new tab triggers a fresh "Allow debugging?" prompt
  stop  [target]                    Stop daemon(s)

<target> is a unique targetId prefix from "cdp list". If a prefix is ambiguous,
use more characters.

COORDINATE SYSTEM
  shot captures the viewport at the device's native resolution.
  The screenshot image size = CSS pixels × DPR (device pixel ratio).
  For CDP Input events (clickxy, etc.) you need CSS pixels, not image pixels.

    CSS pixels = screenshot image pixels / DPR

  shot prints the DPR and an example conversion for the current page.
  Typical Retina (DPR=2): CSS px ≈ screenshot px × 0.5
  If your viewer rescales the image further, account for that scaling too.

EVAL SAFETY NOTE
  Avoid index-based DOM selection (querySelectorAll(...)[i]) across multiple
  eval calls when the list can change between calls (e.g. after clicking
  "Ignore" buttons on a feed — indices shift). Prefer stable selectors or
  collect all data in a single eval.

DAEMON IPC (for advanced use / scripting)
  Each tab runs a persistent daemon at Unix socket in the runtime dir (see below).
  Protocol: newline-delimited JSON (one JSON object per line, UTF-8).
    Request:  {"id":<number>, "cmd":"<command>", "args":["arg1","arg2",...]}
    Response: {"id":<number>, "ok":true,  "result":"<string>"}
           or {"id":<number>, "ok":false, "error":"<message>"}
  Commands mirror the CLI: snap, eval, shot, html, nav, net, click, clickxy,
  type, keypress, loadall, evalraw, stop. Use evalraw to send arbitrary CDP methods.
  The socket disappears after 120 min of inactivity or when the tab closes.
`;

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  // Daemon mode (internal)
  if (cmd === '_daemon') { await runDaemon(args[0]); return; }

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(USAGE); process.exit(0);
  }

  if (cmd === 'list' || cmd === 'ls') {
    const cdp = new CDP();
    await cdp.connect(getWsUrl());
    const pages = await getPages(cdp);
    cdp.close();
    writeFileSync(PAGES_CACHE, JSON.stringify(pages), { mode: 0o600 });
    console.log(formatPageList(pages));
    setTimeout(() => process.exit(0), 100);
    return;
  }

  // Open new tab
  if (cmd === 'open') {
    const url = args[0] || 'about:blank';
    const cdp = new CDP();
    await cdp.connect(getWsUrl());
    const { targetId } = await cdp.send('Target.createTarget', { url });
    // Refresh cache; new tab may not appear in getTargets immediately, so add it manually
    const pages = await getPages(cdp);
    if (!pages.some(p => p.targetId === targetId)) {
      pages.push({ targetId, title: url, url });
    }
    cdp.close();
    writeFileSync(PAGES_CACHE, JSON.stringify(pages), { mode: 0o600 });
    console.log(`Opened new tab: ${targetId.slice(0, 8)}  ${url}`);
    console.log('Note: this tab will need "Allow debugging?" approval on first access.');
    return;
  }

  // Stop
  if (cmd === 'stop') {
    await stopDaemons(args[0]);
    return;
  }

  // Page commands — need target prefix
  if (!NEEDS_TARGET.has(cmd)) {
    console.error(`Unknown command: ${cmd}\n`);
    console.log(USAGE);
    process.exit(1);
  }

  const targetPrefix = args[0];
  if (!targetPrefix) {
    console.error('Error: target ID required. Run "cdp list" first.');
    process.exit(1);
  }

  // Resolve prefix → full targetId from pages cache
  if (!existsSync(PAGES_CACHE)) {
    console.error('No page list cached. Run "cdp list" first.');
    process.exit(1);
  }
  const pages = JSON.parse(readFileSync(PAGES_CACHE, 'utf8'));
  const targetId = resolvePrefix(targetPrefix, pages.map(p => p.targetId), 'target', 'Run "cdp list".');

  const conn = await getOrStartTabDaemon(targetId);

  const cmdArgs = args.slice(1);

  if (cmd === 'eval') {
    const expr = cmdArgs.join(' ');
    if (!expr) { console.error('Error: expression required'); process.exit(1); }
    cmdArgs[0] = expr;
  } else if (cmd === 'type') {
    // Join all remaining args as text (allows spaces)
    const text = cmdArgs.join(' ');
    if (!text) { console.error('Error: text required'); process.exit(1); }
    cmdArgs[0] = text;
  } else if (cmd === 'evalraw') {
    // args: [method, ...jsonParts] — join json parts in case of spaces
    if (!cmdArgs[0]) { console.error('Error: CDP method required'); process.exit(1); }
    if (cmdArgs.length > 2) cmdArgs[1] = cmdArgs.slice(1).join(' ');
  }

  if ((cmd === 'nav' || cmd === 'navigate') && !cmdArgs[0]) {
    console.error('Error: URL required');
    process.exit(1);
  }

  const response = await sendCommand(conn, { cmd, args: cmdArgs });

  if (response.ok) {
    if (response.result) console.log(response.result);
  } else {
    // Special handling for download-triggered navigation abort
    if (response.error && response.error.includes('file download may have been triggered')) {
      console.log(response.error);
      // Exit with code 0 since the file was successfully downloaded
      process.exitCode = 0;
    } else {
      console.error('Error:', response.error);
      process.exitCode = 1;
    }
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
