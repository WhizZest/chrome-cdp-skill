import { registerCommand } from '../lib/command-registry.mjs';
import * as interceptCtx from '../lib/intercept-context.mjs';

function formatRuleList(ruleList, enabled) {
  const status = enabled ? 'ENABLED' : 'DISABLED';
  if (ruleList.length === 0) {
    return `Intercept: ${status}\nNo rules. Use "intercept modify-header|mock|block <pattern> ..." to add rules.`;
  }

  const lines = [`Intercept: ${status}\n`];
  lines.push(`Rules (${ruleList.length}):`);
  for (const r of ruleList) {
    let detail = '';
    switch (r.action) {
      case 'modify-header':
        detail = `${r.config.headerName}: ${r.config.headerValue}`;
        break;
      case 'mock':
        detail = `${r.config.status || 200} ${r.config.body ? r.config.body.substring(0, 50) : ''}`;
        break;
      case 'block':
        detail = '\u2014';
        break;
    }
    lines.push(`  ${r.ruleId}  ${r.action.padEnd(13)} ${r.pattern.padEnd(20)} ${detail}  hits: ${r.hitCount}`);
  }
  lines.push('\nUse "intercept remove <id>" to remove a rule.');
  return lines.join('\n');
}

function formatStats(stats) {
  const lines = ['Intercept Statistics:'];
  lines.push(`  Status: ${stats.enabled ? 'ENABLED' : 'DISABLED'}`);
  lines.push(`  Total rules: ${stats.totalRules}`);
  lines.push(`  Total hits: ${stats.totalHits}`);
  lines.push(`  Passed through (no match): ${stats.passThroughCount}`);
  if (stats.rules.length > 0) {
    lines.push('  Rules:');
    for (const r of stats.rules) {
      lines.push(`    ${r.ruleId}: ${r.hitCount} hits (${r.action} ${r.pattern})`);
    }
  }
  return lines.join('\n');
}

async function handleIntercept({ cdp, sessionId, args }) {
  const sub = args[0];

  if (sub === 'on') {
    const stages = [];
    if (args.includes('--request') || (!args.includes('--response') && !args.includes('--request'))) {
      stages.push('Request');
    }
    if (args.includes('--response')) {
      stages.push('Response');
    }
    await interceptCtx.enable(cdp, sessionId, stages);
    return `Intercept enabled (stage: ${stages.join(', ')}). Existing rules will be applied.`;
  }

  if (sub === 'off') {
    await interceptCtx.disable(cdp, sessionId);
    return 'Intercept disabled. Requests will pass through normally.';
  }

  if (sub === 'modify-header') {
    const pattern = args[1];
    const headerName = args[2];
    const headerValue = args[3];
    if (!pattern || !headerName || headerValue === undefined) {
      throw new Error('Usage: intercept modify-header <pattern> <header> <value>');
    }
    const rule = interceptCtx.addRule(pattern, 'modify-header', 'Request', { headerName, headerValue });
    return `Rule ${rule.ruleId}: modify header "${headerName}" for URLs matching "${pattern}"`;
  }

  if (sub === 'mock') {
    const pattern = args[1];
    const status = args[2] ? parseInt(args[2]) : 200;
    const body = args.slice(3).join(' ') || '';
    if (!pattern) {
      throw new Error('Usage: intercept mock <pattern> <status> <body>');
    }
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    const rule = interceptCtx.addRule(pattern, 'mock', 'Request', { status, body, headers });
    return `Rule ${rule.ruleId}: mock response ${status} for URLs matching "${pattern}"`;
  }

  if (sub === 'block') {
    const pattern = args[1];
    if (!pattern) {
      throw new Error('Usage: intercept block <pattern>');
    }
    const rule = interceptCtx.addRule(pattern, 'block', 'Request');
    return `Rule ${rule.ruleId}: block URLs matching "${pattern}"`;
  }

  if (sub === 'list') {
    return formatRuleList(interceptCtx.getRules(), interceptCtx.isEnabled());
  }

  if (sub === 'remove') {
    const ruleId = args[1];
    if (!ruleId) {
      throw new Error('Usage: intercept remove <rule-id>');
    }
    const removed = interceptCtx.removeRule(ruleId);
    if (!removed) throw new Error(`Rule ${ruleId} not found`);
    return `Rule ${ruleId} removed.`;
  }

  if (sub === 'stats') {
    return formatStats(interceptCtx.getStats());
  }

  throw new Error(`Unknown intercept subcommand: ${sub}. Use on/off/modify-header/mock/block/list/remove/stats.`);
}

registerCommand('intercept', handleIntercept);

export { handleIntercept, formatRuleList, formatStats };
