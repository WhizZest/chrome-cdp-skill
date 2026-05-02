import { writeFileSync } from 'fs';
import { registerCommand } from '../lib/command-registry.mjs';
import { isTextMimeType, redactHeaders } from '../lib/utils.mjs';
import { evalStr } from './eval.mjs';

function formatInitiator(initiator) {
  if (!initiator) return 'No initiator info available.';

  const lines = [`Initiator (type: ${initiator.type})`];

  if (initiator.type === 'parser') {
    if (initiator.url) {
      lines.push(`  URL: ${initiator.url}${initiator.lineNumber >= 0 ? `:${initiator.lineNumber + 1}` : ''}`);
    }
    return lines.join('\n');
  }

  if (initiator.stack) {
    const frames = initiator.stack.callFrames || [];
    if (frames.length > 0) {
      lines.push('  Call Stack:');
      for (const f of frames.slice(0, 10)) {
        const name = f.functionName || '<anonymous>';
        const url = f.url ? f.url.split('/').pop() : `script:${f.scriptId}`;
        lines.push(`    ${name} @ ${url}:${f.lineNumber + 1}:${f.columnNumber + 1}`);
      }
      if (frames.length > 10) lines.push(`    ... and ${frames.length - 10} more`);
    }

    let parent = initiator.stack.parent;
    let depth = 1;
    while (parent) {
      const parentFrames = parent.callFrames || [];
      if (parentFrames.length > 0) {
        lines.push(`  Async Parent Stack (depth ${depth}):`);
        for (const f of parentFrames.slice(0, 5)) {
          const name = f.functionName || '<anonymous>';
          const url = f.url ? f.url.split('/').pop() : `script:${f.scriptId}`;
          lines.push(`    ${name} @ ${url}:${f.lineNumber + 1}:${f.columnNumber + 1}`);
        }
        if (parentFrames.length > 5) lines.push(`    ... and ${parentFrames.length - 5} more`);
      }
      parent = parent.parent;
      depth++;
    }
  } else if (initiator.url) {
    lines.push(`  URL: ${initiator.url}${initiator.lineNumber >= 0 ? `:${initiator.lineNumber + 1}` : ''}`);
  }

  return lines.join('\n');
}

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
    let initiatorHint = '';
    if (req.initiator) {
      if (req.initiator.type === 'script' && req.initiator.stack) {
        const topFrame = req.initiator.stack.callFrames?.[0];
        if (topFrame) {
          const name = topFrame.functionName || '<anon>';
          const src = topFrame.url ? topFrame.url.split('/').pop() : '';
          const loc = src ? `:${topFrame.lineNumber + 1}` : '';
          initiatorHint = `  ← ${name} @ ${src}${loc}`;
        } else {
          initiatorHint = '  ← script';
        }
      } else if (req.initiator.type === 'parser') {
        initiatorHint = '  ← parser';
      } else {
        initiatorHint = `  ← ${req.initiator.type}`;
      }
    }
    lines.push(`[${req.id}]  ${method} ${url}  ${status}  ${type}${initiatorHint}`);
  }
  return lines.join('\n');
}

async function netDetailStr(cdp, sid, cachedRequests, id, options) {
  const req = cachedRequests.find(r => r.id === id);
  if (!req) throw new Error(`Request ${id} not found`);

  const raw = options.includes('--raw');
  const verbose = options.includes('--verbose') || options.includes('-v');
  const showBody = options.includes('--body');
  const showRequestBody = options.includes('--request-body');
  const showHeaders = options.includes('--headers');
  const saveIdx = options.indexOf('--save');
  const saveFile = saveIdx >= 0 && options[saveIdx + 1] ? options[saveIdx + 1] : null;

  let responseBody = null;
  let base64Encoded = false;
  try {
    const result = await cdp.send('Network.getResponseBody', { requestId: req.requestId }, sid);
    if (result.base64Encoded) {
      base64Encoded = true;
      if (isTextMimeType(req.mimeType)) {
        responseBody = Buffer.from(result.body, 'base64').toString('utf-8');
      } else {
        responseBody = result.body;
      }
    } else {
      responseBody = result.body;
    }
  } catch (e) {
    responseBody = `[Failed to get response body: ${e.message}]`;
  }

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

  if (showBody && !showHeaders && !showRequestBody) {
    if (base64Encoded && !isTextMimeType(req.mimeType)) {
      return `[Base64 encoded, use --raw to see raw base64]\n${raw ? responseBody : ''}`;
    }
    return responseBody;
  }

  if (showRequestBody && !showHeaders && !showBody) {
    return req.requestBody || '[No request body]';
  }

  if (showHeaders && !showBody && !showRequestBody) {
    return JSON.stringify({
      request: redactHeaders(req.requestHeaders, raw),
      response: redactHeaders(req.responseHeaders, raw)
    }, null, 2);
  }

  if (!verbose) {
    const lines = [`${req.method} ${req.url} → ${req.status} ${req.statusText || ''}`];
    if (req.mimeType) lines.push(`Content-Type: ${req.mimeType}`);
    if (base64Encoded && !isTextMimeType(req.mimeType)) {
      lines.push(`Body: [Base64 encoded, ${responseBody.length} chars]`);
      lines.push('Use --raw to see raw base64, --verbose for full details.');
    } else {
      lines.push(`Body:`);
      lines.push(responseBody);
    }
    lines.push('Use --verbose for headers, request body, and initiator info.');
    return lines.join('\n');
  }

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
    response: responseObj,
    initiator: req.initiator || null,
  }, null, 2);
}

async function netHandleCommand(cdp, sid, cachedRequests, requestIdState, args) {
  const filter = args[0];

  if (filter === 'clear') {
    const count = cachedRequests.length;
    cachedRequests.length = 0;
    requestIdState.next = 1;
    return `Cleared ${count} cached requests`;
  }

  if (filter === 'initiator' && args[1] && /^\d+$/.test(args[1])) {
    const req = cachedRequests.find(r => r.id === parseInt(args[1]));
    if (!req) throw new Error(`Request ${args[1]} not found`);
    return formatInitiator(req.initiator);
  }

  if (filter && /^\d+$/.test(filter)) {
    const options = args.slice(1);
    return await netDetailStr(cdp, sid, cachedRequests, parseInt(filter), options);
  }

  return netListStr(cachedRequests, args);
}

registerCommand('net', async ({ cdp, sessionId, cachedRequests, requestIdState, args }) =>
  netHandleCommand(cdp, sessionId, cachedRequests, requestIdState, args));
registerCommand('network', async ({ cdp, sessionId, cachedRequests, requestIdState, args }) =>
  netHandleCommand(cdp, sessionId, cachedRequests, requestIdState, args));

export { netHandleCommand, formatInitiator };
