import assert from 'assert/strict';
import { describe, test, summary } from '../lib/test-runner.mjs';

const SRC = '../../skills/chrome-cdp/scripts/lib/neutralize-utils.mjs';

const { findDebuggerStatements, replaceDebuggerStatements, containsDebugger } = await import(SRC);

describe('containsDebugger', () => {
  test('finds debugger keyword', () => {
    assert.equal(containsDebugger('debugger;'), true);
  });

  test('finds debugger in middle of code', () => {
    assert.equal(containsDebugger('if(x){debugger;}'), true);
  });

  test('returns false when no debugger', () => {
    assert.equal(containsDebugger('console.log("hello");'), false);
  });

  test('returns false for empty string', () => {
    assert.equal(containsDebugger(''), false);
  });
});

describe('findDebuggerStatements', () => {
  test('finds single debugger statement', () => {
    const locs = findDebuggerStatements('debugger;');
    assert.equal(locs.length, 1);
    assert.equal(locs[0].line, 0);
    assert.equal(locs[0].column, 0);
  });

  test('finds multiple debugger statements', () => {
    const locs = findDebuggerStatements('debugger;\ndebugger;');
    assert.equal(locs.length, 2);
    assert.equal(locs[0].line, 0);
    assert.equal(locs[1].line, 1);
  });

  test('ignores debugger in single-line comment', () => {
    const locs = findDebuggerStatements('// debugger;\ndebugger;');
    assert.equal(locs.length, 1);
    assert.equal(locs[0].line, 1);
  });

  test('ignores debugger in multi-line comment', () => {
    const locs = findDebuggerStatements('/* debugger; */\ndebugger;');
    assert.equal(locs.length, 1);
    assert.equal(locs[0].line, 1);
  });

  test('ignores debugger in double-quoted string', () => {
    const locs = findDebuggerStatements('"debugger;";\ndebugger;');
    assert.equal(locs.length, 1);
    assert.equal(locs[0].line, 1);
  });

  test('ignores debugger in single-quoted string', () => {
    const locs = findDebuggerStatements("'debugger;';\ndebugger;");
    assert.equal(locs.length, 1);
    assert.equal(locs[0].line, 1);
  });

  test('ignores debugger in template literal', () => {
    const locs = findDebuggerStatements('`debugger;`;\ndebugger;');
    assert.equal(locs.length, 1);
    assert.equal(locs[0].line, 1);
  });

  test('finds debugger in template expression', () => {
    const locs = findDebuggerStatements('`hello ${debugger} world`;');
    assert.equal(locs.length, 1);
  });

  test('handles escaped quotes in strings', () => {
    const locs = findDebuggerStatements('"escaped\\"debugger;";\ndebugger;');
    assert.equal(locs.length, 1);
    assert.equal(locs[0].line, 1);
  });

  test('returns empty for no debugger', () => {
    const locs = findDebuggerStatements('console.log("hello");');
    assert.equal(locs.length, 0);
  });

  test('finds debugger with surrounding code', () => {
    const locs = findDebuggerStatements('function f(){\n  debugger;\n  return 1;\n}');
    assert.equal(locs.length, 1);
    assert.equal(locs[0].line, 1);
    assert.equal(locs[0].column, 2);
  });

  test('handles multi-line comment spanning lines', () => {
    const locs = findDebuggerStatements('/*\ndebugger;\n*/\ndebugger;');
    assert.equal(locs.length, 1);
    assert.equal(locs[0].line, 3);
  });
});

describe('replaceDebuggerStatements', () => {
  test('replaces single debugger', () => {
    const result = replaceDebuggerStatements('debugger;');
    assert.equal(result, 'void 0;');
  });

  test('replaces multiple debuggers', () => {
    const result = replaceDebuggerStatements('debugger;\ndebugger;');
    assert.equal(result, 'void 0;\nvoid 0;');
  });

  test('does not replace debugger in strings', () => {
    const result = replaceDebuggerStatements('"debugger;";\ndebugger;');
    assert.equal(result, '"debugger;";\nvoid 0;');
  });

  test('does not replace debugger in comments', () => {
    const result = replaceDebuggerStatements('// debugger;\ndebugger;');
    assert.equal(result, '// debugger;\nvoid 0;');
  });

  test('preserves surrounding code', () => {
    const result = replaceDebuggerStatements('if(x){debugger;}else{run();}');
    assert.equal(result, 'if(x){void 0;}else{run();}');
  });

  test('returns unchanged when no debugger', () => {
    const result = replaceDebuggerStatements('console.log("hello");');
    assert.equal(result, 'console.log("hello");');
  });
});

summary();
