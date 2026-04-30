import { IS_WINDOWS, RUNTIME_DIR, MIN_TARGET_PREFIX_LEN, SENSITIVE_HEADERS, TEXT_MIME_TYPES } from './constants.mjs';
import { resolve } from 'path';

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function sockPath(targetId) {
  return IS_WINDOWS
    ? `\\\\.\\pipe\\cdp-${targetId}`
    : resolve(RUNTIME_DIR, `cdp-${targetId}.sock`);
}

export function resolvePrefix(prefix, candidates, noun = 'target', missingHint = '') {
  const upper = prefix.toUpperCase();
  const matches = candidates.filter(candidate => candidate.toUpperCase().startsWith(upper));
  if (matches.length === 0) {
    const hint = missingHint ? ` ${missingHint}` : '';
    throw new Error(`No ${noun} matching prefix "${prefix}".${hint}`);
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous prefix "${prefix}" — matches ${matches.length} ${noun}s. Use more characters.`);
  }
  return matches[0];
}

export function getDisplayPrefixLength(targetIds) {
  if (targetIds.length === 0) return MIN_TARGET_PREFIX_LEN;
  const maxLen = Math.max(...targetIds.map(id => id.length));
  for (let len = MIN_TARGET_PREFIX_LEN; len <= maxLen; len++) {
    const prefixes = new Set(targetIds.map(id => id.slice(0, len).toUpperCase()));
    if (prefixes.size === targetIds.length) return len;
  }
  return maxLen;
}

export function redactHeaders(headers, raw = false) {
  if (raw || !headers || typeof headers !== 'object') return headers;
  const redacted = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    redacted[key] = SENSITIVE_HEADERS.has(lowerKey) ? '[REDACTED]' : value;
  }
  return redacted;
}

export function isTextMimeType(mimeType) {
  if (!mimeType) return false;
  const lower = mimeType.toLowerCase();
  return TEXT_MIME_TYPES.some(t => lower.startsWith(t));
}
