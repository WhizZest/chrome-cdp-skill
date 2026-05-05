const DIAG_TIMEOUT = 2000;

async function quickEval(cdp, sid, expression) {
  try {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: false,
    }, sid, DIAG_TIMEOUT);
    if (result.exceptionDetails) return null;
    const val = result.result.value;
    return typeof val === 'object' ? JSON.stringify(val) : String(val ?? 'undefined');
  } catch {
    return null;
  }
}

export async function collectNavDiagnostics(cdp, sessionId, dbg, targetUrl) {
  const [readyState, url] = await Promise.allSettled([
    quickEval(cdp, sessionId, 'document.readyState'),
    quickEval(cdp, sessionId, 'location.href'),
  ]);

  return {
    targetUrl,
    page: {
      readyState: readyState.status === 'fulfilled' ? readyState.value : null,
      url: url.status === 'fulfilled' ? url.value : null,
    },
    debugger: {
      enabled: dbg.isEnabled(),
      paused: dbg.isPaused(),
      neutralizeDeployed: dbg.isNeutralizeDeployed(),
    },
  };
}

export function formatNavError(originalError, diag) {
  const lines = [originalError];

  if (diag.targetUrl) {
    lines.push(`  target URL: ${diag.targetUrl}`);
  }

  const hasPageInfo = diag.page.url !== null || diag.page.readyState !== null;
  const hasDebuggerInfo = diag.debugger.enabled || diag.debugger.paused || diag.debugger.neutralizeDeployed;

  if (hasPageInfo || hasDebuggerInfo) {
    if (hasPageInfo) {
      lines.push('');
      lines.push('Page state:');
      if (diag.page.url !== null) lines.push(`  URL: ${diag.page.url}`);
      if (diag.page.readyState !== null) lines.push(`  readyState: ${diag.page.readyState}`);
    }

    if (hasDebuggerInfo) {
      lines.push('');
      lines.push('Debugger state:');
      lines.push(`  enabled: ${diag.debugger.enabled ? 'yes' : 'no'}`);
      if (diag.debugger.paused) lines.push('  paused: yes');
      lines.push(`  neutralize hook: ${diag.debugger.neutralizeDeployed ? 'deployed' : 'not deployed'}`);
    }

    lines.push('');
    lines.push('Possible causes:');
    const causes = buildNavCauses(diag);
    causes.forEach((c, i) => lines.push(`  ${i + 1}. ${c}`));

    lines.push('');
    lines.push('Suggested actions:');
    const actions = buildNavActions(diag);
    actions.forEach(a => lines.push(`  - ${a}`));
  } else {
    lines.push('');
    lines.push('Page appears unresponsive — all diagnostic queries failed.');
    lines.push('Possible causes:');
    lines.push('  1. Page may have crashed');
    lines.push('  2. CDP connection may be broken');
    lines.push('  3. Network is unreachable');
    lines.push('');
    lines.push('Suggested actions:');
    lines.push('  - Try \'info <target>\' to check if page is still reachable');
    lines.push('  - If page crashed: navigate to a different URL or restart the tab');
    lines.push('  - Check network connectivity');
  }

  return lines.join('\n');
}

function buildNavCauses(diag) {
  const causes = [];
  const d = diag.debugger;
  const p = diag.page;

  if (d.enabled && !d.neutralizeDeployed && p.readyState === 'loading') {
    causes.push('Page has anti-debugging measures (Debugger enabled, neutralize not deployed, page stuck at loading)');
  }
  if (d.enabled && d.paused) {
    causes.push('Debugger is paused at a breakpoint during navigation');
  }
  if (d.enabled && d.neutralizeDeployed && p.readyState === 'loading') {
    causes.push('Neutralize is deployed but page still stuck at loading (may have uncovered anti-debugging techniques)');
  }
  if (p.readyState === 'loading') {
    if (!d.enabled) {
      causes.push('Page resources loading slowly or network issue');
    } else {
      causes.push('Navigation still in progress (readyState=loading, page resources may be slow)');
    }
  }
  if (causes.length === 0) {
    causes.push('Unknown cause — check page state and network');
  }
  return causes;
}

function buildNavActions(diag) {
  const actions = [];
  const d = diag.debugger;
  const p = diag.page;

  if (d.enabled && !d.neutralizeDeployed) {
    actions.push('If page has anti-debugging: debug <target> neutralize (strips debugger; from 4 code paths: Function, eval, setTimeout, setInterval), then retry nav');
  }
  if (d.enabled && d.paused) {
    actions.push('If paused at breakpoint: debug <target> status (inspect pause location), then debug <target> resume');
  }
  if (d.enabled && d.neutralizeDeployed) {
    actions.push('If neutralize is insufficient: debug <target> reset (re-enable + restore breakpoints), then retry');
  }
  if (p.readyState === 'loading' && !(d.enabled && !d.neutralizeDeployed)) {
    actions.push('If page is still loading: wait for navigation to complete, then retry');
  }
  actions.push('General: check \'info <target>\' for page status overview');
  return actions;
}

export async function collectClickDiagnostics(cdp, sessionId, dbg, selector) {
  const [readyState, url] = await Promise.allSettled([
    quickEval(cdp, sessionId, 'document.readyState'),
    quickEval(cdp, sessionId, 'location.href'),
  ]);

  return {
    selector,
    page: {
      readyState: readyState.status === 'fulfilled' ? readyState.value : null,
      url: url.status === 'fulfilled' ? url.value : null,
    },
    debugger: {
      enabled: dbg.isEnabled(),
      paused: dbg.isPaused(),
      neutralizeDeployed: dbg.isNeutralizeDeployed(),
    },
  };
}

export function formatClickError(originalError, diag) {
  const lines = [originalError];

  if (diag.selector) {
    lines.push(`  selector: ${diag.selector}`);
  }

  const hasPageInfo = diag.page.url !== null || diag.page.readyState !== null;
  const hasDebuggerInfo = diag.debugger.enabled || diag.debugger.paused || diag.debugger.neutralizeDeployed;

  if (hasPageInfo || hasDebuggerInfo) {
    if (hasPageInfo) {
      lines.push('');
      lines.push('Page state:');
      if (diag.page.url !== null) lines.push(`  URL: ${diag.page.url}`);
      if (diag.page.readyState !== null) lines.push(`  readyState: ${diag.page.readyState}`);
    }

    if (hasDebuggerInfo) {
      lines.push('');
      lines.push('Debugger state:');
      lines.push(`  enabled: ${diag.debugger.enabled ? 'yes' : 'no'}`);
      if (diag.debugger.paused) lines.push('  paused: yes');
      lines.push(`  neutralize hook: ${diag.debugger.neutralizeDeployed ? 'deployed' : 'not deployed'}`);
    }

    lines.push('');
    lines.push('Possible causes:');
    const causes = buildClickCauses(diag);
    causes.forEach((c, i) => lines.push(`  ${i + 1}. ${c}`));

    lines.push('');
    lines.push('Suggested actions:');
    const actions = buildClickActions(diag);
    actions.forEach(a => lines.push(`  - ${a}`));
  } else {
    lines.push('');
    lines.push('Page appears unresponsive — all diagnostic queries failed.');
    lines.push('Possible causes:');
    lines.push('  1. Page may have crashed');
    lines.push('  2. CDP connection may be broken');
    lines.push('');
    lines.push('Suggested actions:');
    lines.push('  - Try \'info <target>\' to check if page is still reachable');
    lines.push('  - If page crashed: navigate to a different URL or restart the tab');
  }

  return lines.join('\n');
}

function buildClickCauses(diag) {
  const causes = [];
  const d = diag.debugger;
  const p = diag.page;

  if (d.enabled && !d.neutralizeDeployed && p.readyState === 'loading') {
    causes.push('Page has anti-debugging measures (Debugger enabled, neutralize not deployed, page still loading)');
  }
  if (d.enabled && d.paused) {
    causes.push('Debugger is paused at a breakpoint (click may be blocked)');
  }
  if (p.readyState === 'loading') {
    causes.push('Page is still loading, target element may not be rendered yet');
  }
  if (!d.enabled && p.readyState === 'complete') {
    causes.push('Element not found or click handler is blocking');
  }
  if (causes.length === 0) {
    causes.push('Unknown cause — check page state and selector');
  }
  return causes;
}

function buildClickActions(diag) {
  const actions = [];
  const d = diag.debugger;
  const p = diag.page;

  if (d.enabled && !d.neutralizeDeployed) {
    actions.push('If page has anti-debugging: debug <target> neutralize (strips debugger; from 4 code paths), then retry');
  }
  if (d.enabled && d.paused) {
    actions.push('If paused at breakpoint: debug <target> status, then debug <target> resume');
  }
  if (p.readyState === 'loading') {
    actions.push('If page is still loading: wait for navigation to complete, then retry click');
  }
  actions.push('If element not found: use \'snap\' to inspect page structure, update selector');
  actions.push('General: check \'info <target>\' for page status overview');
  return actions;
}

export async function collectEvalDiagnostics(cdp, sessionId, dbg, expression) {
  const [readyState, url] = await Promise.allSettled([
    quickEval(cdp, sessionId, 'document.readyState'),
    quickEval(cdp, sessionId, 'location.href'),
  ]);

  return {
    expression,
    page: {
      readyState: readyState.status === 'fulfilled' ? readyState.value : null,
      url: url.status === 'fulfilled' ? url.value : null,
    },
    debugger: {
      enabled: dbg.isEnabled(),
      paused: dbg.isPaused(),
      neutralizeDeployed: dbg.isNeutralizeDeployed(),
    },
  };
}

export function formatEvalError(originalError, diag) {
  const lines = [originalError];

  if (diag.expression) {
    lines.push(`  expression: ${diag.expression}`);
  }

  const hasPageInfo = diag.page.url !== null || diag.page.readyState !== null;
  const hasDebuggerInfo = diag.debugger.enabled || diag.debugger.paused || diag.debugger.neutralizeDeployed;

  if (hasPageInfo || hasDebuggerInfo) {
    if (hasPageInfo) {
      lines.push('');
      lines.push('Page state:');
      if (diag.page.url !== null) lines.push(`  URL: ${diag.page.url}`);
      if (diag.page.readyState !== null) lines.push(`  readyState: ${diag.page.readyState}`);
    }

    if (hasDebuggerInfo) {
      lines.push('');
      lines.push('Debugger state:');
      lines.push(`  enabled: ${diag.debugger.enabled ? 'yes' : 'no'}`);
      if (diag.debugger.paused) lines.push('  paused: yes');
      lines.push(`  neutralize hook: ${diag.debugger.neutralizeDeployed ? 'deployed' : 'not deployed'}`);
    }

    lines.push('');
    lines.push('Possible causes:');
    const causes = buildCauses(diag);
    causes.forEach((c, i) => lines.push(`  ${i + 1}. ${c}`));

    lines.push('');
    lines.push('Suggested actions:');
    const actions = buildActions(diag);
    actions.forEach(a => lines.push(`  - ${a}`));
  } else {
    lines.push('');
    lines.push('Page appears unresponsive — all diagnostic queries failed.');
    lines.push('Possible causes:');
    lines.push('  1. Expression may contain an infinite loop');
    lines.push('  2. Page may have crashed');
    lines.push('  3. CDP connection may be broken');
    lines.push('');
    lines.push('Suggested actions:');
    lines.push('  - Check if the expression has side effects or infinite loops');
    lines.push('  - Try \'info <target>\' to check if page is still reachable');
    lines.push('  - If page crashed: navigate to a different URL or restart the tab');
  }

  return lines.join('\n');
}

function buildCauses(diag) {
  const causes = [];
  const d = diag.debugger;
  const p = diag.page;

  if (d.enabled && !d.neutralizeDeployed && p.readyState === 'loading') {
    causes.push('Page has anti-debugging measures (Debugger enabled, page still loading, neutralize not deployed)');
  }
  if (d.enabled && !d.neutralizeDeployed && p.readyState === 'complete') {
    causes.push('Page has anti-debugging measures (Debugger enabled, neutralize not deployed, may block Promise resolution)');
  }
  if (d.enabled && d.paused) {
    causes.push('Debugger is paused at a breakpoint (eval may be blocked)');
  }
  if (d.enabled && d.neutralizeDeployed) {
    causes.push('Neutralize is deployed but page still timed out (may have uncovered anti-debugging techniques)');
  }
  if (p.readyState === 'loading') {
    causes.push('Navigation still in progress (readyState=loading)');
  }
  if (!d.enabled && p.readyState === 'complete') {
    causes.push('Expression may have side effects or be an infinite loop');
  }
  if (causes.length === 0) {
    causes.push('Unknown cause — check page state and expression');
  }
  return causes;
}

function buildActions(diag) {
  const actions = [];
  const d = diag.debugger;
  const p = diag.page;

  if (d.enabled && !d.neutralizeDeployed) {
    actions.push('If page has anti-debugging: debug <target> neutralize (strips debugger; from 4 code paths: Function, eval, setTimeout, setInterval)');
  }
  if (d.enabled && d.paused) {
    actions.push('If paused at breakpoint: debug <target> status (inspect pause location), then debug <target> resume');
  }
  if (d.enabled && d.neutralizeDeployed) {
    actions.push('If neutralize is insufficient: debug <target> reset (re-enable + restore breakpoints), then retry');
  }
  if (p.readyState === 'loading') {
    actions.push('If page is still loading: wait for navigation to complete, then retry');
  }
  if (!d.enabled && p.readyState === 'complete') {
    actions.push('If expression may be problematic: simplify the expression and retry');
  }
  actions.push('General: check \'info <target>\' for page status overview');
  return actions;
}
