const scripts = new Map();
const urlToScripts = new Map();
const breakpoints = new Map();
const xhrBreakpoints = new Set();
let pausedState = { isPaused: false, callFrames: [], reason: null, hitBreakpoints: [] };
let enabled = false;
let cdpRef = null;
let sidRef = null;
let offScriptParsed = null;
let offPaused = null;
let offResumed = null;
let skipDebuggerStatements = true;
let offAutoResume = null;

async function enable(cdp, sessionId) {
  if (enabled && cdpRef === cdp && sidRef === sessionId) return;

  cdpRef = cdp;
  sidRef = sessionId;
  scripts.clear();
  urlToScripts.clear();

  offScriptParsed = cdp.onEvent('Debugger.scriptParsed', (params, msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;
    const info = {
      scriptId: params.scriptId,
      url: params.url || '',
      startLine: params.startLine,
      startColumn: params.startColumn,
      endLine: params.endLine,
      endColumn: params.endColumn,
      hash: params.hash,
      sourceMapURL: params.sourceMapURL,
    };
    scripts.set(params.scriptId, info);
    if (params.url) {
      const ids = urlToScripts.get(params.url) || [];
      if (!ids.includes(params.scriptId)) {
        ids.push(params.scriptId);
        urlToScripts.set(params.url, ids);
      }
    }
  });

  offPaused = cdp.onEvent('Debugger.paused', (params, msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;
    pausedState = {
      isPaused: true,
      reason: params.reason,
      callFrames: (params.callFrames || []).map(f => ({
        callFrameId: f.callFrameId,
        functionName: f.functionName || '<anonymous>',
        location: {
          scriptId: f.location.scriptId,
          lineNumber: f.location.lineNumber,
          columnNumber: f.location.columnNumber ?? 0,
        },
        url: f.url || '',
        scopeChain: (f.scopeChain || []).map(s => ({
          type: s.type,
          object: {
            type: s.object.type,
            subtype: s.object.subtype,
            className: s.object.className,
            value: s.object.value,
            description: s.object.description,
            objectId: s.object.objectId,
          },
          name: s.name,
        })),
        this: {
          type: f.this.type,
          subtype: f.this.subtype,
          className: f.this.className,
          value: f.this.value,
          description: f.this.description,
          objectId: f.this.objectId,
        },
      })),
      hitBreakpoints: params.hitBreakpoints,
      data: params.data,
    };
    if (skipDebuggerStatements && params.reason === 'other'
        && (!params.hitBreakpoints || params.hitBreakpoints.length === 0)) {
      cdpRef.send('Debugger.resume', {}, sidRef).catch(() => {});
    }
  });

  offResumed = cdp.onEvent('Debugger.resumed', (params, msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;
    pausedState = { isPaused: false, callFrames: [], reason: null, hitBreakpoints: [] };
  });

  await cdp.send('Debugger.enable', {}, sessionId);

  try {
    await cdp.send('Debugger.setAsyncCallStackDepth', { maxDepth: 32 }, sessionId);
  } catch {}

  enabled = true;
}

async function disable() {
  if (!enabled || !cdpRef) return;

  if (offScriptParsed) { offScriptParsed(); offScriptParsed = null; }
  if (offPaused) { offPaused(); offPaused = null; }
  if (offResumed) { offResumed(); offResumed = null; }

  try { await cdpRef.send('Debugger.disable', {}, sidRef); } catch {}

  scripts.clear();
  urlToScripts.clear();
  pausedState = { isPaused: false, callFrames: [], reason: null, hitBreakpoints: [] };
  enabled = false;
  cdpRef = null;
  sidRef = null;
}

function isEnabled() { return enabled; }

function getScripts() { return Array.from(scripts.values()); }

function getScriptsByUrl(url) {
  const ids = urlToScripts.get(url) || [];
  return ids.map(id => scripts.get(id)).filter(Boolean);
}

function getScriptsByUrlPattern(pattern) {
  const lower = pattern.toLowerCase();
  return Array.from(scripts.values()).filter(s => s.url.toLowerCase().includes(lower));
}

function getScriptById(scriptId) { return scripts.get(scriptId); }

async function getScriptSource(scriptId) {
  if (!cdpRef) throw new Error('Debugger not enabled');
  const result = await cdpRef.send('Debugger.getScriptSource', { scriptId }, sidRef);
  return { scriptSource: result.scriptSource || '', bytecode: result.bytecode };
}

async function getScriptSourceByUrl(url) {
  if (!cdpRef) throw new Error('Debugger not enabled');
  let matched = getScriptsByUrl(url);
  if (matched.length === 0) matched = getScriptsByUrlPattern(url);
  if (matched.length === 0) throw new Error(`No script found matching URL "${url}". Use debug scripts to see available scripts.`);
  const script = matched[matched.length - 1];
  const result = await getScriptSource(script.scriptId);
  return { source: result.scriptSource, bytecode: result.bytecode, script };
}

async function searchInScripts(query, options = {}) {
  if (!cdpRef) throw new Error('Debugger not enabled');
  const { caseSensitive = false, isRegex = false } = options;
  const matches = [];
  for (const script of scripts.values()) {
    if (!script.url && !script.hash) continue;
    try {
      const result = await cdpRef.send('Debugger.searchInContent', {
        scriptId: script.scriptId, query, caseSensitive, isRegex,
      }, sidRef);
      for (const m of result.result) {
        matches.push({
          scriptId: script.scriptId,
          url: script.url,
          lineNumber: m.lineNumber,
          lineContent: m.lineContent,
        });
      }
    } catch {}
  }
  return { query, matches };
}

function clearScripts() {
  scripts.clear();
  urlToScripts.clear();
}

async function setBreakpoint(url, lineNumber, columnNumber = 0, condition) {
  if (!cdpRef) throw new Error('Debugger not enabled');
  const params = { lineNumber, columnNumber, url };
  if (condition) params.condition = condition;
  const result = await cdpRef.send('Debugger.setBreakpointByUrl', params, sidRef);
  const info = {
    breakpointId: result.breakpointId,
    url,
    lineNumber,
    columnNumber,
    condition: condition || null,
    locations: (result.locations || []).map(loc => ({
      scriptId: loc.scriptId,
      lineNumber: loc.lineNumber,
      columnNumber: loc.columnNumber ?? 0,
    })),
  };
  breakpoints.set(result.breakpointId, info);
  return info;
}

async function setBreakpointByUrlRegex(urlRegex, lineNumber, columnNumber = 0, condition) {
  if (!cdpRef) throw new Error('Debugger not enabled');
  const params = { lineNumber, columnNumber, urlRegex };
  if (condition) params.condition = condition;
  const result = await cdpRef.send('Debugger.setBreakpointByUrl', params, sidRef);
  const info = {
    breakpointId: result.breakpointId,
    url: urlRegex,
    lineNumber,
    columnNumber,
    condition: condition || null,
    isRegex: true,
    locations: (result.locations || []).map(loc => ({
      scriptId: loc.scriptId,
      lineNumber: loc.lineNumber,
      columnNumber: loc.columnNumber ?? 0,
    })),
  };
  breakpoints.set(result.breakpointId, info);
  return info;
}

async function removeBreakpoint(breakpointId) {
  if (!cdpRef) throw new Error('Debugger not enabled');
  await cdpRef.send('Debugger.removeBreakpoint', { breakpointId }, sidRef);
  breakpoints.delete(breakpointId);
}

async function removeAllBreakpoints() {
  if (!cdpRef) throw new Error('Debugger not enabled');
  for (const id of Array.from(breakpoints.keys())) {
    try { await removeBreakpoint(id); } catch {}
  }
  for (const url of Array.from(xhrBreakpoints)) {
    try { await removeXHRBreakpoint(url); } catch {}
  }
}

function getBreakpoints() { return Array.from(breakpoints.values()); }

function getBreakpointById(id) { return breakpoints.get(id); }

async function restoreBreakpoints(saved) {
  if (!cdpRef) return;
  breakpoints.clear();
  for (const bp of saved) {
    try {
      const params = { lineNumber: bp.lineNumber, columnNumber: bp.columnNumber };
      if (bp.isRegex) params.urlRegex = bp.url;
      else params.url = bp.url;
      if (bp.condition) params.condition = bp.condition;
      const result = await cdpRef.send('Debugger.setBreakpointByUrl', params, sidRef);
      breakpoints.set(result.breakpointId, {
        breakpointId: result.breakpointId,
        url: bp.url,
        lineNumber: bp.lineNumber,
        columnNumber: bp.columnNumber,
        condition: bp.condition,
        isRegex: bp.isRegex,
        locations: (result.locations || []).map(loc => ({
          scriptId: loc.scriptId,
          lineNumber: loc.lineNumber,
          columnNumber: loc.columnNumber ?? 0,
        })),
      });
    } catch {}
  }
}

async function setXHRBreakpoint(url) {
  if (!cdpRef) throw new Error('Debugger not enabled');
  await cdpRef.send('DOMDebugger.setXHRBreakpoint', { url }, sidRef);
  xhrBreakpoints.add(url);
}

async function removeXHRBreakpoint(url) {
  if (!cdpRef) throw new Error('Debugger not enabled');
  await cdpRef.send('DOMDebugger.removeXHRBreakpoint', { url }, sidRef);
  xhrBreakpoints.delete(url);
}

function getXHRBreakpoints() { return Array.from(xhrBreakpoints); }

async function restoreXHRBreakpoints() {
  if (!cdpRef) return;
  for (const url of xhrBreakpoints) {
    try { await cdpRef.send('DOMDebugger.setXHRBreakpoint', { url }, sidRef); } catch {}
  }
}

function isPaused() { return pausedState.isPaused; }
function getPausedState() { return pausedState; }

async function resume() {
  if (!cdpRef) throw new Error('Debugger not enabled');
  if (!pausedState.isPaused) throw new Error('Execution is not paused');
  await cdpRef.send('Debugger.resume', {}, sidRef);
}

async function pause() {
  if (!cdpRef) throw new Error('Debugger not enabled');
  await cdpRef.send('Debugger.pause', {}, sidRef);
}

function waitForPaused(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error('Timed out waiting for debugger to pause after step'));
    }, timeoutMs);

    const off = cdpRef.onEvent('Debugger.paused', (params, msg) => {
      if (msg.sessionId && msg.sessionId !== sidRef) return;
      clearTimeout(timer);
      off();
      const topFrame = params.callFrames?.[0];
      if (topFrame) {
        resolve({
          callFrameId: topFrame.callFrameId,
          functionName: topFrame.functionName || '<anonymous>',
          location: {
            scriptId: topFrame.location.scriptId,
            lineNumber: topFrame.location.lineNumber,
            columnNumber: topFrame.location.columnNumber ?? 0,
          },
          url: topFrame.url || '',
        });
      } else {
        reject(new Error('Paused with no call frames'));
      }
    });
  });
}

async function stepOver() {
  if (!cdpRef) throw new Error('Debugger not enabled');
  if (!pausedState.isPaused) throw new Error('Execution is not paused');
  const p = waitForPaused();
  await cdpRef.send('Debugger.stepOver', {}, sidRef);
  return p;
}

async function stepInto() {
  if (!cdpRef) throw new Error('Debugger not enabled');
  if (!pausedState.isPaused) throw new Error('Execution is not paused');
  const p = waitForPaused();
  await cdpRef.send('Debugger.stepInto', {}, sidRef);
  return p;
}

async function stepOut() {
  if (!cdpRef) throw new Error('Debugger not enabled');
  if (!pausedState.isPaused) throw new Error('Execution is not paused');
  const p = waitForPaused();
  await cdpRef.send('Debugger.stepOut', {}, sidRef);
  return p;
}

async function getScopeVariables(objectId) {
  if (!cdpRef) throw new Error('Debugger not enabled');
  const result = await cdpRef.send('Runtime.getProperties', {
    objectId, ownProperties: true, accessorPropertiesOnly: false, generatePreview: true,
  }, sidRef);
  const variables = [];
  for (const prop of result.result) {
    if (prop.name.startsWith('__') || prop.name === 'this') continue;
    const value = prop.value;
    if (!value) continue;
    variables.push({
      name: prop.name,
      type: value.type,
      value: value.value ?? value.description ?? `[${value.type}]`,
      description: value.description,
    });
  }
  return variables;
}

async function evaluateOnCallFrame(callFrameId, expression, options = {}) {
  if (!cdpRef) throw new Error('Debugger not enabled');
  if (!pausedState.isPaused) throw new Error('Execution is not paused');
  const result = await cdpRef.send('Debugger.evaluateOnCallFrame', {
    callFrameId,
    expression,
    returnByValue: options.returnByValue ?? true,
    generatePreview: options.generatePreview ?? true,
  }, sidRef);
  return {
    result: {
      type: result.result.type,
      subtype: result.result.subtype,
      className: result.result.className,
      value: result.result.value,
      description: result.result.description,
      objectId: result.result.objectId,
    },
    exceptionDetails: result.exceptionDetails
      ? { text: result.exceptionDetails.text, exception: result.exceptionDetails.exception }
      : null,
  };
}

function setSkipDebuggerStatements(skip) {
  skipDebuggerStatements = skip;
}

let antiDebugScriptId = null;

async function neutralizeDebuggerStatements(cdp, sessionId) {
  if (antiDebugScriptId) return antiDebugScriptId;
  const code = `
(function() {
  var _constructor = Function.prototype.constructor;
  Function.prototype.constructor = function() {
    if (arguments && arguments.length > 0 && typeof arguments[0] === 'string') {
      if (arguments[0].indexOf('debugger') !== -1) {
        arguments[0] = arguments[0].replace(/debugger/g, '');
      }
    }
    return _constructor.apply(this, arguments);
  };
  Function.prototype.constructor.toString = function() { return 'function Function() { [native code] }'; };
})();
`;
  const result = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: code }, sessionId);
  antiDebugScriptId = result.identifier;
  return antiDebugScriptId;
}

async function removeNeutralizeDebuggerStatements(cdp, sessionId) {
  if (!antiDebugScriptId) return;
  try {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: antiDebugScriptId }, sessionId);
  } catch {}
  antiDebugScriptId = null;
}

export {
  enable, disable, isEnabled,
  getScripts, getScriptsByUrl, getScriptsByUrlPattern, getScriptById,
  getScriptSource, getScriptSourceByUrl, searchInScripts, clearScripts,
  setBreakpoint, setBreakpointByUrlRegex, removeBreakpoint, removeAllBreakpoints,
  getBreakpoints, getBreakpointById, restoreBreakpoints,
  setXHRBreakpoint, removeXHRBreakpoint, getXHRBreakpoints, restoreXHRBreakpoints,
  isPaused, getPausedState, resume, pause,
  stepOver, stepInto, stepOut,
  getScopeVariables, evaluateOnCallFrame,
  setSkipDebuggerStatements,
  neutralizeDebuggerStatements, removeNeutralizeDebuggerStatements,
};
