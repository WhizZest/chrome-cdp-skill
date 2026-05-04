function formatDuration(us) {
  if (us >= 1_000_000) return `${(us / 1_000_000).toFixed(2)}s`;
  if (us >= 1_000) return `${(us / 1_000).toFixed(2)}ms`;
  return `${us.toFixed(0)}μs`;
}

function formatTime(us, baseUs) {
  const offset = (us - baseUs) / 1_000_000;
  return `${offset.toFixed(2)}s`;
}

function resolveLocation(scriptId, scripts) {
  const s = scripts.get(String(scriptId));
  if (!s || !s.url) return `script:${scriptId}`;
  const name = s.url.split('/').pop() || s.url;
  return name;
}

function resolveFullLocation(scriptId, lineNumber, scripts) {
  const loc = resolveLocation(scriptId, scripts);
  if (lineNumber != null) return `${loc}:${lineNumber}`;
  return loc;
}

function aggregateFunctionCalls(events, baseTs) {
  const funcMap = new Map();
  const beginStack = [];

  for (const evt of events) {
    if (evt.name !== 'FunctionCall') continue;
    const data = evt.args?.data;
    if (!data) continue;
    const fnName = data.functionName;
    if (!fnName) continue;

    if (evt.ph === 'X' && evt.dur != null) {
      let entry = funcMap.get(fnName);
      if (!entry) {
        entry = {
          functionName: fnName,
          totalTime: 0,
          callCount: 0,
          scriptId: data.scriptId,
          lineNumber: data.lineNumber,
          columnNumber: data.columnNumber,
          firstSeen: evt.ts,
        };
        funcMap.set(fnName, entry);
      }
      entry.totalTime += evt.dur;
      entry.callCount++;
      if (evt.ts < entry.firstSeen) entry.firstSeen = evt.ts;
    } else if (evt.ph === 'B') {
      beginStack.push({ fnName, ts: evt.ts, scriptId: data.scriptId, lineNumber: data.lineNumber, columnNumber: data.columnNumber });
    } else if (evt.ph === 'E') {
      for (let i = beginStack.length - 1; i >= 0; i--) {
        if (beginStack[i].fnName === fnName) {
          const begin = beginStack.splice(i, 1)[0];
          const dur = evt.ts - begin.ts;
          let entry = funcMap.get(fnName);
          if (!entry) {
            entry = {
              functionName: fnName,
              totalTime: 0,
              callCount: 0,
              scriptId: begin.scriptId,
              lineNumber: begin.lineNumber,
              columnNumber: begin.columnNumber,
              firstSeen: begin.ts,
            };
            funcMap.set(fnName, entry);
          }
          entry.totalTime += dur;
          entry.callCount++;
          if (begin.ts < entry.firstSeen) entry.firstSeen = begin.ts;
          break;
        }
      }
    }
  }

  return Array.from(funcMap.values());
}

function extractNetworkEvents(events, baseTs) {
  const netEvents = [];
  const pending = new Map();
  let idx = 0;

  for (const evt of events) {
    const data = evt.args?.data;
    if (!data) continue;

    if (evt.name === 'ResourceSendRequest') {
      const entry = {
        url: data.url,
        method: data.requestMethod,
        startTs: evt.ts,
        statusCode: null,
        endTs: null,
        requestId: data.requestId,
        idx: idx++,
      };
      pending.set(data.requestId, entry);
      netEvents.push(entry);
    } else if (evt.name === 'ResourceReceiveResponse') {
      const entry = pending.get(data.requestId);
      if (entry && !entry.statusCode) {
        entry.statusCode = data.statusCode;
      }
    } else if (evt.name === 'ResourceFinish') {
      const entry = pending.get(data.requestId);
      if (entry && !entry.endTs) {
        entry.endTs = evt.ts;
        pending.delete(data.requestId);
      }
    }
  }

  return netEvents;
}

function correlateNetworkWithFunctions(netEvents, funcList, baseTs) {
  const hints = [];
  for (const net of netEvents) {
    if (!net.endTs) continue;
    const netStart = net.startTs;
    const netEnd = net.endTs;

    const nearby = funcList
      .filter(f => {
        const fStart = f.firstSeen;
        return fStart >= netStart - 50_000 && fStart <= netEnd + 50_000;
      })
      .sort((a, b) => b.totalTime - a.totalTime)
      .slice(0, 3);

    if (nearby.length > 0) {
      hints.push({
        idx: net.idx,
        url: net.url,
        method: net.method,
        functions: nearby.map(f => f.functionName),
      });
    }
  }
  return hints;
}

export function analyzeTrace(traceEvents, { topN = 10, scripts = new Map() } = {}) {
  if (!traceEvents || traceEvents.length === 0) {
    return 'No trace events collected. The recording may have been too short or no JS executed.';
  }

  const firstReal = traceEvents.find(e => e.cat !== '__metadata' && e.ts > 0);
  const baseTs = firstReal ? firstReal.ts : (traceEvents[0]?.ts || 0);

  const funcList = aggregateFunctionCalls(traceEvents, baseTs);
  funcList.sort((a, b) => b.totalTime - a.totalTime);
  const topFuncs = funcList.slice(0, topN);

  const netEvents = extractNetworkEvents(traceEvents, baseTs);
  netEvents.sort((a, b) => a.startTs - b.startTs);

  const correlations = correlateNetworkWithFunctions(netEvents, funcList, baseTs);

  const lastReal = [...traceEvents].reverse().find(e => e.cat !== '__metadata' && e.ts > 0);
  const lastTs = lastReal ? lastReal.ts : baseTs;
  const totalDuration = lastTs - baseTs;

  const lines = [];
  lines.push('=== Performance Trace Report ===');
  lines.push(`Duration: ${formatDuration(totalDuration)}  |  Functions tracked: ${funcList.length}  |  Network requests: ${netEvents.length}`);
  lines.push('');

  if (topFuncs.length > 0) {
    lines.push(`Top ${topFuncs.length} Hot Functions (by total time):`);
    lines.push('  Rank  Function                  Total Time   Calls   Avg Time   Location');
    lines.push('  ----  --------                  ----------   -----   --------   --------');

    for (let i = 0; i < topFuncs.length; i++) {
      const f = topFuncs[i];
      const rank = String(i + 1).padEnd(6);
      const name = f.functionName.padEnd(26);
      const total = formatDuration(f.totalTime).padEnd(12);
      const calls = String(f.callCount).padEnd(7);
      const avg = formatDuration(Math.round(f.totalTime / f.callCount)).padEnd(10);
      const loc = resolveFullLocation(f.scriptId, f.lineNumber, scripts);
      lines.push(`  ${rank}${name}${total}${calls}${avg}${loc}`);
    }
    lines.push('');
  }

  if (netEvents.length > 0) {
    lines.push('Network Timeline:');
    for (const net of netEvents) {
      const time = formatTime(net.startTs, baseTs);
      const method = (net.method || 'GET').padEnd(6);
      const url = net.url || '(unknown)';
      const status = net.statusCode ? `→ ${net.statusCode}` : '(pending)';
      const dur = net.endTs ? ` (${formatDuration(net.endTs - net.startTs)})` : '';
      lines.push(`  ${time}  ${method}${url}  ${status}${dur}`);

      const corr = correlations.find(c => c.idx === net.idx);
      if (corr) {
        lines.push(`         ↑ triggered near: ${corr.functions.join(' → ')}`);
      }
    }
    lines.push('');
  }

  const funcHints = [];
  for (const f of topFuncs.slice(0, 5)) {
    const loc = resolveFullLocation(f.scriptId, f.lineNumber, scripts);
    if (f.callCount === 1 && f.totalTime > 100_000) {
      funcHints.push(`  - ${f.functionName} (${loc}) called once, ${formatDuration(f.totalTime)} — likely a main processing function`);
    } else if (f.callCount > 100) {
      funcHints.push(`  - ${f.functionName} (${loc}) called ${f.callCount} times — likely a helper/utility`);
    }
  }

  const netHints = [];
  for (const corr of correlations.slice(0, 3)) {
    const method = corr.method || 'GET';
    const shortUrl = corr.url ? corr.url.split('?')[0] : '(unknown)';
    netHints.push(`  - ${method} ${shortUrl} correlates with ${corr.functions.join(' → ')} call chain`);
  }

  if (funcHints.length > 0 || netHints.length > 0) {
    lines.push('Analysis Hints:');
    for (const h of funcHints) lines.push(h);
    for (const h of netHints) lines.push(h);
  }

  return lines.join('\n');
}
