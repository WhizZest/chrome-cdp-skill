const MAX_CONSOLE_MESSAGES = 1000;
const MAX_NAVIGATION_HISTORY = 3;
const CONSOLE_TYPES = new Set(['log', 'warning', 'error', 'info', 'debug', 'table', 'dir', 'trace', 'startGroup', 'endGroup', 'clear', 'assert', 'profile', 'profileEnd', 'count', 'timeEnd']);

let messages = [];
let msgIdCounter = 1;
let cdpRef = null;
let sidRef = null;
let offConsoleAPICalled = null;
let offExceptionThrown = null;
let enabled = false;
let navigationHistory = [];
let currentNavUrl = '';

function formatArgValue(arg) {
  if (arg.value !== undefined) return String(arg.value);
  if (arg.description) {
    if (arg.type === 'object' && arg.subtype === 'error') return arg.description;
    if (arg.description.length > 200) return arg.description.substring(0, 200) + '...';
    return arg.description;
  }
  if (arg.type === 'undefined') return 'undefined';
  if (arg.type === 'function') return 'function';
  if (arg.subtype === 'null') return 'null';
  return `[${arg.type}${arg.subtype ? ':' + arg.subtype : ''}]`;
}

async function enable(cdp, sessionId) {
  if (enabled && cdpRef === cdp && sidRef === sessionId) return;

  if (offConsoleAPICalled) { offConsoleAPICalled(); offConsoleAPICalled = null; }
  if (offExceptionThrown) { offExceptionThrown(); offExceptionThrown = null; }

  cdpRef = cdp;
  sidRef = sessionId;

  offConsoleAPICalled = cdp.onEvent('Runtime.consoleAPICalled', (params, msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;
    const text = (params.args || []).map(formatArgValue).join(' ');
    const frame = params.stackTrace?.callFrames?.[0];
    messages.push({
      id: msgIdCounter++,
      type: params.type || 'log',
      text,
      args: params.args || [],
      timestamp: params.timestamp || Date.now(),
      url: frame?.url || '',
      lineNumber: frame?.lineNumber ?? -1,
    });
    if (messages.length > MAX_CONSOLE_MESSAGES) messages.shift();
  });

  offExceptionThrown = cdp.onEvent('Runtime.exceptionThrown', (params, msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;
    const detail = params.exceptionDetails || {};
    const text = detail.text || detail.exception?.description || 'Uncaught exception';
    const frame = detail.stackTrace?.callFrames?.[0];
    messages.push({
      id: msgIdCounter++,
      type: 'error',
      text,
      args: [],
      timestamp: params.timestamp || Date.now(),
      url: frame?.url || '',
      lineNumber: frame?.lineNumber ?? -1,
    });
    if (messages.length > MAX_CONSOLE_MESSAGES) messages.shift();
  });

  await cdp.send('Runtime.enable', {}, sessionId);

  enabled = true;
}

function disable() {
  if (offConsoleAPICalled) { offConsoleAPICalled(); offConsoleAPICalled = null; }
  if (offExceptionThrown) { offExceptionThrown(); offExceptionThrown = null; }
  messages = [];
  msgIdCounter = 1;
  enabled = false;
  cdpRef = null;
  sidRef = null;
}

function isEnabled() { return enabled; }

function onNavigated(url) {
  if (messages.length > 0) {
    navigationHistory.push({
      timestamp: Date.now(),
      url: currentNavUrl,
      messages: [...messages],
    });
    if (navigationHistory.length > MAX_NAVIGATION_HISTORY) {
      navigationHistory.shift();
    }
  }
  messages = [];
  currentNavUrl = url || '';
}

function getMessages(filter, page = 1, size = 20, preserve = false) {
  let source = messages;
  if (preserve) {
    source = [];
    for (const nav of navigationHistory) {
      source.push({ separator: true, url: nav.url, timestamp: nav.timestamp });
      source.push(...nav.messages);
    }
    source.push({ separator: true, url: currentNavUrl, timestamp: null });
    source.push(...messages);
  }

  if (filter && filter !== 'clear' && !filter.startsWith('--') && !/^\d+$/.test(filter)) {
    const typeMap = { warn: 'warning' };
    const targetType = typeMap[filter] || filter;
    source = source.filter(m => m.separator || m.type === targetType);
  }

  const totalMessages = source.filter(m => !m.separator).length;
  const total = totalMessages;
  const totalPages = Math.ceil(total / size);
  const currentPage = Math.min(page, totalPages) || 1;

  if (preserve) {
    let msgCount = 0;
    const pageStart = (currentPage - 1) * size;
    const pageEnd = pageStart + size;
    const pageItems = [];
    let started = false;

    for (const item of source) {
      if (item.separator) {
        if (started) pageItems.push(item);
        continue;
      }
      msgCount++;
      if (msgCount > pageEnd) break;
      if (msgCount > pageStart) {
        if (!started) {
          for (const s of source) {
            if (s === item) break;
            if (s.separator) pageItems.push(s);
          }
          started = true;
        }
        pageItems.push(item);
      }
    }

    return {
      messages: pageItems,
      total,
      page: currentPage,
      size,
      totalPages,
      preserve: true,
    };
  }

  const start = (currentPage - 1) * size;
  const end = Math.min(start + size, total);
  const pageItems = source.slice(start, end);

  return {
    messages: pageItems,
    total,
    page: currentPage,
    size,
    totalPages,
    preserve: false,
  };
}

function getMessageById(id) {
  return messages.find(m => m.id === id) || null;
}

function clear() {
  const count = messages.length;
  messages = [];
  navigationHistory = [];
  currentNavUrl = '';
  msgIdCounter = 1;
  return count;
}

function reset() {
  messages = [];
  navigationHistory = [];
  currentNavUrl = '';
  msgIdCounter = 1;
}

export { enable, disable, isEnabled, getMessages, getMessageById, clear, reset, onNavigated };
