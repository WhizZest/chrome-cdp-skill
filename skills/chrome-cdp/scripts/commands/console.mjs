import { registerCommand } from '../lib/command-registry.mjs';
import * as consoleCtx from '../lib/console-context.mjs';

function formatMessageList(result) {
  const { messages, total, page, size, totalPages, navigationSeparators } = result;
  if (total === 0) return 'No console messages.';

  const start = (page - 1) * size + 1;
  const end = Math.min(page * size, total);

  const lines = [`Console messages (${total} total, showing ${start}-${end}):`];

  if (navigationSeparators && navigationSeparators.length > 0) {
    for (const sep of navigationSeparators) {
      const timeStr = sep.timestamp ? ` (${new Date(sep.timestamp).toLocaleTimeString()})` : ' (current)';
      lines.push(`--- Navigation: ${sep.url || '(unknown)'}${timeStr} ---`);
    }
    lines.push('');
  }

  for (const msg of messages) {
    const type = msg.type.padEnd(7);
    const text = msg.text.length > 80 ? msg.text.substring(0, 77) + '...' : msg.text;
    const source = msg.url
      ? `  ${msg.url.split('/').pop()}:${msg.lineNumber >= 0 ? msg.lineNumber + 1 : '?'}`
      : '';
    lines.push(`  [${msg.id}]  ${type} ${text}${source}`);
  }

  if (totalPages > 1) {
    lines.push(`Page ${page}/${totalPages}. Use --page <n> for more.`);
  }
  lines.push('Use "console <id>" for details, "console clear" to clear.');
  return lines.join('\n');
}

function formatMessageDetail(msg) {
  if (!msg) return 'Message not found.';

  const lines = [`Message #${msg.id} (${msg.type})`];
  lines.push(`  Text: ${msg.text}`);
  if (msg.url) {
    lines.push(`  Source: ${msg.url}:${msg.lineNumber >= 0 ? msg.lineNumber + 1 : '?'}`);
  }

  if (msg.args && msg.args.length > 0) {
    lines.push('  Args:');
    for (let i = 0; i < msg.args.length; i++) {
      const arg = msg.args[i];
      const type = arg.type + (arg.subtype ? `:${arg.subtype}` : '');
      let val;
      if (arg.value !== undefined) {
        val = typeof arg.value === 'string'
          ? `"${arg.value.length > 100 ? arg.value.substring(0, 100) + '...' : arg.value}"`
          : JSON.stringify(arg.value);
      } else if (arg.description) {
        val = arg.description.length > 200 ? arg.description.substring(0, 200) + '...' : arg.description;
      } else {
        val = `[${type}]`;
      }
      lines.push(`    ${i}: ${type} = ${val}`);
    }
  }

  return lines.join('\n');
}

async function handleConsole({ cdp, sessionId, args }) {
  await consoleCtx.enable(cdp, sessionId);

  const filter = args[0];

  if (filter === 'clear') {
    const count = consoleCtx.clear();
    return `Cleared ${count} console messages`;
  }

  if (filter && /^\d+$/.test(filter)) {
    const msg = consoleCtx.getMessageById(parseInt(filter));
    return formatMessageDetail(msg);
  }

  const pageIdx = args.indexOf('--page');
  const sizeIdx = args.indexOf('--size');
  const preserve = args.includes('--preserve');
  const page = pageIdx >= 0 ? parseInt(args[pageIdx + 1]) || 1 : 1;
  const size = sizeIdx >= 0 ? parseInt(args[sizeIdx + 1]) || 20 : 20;

  const typeFilter = (filter && !filter.startsWith('--')) ? filter : null;
  const result = consoleCtx.getMessages(typeFilter, page, size, preserve);
  return formatMessageList(result);
}

registerCommand('console', handleConsole);

export { handleConsole, formatMessageList, formatMessageDetail };
