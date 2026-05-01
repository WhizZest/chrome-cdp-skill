const WARN_CDP_METHODS = new Set([
  'Debugger.disable', 'Debugger.enable', 'Network.disable', 'Network.enable',
  'Page.disable', 'Page.enable',
  'Target.detachFromTarget', 'Target.closeTarget',
  'Target.disposeBrowserContext',
]);

const WARN_HINTS = {
  'Debugger.disable': 'Use "debug reset" to recover debugger state.',
  'Debugger.enable': 'This may conflict with the debugger\'s internal state.',
  'Network.disable': 'Daemon network caching will stop working.',
  'Network.enable': 'This may cause duplicate network events.',
  'Page.disable': 'Navigation commands will stop working.',
  'Page.enable': 'This may cause duplicate page events.',
  'Target.detachFromTarget': 'Detaching a session may break debugging for that target.',
  'Target.closeTarget': 'Closing the current tab will kill the daemon.',
  'Target.disposeBrowserContext': 'Disposing the default context will break the session.',
};

function evalRawCheck(method, paramsJson, sid) {
  if (!method) throw new Error('CDP method required (e.g. "DOM.getDocument")');
  let params = {};
  if (paramsJson) {
    try { params = JSON.parse(paramsJson); }
    catch { throw new Error(`Invalid JSON params: ${paramsJson}`); }
  }
  if (method === 'Target.detachFromTarget' && params.sessionId === sid) {
    throw new Error('Blocked: detaching the daemon\'s own session would kill it. Use "stop" command instead.');
  }
  const warn = WARN_CDP_METHODS.has(method);
  if (!warn) return { type: 'pass' };
  return { type: 'warn', hint: WARN_HINTS[method] };
}

export { WARN_CDP_METHODS, WARN_HINTS, evalRawCheck };
