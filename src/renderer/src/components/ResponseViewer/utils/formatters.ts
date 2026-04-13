// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

/** Pretty-print a JSON string. Returns the input unchanged if it's not valid JSON. */
export function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/**
 * Naive XML pretty-printer based on tag tokenization. Indents opening tags,
 * de-indents closing tags. Self-closing and processing-instruction tags are
 * emitted on their own line at the current depth. Returns the input unchanged
 * on any tokenization error.
 */
export function prettyXml(raw: string): string {
  try {
    const indent = '  ';
    let result = '';
    let depth = 0;
    const tokens = raw.match(/<[^>]+>|[^<]+/g) ?? [];
    for (const token of tokens) {
      const text = token.trim();
      if (!text) continue;
      if (text.startsWith('<?') || text.startsWith('<!')) {
        result += indent.repeat(depth) + text + '\n';
      } else if (token.startsWith('</')) {
        depth = Math.max(0, depth - 1);
        result += indent.repeat(depth) + text + '\n';
      } else if (token.startsWith('<') && !token.endsWith('/>') && !token.includes('</')) {
        result += indent.repeat(depth) + text + '\n';
        depth++;
      } else {
        result += indent.repeat(depth) + text + '\n';
      }
    }
    return result.trimEnd();
  } catch {
    return raw;
  }
}
