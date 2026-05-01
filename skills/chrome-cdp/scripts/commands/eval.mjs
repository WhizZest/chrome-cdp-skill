import { registerCommand } from '../lib/command-registry.mjs';

export async function evalStr(cdp, sid, expression) {
  await cdp.send('Runtime.enable', {}, sid);
  const result = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  }, sid);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description);
  }
  const val = result.result.value;
  return typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val ?? '');
}

const WARN_CDP_METHODS = new Set([
  'Debugger.disable', 'Debugger.enable', 'Network.disable', 'Network.enable',
  'Page.disable', 'Page.enable',
  'Target.detachFromTarget', 'Target.closeTarget',
  'Target.disposeBrowserContext',
]);

async function evalRawStr(cdp, sid, method, paramsJson) {
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
  const result = await cdp.send(method, params, sid);
  const output = JSON.stringify(result, null, 2);
  if (!warn) return output;
  const hints = {
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
  return `⚠ Warning: ${method} may desynchronize daemon state. ${hints[method] || 'Use "debug reset" to recover if needed.'}\n\n${output}`;
}

registerCommand('eval', async ({ cdp, sessionId, args }) => {
  return evalStr(cdp, sessionId, args[0]);
});

registerCommand('evalraw', async ({ cdp, sessionId, args }) => {
  return evalRawStr(cdp, sessionId, args[0], args[1]);
});
