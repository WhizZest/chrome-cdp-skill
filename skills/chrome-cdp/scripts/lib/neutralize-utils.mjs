// NOTE: maskStringsAndComments does not handle regex literals (/.../).
// A "debugger" inside a regex like /debugger/ would be falsely matched,
// but this is extremely rare in practice and not worth the complexity.

function maskStringsAndComments(source) {
  const len = source.length;
  const out = new Array(len);
  let i = 0;

  while (i < len) {
    const ch = source[i];

    if (ch === '/' && source[i + 1] === '/') {
      while (i < len && source[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }

    if (ch === '/' && source[i + 1] === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2;
      while (i < len - 1 && !(source[i] === '*' && source[i + 1] === '/')) {
        out[i] = source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < len) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      out[i] = ' '; i++;
      while (i < len && source[i] !== quote) {
        if (source[i] === '\\') { out[i] = ' '; i++; }
        out[i] = source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < len) { out[i] = ' '; i++; }
      continue;
    }

    if (ch === '`') {
      out[i] = ' '; i++;
      while (i < len && source[i] !== '`') {
        if (source[i] === '\\') { out[i] = ' '; i++; if (i < len) { out[i] = ' '; i++; } continue; }
        if (source[i] === '$' && source[i + 1] === '{') {
          out[i] = ' '; out[i + 1] = ' '; i += 2;
          let depth = 1;
          while (i < len && depth > 0) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') depth--;
            if (depth > 0) { out[i] = source[i]; i++; }
          }
          continue;
        }
        out[i] = source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < len) { out[i] = ' '; i++; }
      continue;
    }

    out[i] = ch;
    i++;
  }

  return out.join('');
}

function findDebuggerStatements(source) {
  const masked = maskStringsAndComments(source);
  const locations = [];
  const regex = /\bdebugger\b/g;
  let match;

  while ((match = regex.exec(masked)) !== null) {
    const before = source.substring(0, match.index);
    const line = (before.match(/\n/g) || []).length;
    const lastNL = before.lastIndexOf('\n');
    const column = match.index - lastNL - 1;
    locations.push({ line, column });
  }

  return locations;
}

function replaceDebuggerStatements(source) {
  const masked = maskStringsAndComments(source);
  const regex = /\bdebugger\b/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(masked)) !== null) {
    parts.push(source.substring(lastIndex, match.index));
    parts.push('void 0');
    lastIndex = match.index + 8;
  }
  parts.push(source.substring(lastIndex));

  return parts.join('');
}

function containsDebugger(source) {
  return source.indexOf('debugger') !== -1;
}

export {
  findDebuggerStatements,
  replaceDebuggerStatements,
  containsDebugger,
};
