import { writeFileSync } from 'fs';
import { registerCommand } from '../lib/command-registry.mjs';
import { isTextMimeType, redactHeaders } from '../lib/utils.mjs';
import { evalStr } from './eval.mjs';

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

  if (filter === 'clear') {
    const count = cachedRequests.length;
    cachedRequests.length = 0;
    requestIdState.next = 1;
    return `Cleared ${count} cached requests`;
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
