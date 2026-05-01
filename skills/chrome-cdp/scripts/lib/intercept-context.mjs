const rules = new Map();
let ruleIdCounter = 1;
let interceptEnabled = false;
let cdpRef = null;
let sidRef = null;
let offRequestPaused = null;
let passThroughCount = 0;

function matchUrl(pattern, url) {
  if (pattern === '*' || pattern === url) return true;
  if (url.includes(pattern)) return true;
  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, (c) => c === '*' ? '.*' : '\\' + c) + '$');
    return regex.test(url);
  }
  return false;
}

function findMatchingRule(url, stage) {
  for (const [, rule] of rules) {
    if (rule.stage !== stage) continue;
    if (matchUrl(rule.pattern, url)) return rule;
  }
  return null;
}

async function enable(cdp, sessionId, stages = ['Request']) {
  if (interceptEnabled && cdpRef === cdp && sidRef === sessionId) return;

  if (offRequestPaused) { offRequestPaused(); offRequestPaused = null; }

  cdpRef = cdp;
  sidRef = sessionId;

  offRequestPaused = cdp.onEvent('Fetch.requestPaused', async (params, msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;

    const url = params.request.url;
    const stage = params.responseStatusCode ? 'Response' : 'Request';
    const matchedRule = findMatchingRule(url, stage);

    if (!matchedRule) {
      passThroughCount++;
      try {
        if (stage === 'Response') {
          await cdp.send('Fetch.continueResponse', { requestId: params.requestId }, sessionId);
        } else {
          await cdp.send('Fetch.continueRequest', { requestId: params.requestId }, sessionId);
        }
      } catch {}
      return;
    }

    matchedRule.hitCount++;

    try {
      switch (matchedRule.action) {
        case 'modify-header': {
          const headers = Object.entries(params.request.headers || {}).map(
            ([name, value]) => ({ name, value })
          );
          headers.push({ name: matchedRule.config.headerName, value: matchedRule.config.headerValue });
          await cdp.send('Fetch.continueRequest', {
            requestId: params.requestId,
            headers,
          }, sessionId);
          break;
        }
        case 'mock': {
          const body = matchedRule.config.body || '';
          const base64Body = Buffer.from(body).toString('base64');
          const responseHeaders = Object.entries(matchedRule.config.headers || {}).map(
            ([name, value]) => ({ name, value })
          );
          await cdp.send('Fetch.fulfillRequest', {
            requestId: params.requestId,
            responseCode: matchedRule.config.status || 200,
            responseHeaders,
            body: base64Body,
          }, sessionId);
          break;
        }
        case 'block': {
          await cdp.send('Fetch.failRequest', {
            requestId: params.requestId,
            errorReason: 'BlockedByClient',
          }, sessionId);
          break;
        }
        default: {
          if (stage === 'Response') {
            await cdp.send('Fetch.continueResponse', { requestId: params.requestId }, sessionId);
          } else {
            await cdp.send('Fetch.continueRequest', { requestId: params.requestId }, sessionId);
          }
        }
      }
    } catch {}
  });

  const patterns = stages.map(stage => ({ urlPattern: '*', requestStage: stage }));
  await cdp.send('Fetch.enable', { patterns }, sessionId);
  interceptEnabled = true;
}

async function disable(cdp, sessionId) {
  if (offRequestPaused) { offRequestPaused(); offRequestPaused = null; }
  if (cdp && sessionId) {
    try { await cdp.send('Fetch.disable', {}, sessionId); } catch {}
  }
  interceptEnabled = false;
  cdpRef = null;
  sidRef = null;
}

function isEnabled() { return interceptEnabled; }

function addRule(pattern, action, stage, config = {}) {
  const ruleId = `R${ruleIdCounter++}`;
  const rule = {
    ruleId,
    pattern,
    action,
    stage,
    config,
    hitCount: 0,
  };
  rules.set(ruleId, rule);
  return rule;
}

function removeRule(ruleId) {
  return rules.delete(ruleId);
}

function getRules() {
  return Array.from(rules.values());
}

function clearRules() {
  const count = rules.size;
  rules.clear();
  return count;
}

function getStats() {
  return {
    enabled: interceptEnabled,
    totalRules: rules.size,
    totalHits: Array.from(rules.values()).reduce((sum, r) => sum + r.hitCount, 0),
    passThroughCount,
    rules: Array.from(rules.values()).map(r => ({
      ruleId: r.ruleId,
      action: r.action,
      pattern: r.pattern,
      hitCount: r.hitCount,
    })),
  };
}

function reset() {
  rules.clear();
  ruleIdCounter = 1;
  passThroughCount = 0;
}

export {
  enable, disable, isEnabled,
  addRule, removeRule, getRules, clearRules,
  getStats, reset,
  matchUrl, findMatchingRule,
};
