let traceEvents = [];
let traceActive = false;
let traceStartTime = null;

export function isActive() {
  return traceActive;
}

export function getEventCount() {
  return traceEvents.length;
}

export function getElapsed() {
  return traceStartTime ? Date.now() - traceStartTime : 0;
}

export async function start(cdp, sessionId) {
  if (traceActive) {
    throw new Error('Trace already active. Run "debug perf stop" first.');
  }
  traceEvents = [];
  traceActive = true;
  traceStartTime = Date.now();
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,v8,netlog',
    options: 'sampling-frequency=10000',
    bufferUsageReportingInterval: 1000,
  }, sessionId);
}

export async function stop(cdp, sessionId, { topN = 10, scripts = new Map() } = {}) {
  if (!traceActive) {
    throw new Error('No active trace. Run "debug perf start" first.');
  }

  const tracingComplete = new Promise((resolve) => {
    cdp.onEvent('Tracing.tracingComplete', (params) => resolve(params));
  });
  await cdp.send('Tracing.end', {}, sessionId);
  await tracingComplete;

  traceActive = false;

  const { analyzeTrace } = await import('./trace-analyzer.mjs');
  const events = [...traceEvents];
  traceEvents = [];
  traceStartTime = null;

  return analyzeTrace(events, { topN, scripts });
}

const MAX_EVENTS = 50000;

export function pushEvents(events) {
  if (!traceActive) return;
  if (Array.isArray(events)) {
    if (traceEvents.length >= MAX_EVENTS) return;
    const remaining = MAX_EVENTS - traceEvents.length;
    if (events.length > remaining) {
      traceEvents.push(...events.slice(0, remaining));
      process.stderr.write(`[trace] Event limit reached (${MAX_EVENTS}). Some events discarded.\n`);
    } else {
      traceEvents.push(...events);
    }
  }
}

export function status() {
  if (!traceActive) {
    return 'No active trace. Run "debug perf start" to begin.';
  }
  const elapsed = ((Date.now() - traceStartTime) / 1000).toFixed(1);
  return `Recording: ${elapsed}s elapsed, ${traceEvents.length} events collected.`;
}
