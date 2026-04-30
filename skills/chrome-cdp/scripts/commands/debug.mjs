import { writeFileSync } from 'fs';
import { registerCommand } from '../lib/command-registry.mjs';

async function ensureEnabled(dbg, cdp, sessionId) {
  if (!dbg.isEnabled()) {
    await dbg.enable(cdp, sessionId);
  }
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  const knownFlags = new Set([
    'startLine', 'endLine', 'offset', 'length', 'max',
    'filter', 'cond', 'condition', 'nth', 'frame',
    'regex', 'case', 'no-exclude-minified', 'no-scopes', 'pause',
  ]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx >= 0) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        if (knownFlags.has(key) && i + 1 < args.length && !args[i + 1].startsWith('--')) {
          flags[key] = args[++i];
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

async function handleScripts(dbg, cdp, sessionId, args) {
  await ensureEnabled(dbg, cdp, sessionId);
  const filter = args[0];
  let scripts = dbg.getScripts();
  if (filter) scripts = dbg.getScriptsByUrlPattern(filter);
  const withUrls = scripts.filter(s => s.url);
  const display = withUrls.length > 0 ? withUrls : scripts;
  if (display.length === 0) return 'No scripts found.';
  const lines = [`Found ${display.length} script(s):\n`];
  for (const s of display) {
    lines.push(`- ID: ${s.scriptId}`);
    let url = s.url || '(inline/eval)';
    if (url.startsWith('data:') && url.length > 100) url = url.substring(0, 100) + '... (truncated)';
    else if (url.length > 200) url = url.substring(0, 200) + '... (truncated)';
    lines.push(`  URL: ${url}`);
    if (s.sourceMapURL) lines.push(`  SourceMap: ${s.sourceMapURL}`);
    lines.push('');
  }
  return lines.join('\n');
}

async function handleSource(dbg, cdp, sessionId, args) {
  await ensureEnabled(dbg, cdp, sessionId);
  const { flags, positional } = parseFlags(args);
  const idOrUrl = positional[0];
  if (!idOrUrl) throw new Error('Script ID or URL required');

  let source, bytecode, scriptId, script;
  const isUrl = idOrUrl.startsWith('http') || idOrUrl.startsWith('/') || idOrUrl.startsWith('./');
  if (isUrl) {
    const result = await dbg.getScriptSourceByUrl(idOrUrl);
    source = result.source;
    bytecode = result.bytecode;
    script = result.script;
    scriptId = result.script.scriptId;
  } else {
    scriptId = idOrUrl;
    script = dbg.getScriptById(scriptId);
    const result = await dbg.getScriptSource(scriptId);
    source = result.scriptSource;
    bytecode = result.bytecode;
  }

  if (!source && !bytecode) return `No source found for script ${scriptId}.`;
  if (bytecode) {
    const size = Buffer.from(bytecode, 'base64').length;
    return `Script ${scriptId} is a WebAssembly binary (${size} bytes). Use debug save to download.`;
  }

  const startLine = flags.startLine ? parseInt(flags.startLine) : undefined;
  const endLine = flags.endLine ? parseInt(flags.endLine) : undefined;
  const offset = flags.offset ? parseInt(flags.offset) : undefined;
  const length = flags.length ? parseInt(flags.length) : 1000;

  if (offset !== undefined) {
    const start = Math.max(0, offset);
    const end = Math.min(source.length, start + length);
    const extract = source.substring(start, end);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < source.length ? '...' : '';
    return `Source for script ${scriptId} (chars ${start}-${end} of ${source.length}):\n\n${prefix}${extract}${suffix}`;
  }

  if (startLine !== undefined || endLine !== undefined) {
    const lines = source.split('\n');
    const start = (startLine ?? 1) - 1;
    const end = endLine ?? lines.length;
    const selected = lines.slice(start, end);
    const content = selected.join('\n');
    if (content.length > 5000) {
      return `Selected lines ${start + 1}-${Math.min(end, lines.length)} are too large (${content.length} chars). Use --offset/--length instead.`;
    }
    const numbered = selected.map((l, i) => `${start + i + 1}: ${l}`).join('\n');
    return `Source for script ${scriptId} (lines ${start + 1}-${Math.min(end, lines.length)}):\n\n${numbered}`;
  }

  if (source.length > 1000) {
    return `Script ${scriptId} is large (${source.length} chars). Use --startLine/--endLine or --offset/--length to read portions.\n\nFirst 1000 characters:\n\n${source.substring(0, 1000)}...`;
  }
  return `Source for script ${scriptId}:\n\n${source}`;
}

async function handleSave(dbg, cdp, sessionId, args) {
  await ensureEnabled(dbg, cdp, sessionId);
  const idOrUrl = args[0];
  const filePath = args[1];
  if (!idOrUrl || !filePath) throw new Error('Usage: debug save <id|url> <file>');

  let source, bytecode;
  const isUrl = idOrUrl.startsWith('http') || idOrUrl.startsWith('/') || idOrUrl.startsWith('./');
  if (isUrl) {
    const result = await dbg.getScriptSourceByUrl(idOrUrl);
    source = result.source;
    bytecode = result.bytecode;
  } else {
    const result = await dbg.getScriptSource(idOrUrl);
    source = result.scriptSource;
    bytecode = result.bytecode;
  }

  if (!source && !bytecode) throw new Error('No source found');
  if (bytecode) {
    const buf = Buffer.from(bytecode, 'base64');
    writeFileSync(filePath, buf);
    return `Saved WASM to ${filePath} (${buf.length} bytes)`;
  }
  writeFileSync(filePath, source, 'utf8');
  return `Saved script source to ${filePath} (${source.length} chars)`;
}

async function handleSearch(dbg, cdp, sessionId, args) {
  await ensureEnabled(dbg, cdp, sessionId);
  const { flags, positional } = parseFlags(args);
  const query = positional[0];
  if (!query) throw new Error('Search query required');

  const result = await dbg.searchInScripts(query, {
    caseSensitive: !!flags.case,
    isRegex: !!flags.regex,
  });

  let matches = result.matches;
  if (flags.filter) {
    const lower = flags.filter.toLowerCase();
    matches = matches.filter(m => m.url && m.url.toLowerCase().includes(lower));
  }

  const excludeMinified = flags['no-exclude-minified'] ? false : true;
  let skippedMinified = 0;
  if (excludeMinified) {
    const before = matches.length;
    matches = matches.filter(m => m.lineContent.length < 10000);
    skippedMinified = before - matches.length;
  }

  if (matches.length === 0) {
    let msg = `No matches found for "${query}".`;
    if (skippedMinified > 0) msg += ` (${skippedMinified} matches in minified files skipped)`;
    return msg;
  }

  const maxResults = flags.max ? parseInt(flags.max) : 30;
  const display = matches.slice(0, maxResults);
  const lines = [`Found ${matches.length} match(es) for "${query}"${matches.length > maxResults ? ` (showing first ${maxResults})` : ''}:`];
  if (skippedMinified > 0) lines.push(`(${skippedMinified} matches in minified files skipped)`);
  lines.push('');

  for (const m of display) {
    const lineNum = m.lineNumber + 1;
    let preview = m.lineContent.trim();
    const maxLen = 150;
    if (preview.length > maxLen) {
      const lowerContent = flags.case ? preview : preview.toLowerCase();
      const lowerQuery = flags.case ? query : query.toLowerCase();
      const matchPos = flags.regex ? 0 : lowerContent.indexOf(lowerQuery);
      if (matchPos >= 0) {
        const half = Math.floor(maxLen / 2);
        let start = Math.max(0, matchPos - half);
        let end = start + maxLen;
        if (end > preview.length) { end = preview.length; start = Math.max(0, end - maxLen); }
        preview = (start > 0 ? '...' : '') + preview.substring(start, end) + (end < preview.length ? '...' : '');
      } else {
        preview = preview.substring(0, maxLen) + '...';
      }
    }
    lines.push(`[${m.scriptId}] ${m.url || '(inline)'}:${lineNum}`);
    lines.push(`  ${preview}`);
    lines.push('');
  }
  return lines.join('\n');
}

async function handleBreak(dbg, cdp, sessionId, args) {
  await ensureEnabled(dbg, cdp, sessionId);
  const { flags, positional } = parseFlags(args);
  const url = positional[0];
  const line = parseInt(positional[1]);
  const col = positional[2] ? parseInt(positional[2]) : 0;
  const condition = flags.cond || flags.condition || null;

  if (!url || isNaN(line)) throw new Error('Usage: debug break <url> <line> [col] [--cond expr]');

  const info = await dbg.setBreakpoint(url, line, col, condition);
  const lines = ['Breakpoint set:'];
  lines.push(`  ID: ${info.breakpointId}`);
  lines.push(`  URL: ${info.url}`);
  lines.push(`  Line: ${info.lineNumber + 1}, Column: ${info.columnNumber}`);
  if (info.condition) lines.push(`  Condition: ${info.condition}`);
  return lines.join('\n');
}

async function handleBreakText(dbg, cdp, sessionId, args) {
  await ensureEnabled(dbg, cdp, sessionId);
  const { flags, positional } = parseFlags(args);
  const text = positional[0];
  if (!text) throw new Error('Usage: debug breaktext <text> [--filter url] [--nth N] [--cond expr]');

  const searchResult = await dbg.searchInScripts(text, { caseSensitive: true });
  let matches = searchResult.matches;

  if (flags.filter) {
    const lower = flags.filter.toLowerCase();
    matches = matches.filter(m => m.url && m.url.toLowerCase().includes(lower));
  }
  matches = matches.filter(m => m.lineContent.length < 100000);

  if (matches.length === 0) return `"${text}" not found in any loaded script.`;

  const nth = flags.nth ? parseInt(flags.nth) : 1;
  if (nth > matches.length) return `Only ${matches.length} occurrence(s) found, but occurrence ${nth} was requested.`;

  const match = matches[nth - 1];
  const script = dbg.getScriptById(match.scriptId);
  const url = script?.url || match.url;
  if (!url) return 'Cannot set breakpoint: script has no URL (inline script).';

  const result = await dbg.getScriptSource(match.scriptId);
  const lines = result.scriptSource.split('\n');
  let columnNumber = 0;
  if (match.lineNumber < lines.length) {
    const colPos = lines[match.lineNumber].indexOf(text);
    if (colPos >= 0) columnNumber = colPos;
  }

  const condition = flags.cond || flags.condition || null;
  const info = await dbg.setBreakpoint(url, match.lineNumber, columnNumber, condition);

  const out = ['Breakpoint set:'];
  out.push(`  ID: ${info.breakpointId}`);
  out.push(`  URL: ${url}`);
  out.push(`  Line: ${match.lineNumber + 1}, Column: ${columnNumber}`);
  if (condition) out.push(`  Condition: ${condition}`);
  return out.join('\n');
}

async function handleBreakXhr(dbg, cdp, sessionId, args) {
  await ensureEnabled(dbg, cdp, sessionId);
  const url = args[0];
  if (!url) throw new Error('Usage: debug breakxhr <url-pattern>');
  await dbg.setXHRBreakpoint(url);
  return `XHR breakpoint set for URLs containing: "${url}"`;
}

async function handleBreaks(dbg, cdp, sessionId) {
  await ensureEnabled(dbg, cdp, sessionId);
  const bps = dbg.getBreakpoints();
  const xhrs = dbg.getXHRBreakpoints();
  if (bps.length === 0 && xhrs.length === 0) return 'No active breakpoints.';

  const lines = [];
  if (bps.length > 0) {
    lines.push(`Code breakpoints (${bps.length}):`);
    for (const bp of bps) {
      lines.push(`  - ID: ${bp.breakpointId}`);
      lines.push(`    URL: ${bp.url}`);
      lines.push(`    Line: ${bp.lineNumber + 1}, Column: ${bp.columnNumber}`);
      if (bp.condition) lines.push(`    Condition: ${bp.condition}`);
    }
  }
  if (xhrs.length > 0) {
    lines.push(`XHR breakpoints (${xhrs.length}):`);
    for (const url of xhrs) {
      lines.push(`  - ${url}`);
    }
  }
  return lines.join('\n');
}

async function handleUnbreak(dbg, cdp, sessionId, args) {
  await ensureEnabled(dbg, cdp, sessionId);
  const id = args[0];
  if (!id) throw new Error('Usage: debug unbreak <breakpointId|all>');

  if (id === 'all') {
    const count = dbg.getBreakpoints().length + dbg.getXHRBreakpoints().length;
    if (count === 0) return 'No active breakpoints to remove.';
    await dbg.removeAllBreakpoints();
    if (dbg.isPaused()) {
      await dbg.resume();
      return `Removed ${count} breakpoint(s). Execution resumed.`;
    }
    return `Removed ${count} breakpoint(s).`;
  }

  await dbg.removeBreakpoint(id);
  if (dbg.isPaused()) {
    await dbg.resume();
    return `Breakpoint ${id} removed. Execution resumed.`;
  }
  return `Breakpoint ${id} removed.`;
}

async function handleUnbreakXhr(dbg, cdp, sessionId, args) {
  await ensureEnabled(dbg, cdp, sessionId);
  const url = args[0];
  if (!url) throw new Error('Usage: debug unbreakxhr <url-pattern>');
  await dbg.removeXHRBreakpoint(url);
  return `XHR breakpoint for "${url}" removed.`;
}

async function handlePause(dbg, cdp, sessionId) {
  await ensureEnabled(dbg, cdp, sessionId);
  await dbg.pause();
  return 'Pause requested. Waiting for execution to pause...';
}

async function handleResume(dbg, cdp, sessionId) {
  await ensureEnabled(dbg, cdp, sessionId);
  await dbg.resume();
  return 'Execution resumed.';
}

async function handleStep(dbg, cdp, sessionId, direction) {
  await ensureEnabled(dbg, cdp, sessionId);
  if (!dbg.isPaused()) throw new Error('Execution is not paused. Cannot step.');

  const labels = { over: 'Stepped over', into: 'Stepped into', out: 'Stepped out' };
  const frame = direction === 'over' ? await dbg.stepOver()
    : direction === 'into' ? await dbg.stepInto()
    : await dbg.stepOut();

  const line = frame.location.lineNumber + 1;
  const col = frame.location.columnNumber + 1;
  const funcName = frame.functionName || '<anonymous>';
  const url = frame.url || `script:${frame.location.scriptId}`;
  const shortUrl = url.split('/').pop() || url;

  let snippet = '';
  try {
    const result = await dbg.getScriptSource(frame.location.scriptId);
    const lines = result.scriptSource.split('\n');
    const lineContent = lines[frame.location.lineNumber];
    if (lineContent) {
      const maxLen = 200;
      const half = Math.floor(maxLen / 2);
      const c = frame.location.columnNumber;
      const s = Math.max(0, c - half);
      const e = Math.min(lineContent.length, s + maxLen);
      const prefix = s > 0 ? '...' : '';
      const suffix = e < lineContent.length ? '...' : '';
      snippet = `\n  > ${prefix}${lineContent.substring(s, e)}${suffix}`;
    }
  } catch {}

  return `${labels[direction]} → ${shortUrl}:${line}:${col}, function ${funcName}${snippet}`;
}

async function handleStatus(dbg, cdp, sessionId, args) {
  await ensureEnabled(dbg, cdp, sessionId);
  const { flags } = parseFlags(args);
  const state = dbg.getPausedState();

  if (!state.isPaused) {
    return 'Execution is not paused. Set a breakpoint and trigger it to pause execution.';
  }

  const lines = ['Execution Paused\n'];
  if (state.reason) lines.push(`Reason: ${state.reason}`);
  if (state.hitBreakpoints && state.hitBreakpoints.length > 0) {
    lines.push(`Hit breakpoints: ${state.hitBreakpoints.join(', ')}`);
  }

  lines.push('\nCall Stack:');
  for (let i = 0; i < state.callFrames.length; i++) {
    const f = state.callFrames[i];
    const script = dbg.getScriptById(f.location.scriptId);
    const url = script?.url || f.url || `script:${f.location.scriptId}`;
    lines.push(`  ${i}. ${f.functionName} @ ${url}:${f.location.lineNumber + 1}:${f.location.columnNumber + 1}`);
  }

  const includeScopes = flags['no-scopes'] ? false : true;
  if (includeScopes && state.callFrames.length > 0) {
    const frameIdx = flags.frame ? parseInt(flags.frame) : 0;
    if (frameIdx >= 0 && frameIdx < state.callFrames.length) {
      const frame = state.callFrames[frameIdx];
      lines.push(`\nScope Variables (frame ${frameIdx}: ${frame.functionName}):`);
      for (const scope of frame.scopeChain) {
        if (scope.type === 'global') continue;
        lines.push(`\n  [${scope.name || scope.type}]:`);
        if (scope.object.objectId) {
          try {
            const vars = await dbg.getScopeVariables(scope.object.objectId);
            if (vars.length === 0) {
              lines.push('    (empty)');
            } else {
              for (const v of vars.slice(0, 20)) {
                let valStr = typeof v.value === 'string' ? `"${v.value}"` : JSON.stringify(v.value);
                if (valStr && valStr.length > 200) valStr = valStr.slice(0, 200) + '...(truncated)';
                lines.push(`    ${v.name}: ${valStr}`);
              }
              if (vars.length > 20) lines.push(`    ... and ${vars.length - 20} more`);
            }
          } catch {
            lines.push('    (unable to retrieve variables)');
          }
        }
      }
    }
  }

  lines.push('\nUse resume, stepover, stepinto, or stepout to continue.');
  return lines.join('\n');
}

async function handleVars(dbg, cdp, sessionId, args) {
  await ensureEnabled(dbg, cdp, sessionId);
  if (!dbg.isPaused()) throw new Error('Execution is not paused');

  const state = dbg.getPausedState();
  const frameIdx = args[0] ? parseInt(args[0]) : 0;
  if (frameIdx < 0 || frameIdx >= state.callFrames.length) {
    throw new Error(`frameIndex ${frameIdx} out of range (0-${state.callFrames.length - 1})`);
  }

  const frame = state.callFrames[frameIdx];
  const lines = [`Variables (frame ${frameIdx}: ${frame.functionName}):\n`];

  for (const scope of frame.scopeChain) {
    if (scope.type === 'global') continue;
    lines.push(`[${scope.name || scope.type}]:`);
    if (scope.object.objectId) {
      try {
        const vars = await dbg.getScopeVariables(scope.object.objectId);
        if (vars.length === 0) {
          lines.push('  (empty)');
        } else {
          for (const v of vars) {
            let valStr = typeof v.value === 'string' ? `"${v.value}"` : JSON.stringify(v.value);
            if (valStr && valStr.length > 200) valStr = valStr.slice(0, 200) + '...(truncated)';
            lines.push(`  ${v.name}: ${valStr}`);
          }
        }
      } catch {
        lines.push('  (unable to retrieve variables)');
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function handleEval(dbg, cdp, sessionId, args) {
  await ensureEnabled(dbg, cdp, sessionId);
  if (!dbg.isPaused()) throw new Error('Execution is not paused');

  const { positional } = parseFlags(args);
  const expr = positional[0];
  const frameIdx = positional[1] ? parseInt(positional[1]) : 0;
  if (!expr) throw new Error('Usage: debug eval <expr> [frame-idx]');

  const state = dbg.getPausedState();
  if (frameIdx < 0 || frameIdx >= state.callFrames.length) {
    throw new Error(`frameIndex ${frameIdx} out of range (0-${state.callFrames.length - 1})`);
  }

  const callFrameId = state.callFrames[frameIdx].callFrameId;
  const result = await dbg.evaluateOnCallFrame(callFrameId, expr);
  if (result.exceptionDetails) {
    throw new Error(`Evaluation error: ${result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'unknown'}`);
  }
  const val = result.result.value;
  return typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val ?? 'undefined');
}

async function handleTrace(dbg, cdp, sessionId, args) {
  await ensureEnabled(dbg, cdp, sessionId);
  const { flags, positional } = parseFlags(args);
  const funcName = positional[0];
  if (!funcName) throw new Error('Usage: debug trace <func-name> [--filter url] [--pause]');

  const patterns = [
    `function ${funcName}`,
    `${funcName}=function`,
    `${funcName} = function`,
    `${funcName}=(`,
    `${funcName} = (`,
    `${funcName}(`,
    `${funcName}:function`,
    `${funcName}: function`,
  ];

  let foundMatch = null;
  for (const pattern of patterns) {
    const result = await dbg.searchInScripts(pattern, { caseSensitive: true });
    let matches = result.matches;
    if (flags.filter) {
      const lower = flags.filter.toLowerCase();
      matches = matches.filter(m => m.url && m.url.toLowerCase().includes(lower));
    }
    matches = matches.filter(m => m.lineContent.length < 100000);
    if (matches.length > 0) {
      foundMatch = { pattern, match: matches[0] };
      break;
    }
  }

  if (!foundMatch) {
    return `Function "${funcName}" not found in any script. Use debug search to find the exact signature.`;
  }

  const { match } = foundMatch;
  const script = dbg.getScriptById(match.scriptId);
  const url = script?.url || match.url;
  if (!url) return 'Cannot trace: script has no URL (inline script).';

  const srcResult = await dbg.getScriptSource(match.scriptId);
  const lines = srcResult.scriptSource.split('\n');
  let columnNumber = 0;
  if (match.lineNumber < lines.length) {
    const colPos = lines[match.lineNumber].indexOf(foundMatch.pattern);
    if (colPos >= 0) {
      const afterPattern = lines[match.lineNumber].substring(colPos + foundMatch.pattern.length);
      const braceMatch = afterPattern.match(/[({]/);
      if (braceMatch && braceMatch.index !== undefined) {
        columnNumber = colPos + foundMatch.pattern.length + braceMatch.index + 1;
      } else {
        columnNumber = colPos;
      }
    }
  }

  const shouldPause = !!flags.pause;
  const logExpr = `console.log('[Trace ${funcName}] called', JSON.stringify(Array.from(arguments)).slice(0,500))`;
  const condition = shouldPause ? logExpr : `(${logExpr}, false)`;

  const info = await dbg.setBreakpoint(url, match.lineNumber, columnNumber, condition);

  const out = ['Function trace installed:'];
  out.push(`  Function: ${funcName}`);
  out.push(`  Breakpoint ID: ${info.breakpointId}`);
  out.push(`  Location: ${url}:${match.lineNumber + 1}:${columnNumber}`);
  out.push(`  Mode: ${shouldPause ? 'Pause on call' : 'Log only (no pause)'}`);
  out.push(`\nCalls will be logged to console. Use debug unbreak ${info.breakpointId} to stop tracing.`);
  return out.join('\n');
}

async function handleInject(dbg, cdp, sessionId, args) {
  await ensureEnabled(dbg, cdp, sessionId);
  const code = args[0];
  if (!code) throw new Error('Usage: debug inject <code>');

  await cdp.send('Page.enable', {}, sessionId);
  const result = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: code }, sessionId);
  return `Script injected. Identifier: ${result.identifier}\nIt will run before any page script on every load.\nTo remove: debug inject-remove ${result.identifier}`;
}

async function handleInjectRemove(dbg, cdp, sessionId, args) {
  await ensureEnabled(dbg, cdp, sessionId);
  const identifier = args[0];
  if (!identifier) throw new Error('Usage: debug inject-remove <identifier>');

  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }, sessionId);
  return `Injected script ${identifier} removed.`;
}

async function handleDebug({ cdp, sessionId, args, dbg }) {
  const subcmd = args[0];
  const subArgs = args.slice(1);

  switch (subcmd) {
    case 'scripts': return handleScripts(dbg, cdp, sessionId, subArgs);
    case 'source': return handleSource(dbg, cdp, sessionId, subArgs);
    case 'save': return handleSave(dbg, cdp, sessionId, subArgs);
    case 'search': return handleSearch(dbg, cdp, sessionId, subArgs);
    case 'break': return handleBreak(dbg, cdp, sessionId, subArgs);
    case 'breaktext': return handleBreakText(dbg, cdp, sessionId, subArgs);
    case 'breakxhr': return handleBreakXhr(dbg, cdp, sessionId, subArgs);
    case 'breaks': return handleBreaks(dbg, cdp, sessionId);
    case 'unbreak': return handleUnbreak(dbg, cdp, sessionId, subArgs);
    case 'unbreakxhr': return handleUnbreakXhr(dbg, cdp, sessionId, subArgs);
    case 'pause': return handlePause(dbg, cdp, sessionId);
    case 'resume': return handleResume(dbg, cdp, sessionId);
    case 'stepover': return handleStep(dbg, cdp, sessionId, 'over');
    case 'stepinto': return handleStep(dbg, cdp, sessionId, 'into');
    case 'stepout': return handleStep(dbg, cdp, sessionId, 'out');
    case 'status': return handleStatus(dbg, cdp, sessionId, subArgs);
    case 'vars': return handleVars(dbg, cdp, sessionId, subArgs);
    case 'eval': return handleEval(dbg, cdp, sessionId, subArgs);
    case 'trace': return handleTrace(dbg, cdp, sessionId, subArgs);
    case 'inject': return handleInject(dbg, cdp, sessionId, subArgs);
    case 'inject-remove': return handleInjectRemove(dbg, cdp, sessionId, subArgs);
    default:
      return [
        'Debug subcommands:',
        '  scripts [filter]              List loaded JS scripts',
        '  source <id|url> [options]     View script source (--startLine, --endLine, --offset, --length)',
        '  save <id|url> <file>          Save script source to file',
        '  search <query> [options]      Search in scripts (--regex, --case, --filter url)',
        '  break <url> <line> [col]      Set breakpoint (--cond expr)',
        '  breaktext <text> [options]    Set breakpoint on code text (--filter url, --nth N)',
        '  breakxhr <url-pattern>        Set XHR/Fetch breakpoint',
        '  breaks                        List all breakpoints',
        '  unbreak <id|all>              Remove breakpoint(s)',
        '  unbreakxhr <url-pattern>      Remove XHR breakpoint',
        '  pause                         Pause execution',
        '  resume                        Resume execution',
        '  stepover                      Step over',
        '  stepinto                      Step into',
        '  stepout                       Step out',
        '  status [options]              Show paused state (--frame N, --no-scopes)',
        '  vars [frame-idx]              Show scope variables',
        '  eval <expr> [frame-idx]       Evaluate in paused frame',
        '  trace <func> [options]        Trace function calls (--filter url, --pause)',
        '  inject <code>                 Inject script before page load',
        '  inject-remove <id>            Remove injected script',
      ].join('\n');
  }
}

registerCommand('debug', handleDebug);
