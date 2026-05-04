import assert from 'assert/strict';
import { describe, test, summary } from '../lib/test-runner.mjs';

const SRC = '../../skills/chrome-cdp/scripts/lib/trace-analyzer.mjs';

const { analyzeTrace } = await import(SRC);

function makeFuncCallX(name, ts, dur, scriptId = '1', lineNumber = 0) {
  return {
    ph: 'X',
    ts,
    dur,
    name: 'FunctionCall',
    cat: 'devtools.timeline',
    args: {
      data: {
        functionName: name,
        scriptId,
        lineNumber,
        columnNumber: 0,
      },
    },
  };
}

function makeFuncCallBE(name, ts, endTs, scriptId = '1', lineNumber = 0) {
  return [
    {
      ph: 'B',
      ts,
      name: 'FunctionCall',
      cat: 'devtools.timeline',
      args: { data: { functionName: name, scriptId, lineNumber, columnNumber: 0 } },
    },
    {
      ph: 'E',
      ts: endTs,
      name: 'FunctionCall',
      cat: 'devtools.timeline',
      args: { data: { functionName: name } },
    },
  ];
}

function makeNetEvent(name, ts, data = {}) {
  return {
    ph: 'X',
    ts,
    dur: 0,
    name,
    cat: 'devtools.timeline',
    args: { data },
  };
}

describe('analyzeTrace', () => {
  test('returns message for empty events', () => {
    const result = analyzeTrace([]);
    assert.ok(result.includes('No trace events collected'));
  });

  test('returns message for null events', () => {
    const result = analyzeTrace(null);
    assert.ok(result.includes('No trace events collected'));
  });

  test('aggregates X-format function calls', () => {
    const events = [
      makeFuncCallX('foo', 1000, 500),
      makeFuncCallX('foo', 2000, 300),
      makeFuncCallX('bar', 3000, 1000),
    ];
    const result = analyzeTrace(events, { topN: 10 });
    assert.ok(result.includes('foo'));
    assert.ok(result.includes('bar'));
    assert.ok(result.includes('800')); // total for foo: 500+300
    assert.ok(result.includes('2')); // call count for foo
  });

  test('aggregates B/E-format function calls', () => {
    const events = [
      ...makeFuncCallBE('baz', 1000, 1500),
      ...makeFuncCallBE('baz', 2000, 2500),
    ];
    const result = analyzeTrace(events, { topN: 10 });
    assert.ok(result.includes('baz'));
    assert.ok(result.includes('1.00ms')); // total: 500+500=1000μs=1.00ms
    assert.ok(result.includes('2'));
  });

  test('handles mixed X and B/E formats', () => {
    const events = [
      makeFuncCallX('mixed', 1000, 200),
      ...makeFuncCallBE('mixed', 2000, 2300),
    ];
    const result = analyzeTrace(events, { topN: 10 });
    assert.ok(result.includes('mixed'));
    assert.ok(result.includes('500')); // total: 200+300
    assert.ok(result.includes('2'));
  });

  test('respects topN limit', () => {
    const events = [
      makeFuncCallX('funcA', 1000, 100),
      makeFuncCallX('funcB', 2000, 200),
      makeFuncCallX('funcC', 3000, 300),
    ];
    const result = analyzeTrace(events, { topN: 2 });
    assert.ok(result.includes('Top 2 Hot Functions'));
    assert.ok(result.includes('funcC'));
    assert.ok(result.includes('funcB'));
    assert.ok(!result.includes('funcA'));
  });

  test('includes network events', () => {
    const events = [
      makeFuncCallX('fn', 1000, 100),
      makeNetEvent('ResourceSendRequest', 500, { url: '/api/test', requestMethod: 'POST', requestId: 'req1' }),
      makeNetEvent('ResourceReceiveResponse', 600, { url: '/api/test', statusCode: 200, requestId: 'req1' }),
      makeNetEvent('ResourceFinish', 700, { url: '/api/test', requestId: 'req1' }),
    ];
    const result = analyzeTrace(events, { topN: 10 });
    assert.ok(result.includes('Network Timeline'));
    assert.ok(result.includes('/api/test'));
    assert.ok(result.includes('POST'));
    assert.ok(result.includes('200'));
  });

  test('resolves script locations', () => {
    const scripts = new Map([
      ['42', { scriptId: '42', url: 'https://example.com/bundle.js' }],
    ]);
    const events = [
      makeFuncCallX('_0x4a2b', 1000, 500, '42', 234),
    ];
    const result = analyzeTrace(events, { topN: 10, scripts });
    assert.ok(result.includes('bundle.js:234'));
  });

  test('handles missing script info gracefully', () => {
    const events = [
      makeFuncCallX('orphan', 1000, 500, '99', 10),
    ];
    const result = analyzeTrace(events, { topN: 10 });
    assert.ok(result.includes('orphan'));
    assert.ok(result.includes('script:99'));
  });

  test('generates analysis hints for single-call heavy functions', () => {
    const events = [
      makeFuncCallX('encrypt', 1000, 800_000),
    ];
    const result = analyzeTrace(events, { topN: 10 });
    assert.ok(result.includes('Analysis Hints'));
    assert.ok(result.includes('likely a main processing function'));
  });

  test('generates analysis hints for high-frequency functions', () => {
    const events = Array.from({ length: 200 }, (_, i) =>
      makeFuncCallX('helper', i * 1000, 100)
    );
    const result = analyzeTrace(events, { topN: 10 });
    assert.ok(result.includes('likely a helper/utility'));
  });

  test('includes correlation hints', () => {
    const events = [
      makeFuncCallX('encrypt', 500, 300_000),
      makeNetEvent('ResourceSendRequest', 600, { url: '/api/sign', requestMethod: 'POST', requestId: 'req2' }),
      makeNetEvent('ResourceReceiveResponse', 700, { url: '/api/sign', statusCode: 200, requestId: 'req2' }),
      makeNetEvent('ResourceFinish', 800, { url: '/api/sign', requestId: 'req2' }),
    ];
    const result = analyzeTrace(events, { topN: 10 });
    assert.ok(result.includes('correlates with'));
  });
});

await summary();
