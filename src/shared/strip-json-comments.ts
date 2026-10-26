// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT
//
// JSONC support: locate // line comments and /* block */ comments in a JSON
// string, respecting string literals (a `//` or `/*` inside a "quoted string"
// such as a URL is not a comment) and backslash escapes. `jsonCommentRanges`
// returns the spans (used by the editor to colour them); `stripJsonComments`
// removes them so a commented body can be sent as valid JSON.

export interface JsonCommentRange {
  from: number;
  to: number;
  type: 'line' | 'block';
}

/** Find all comment spans in a JSONC string, in document order, non-overlapping. */
export function jsonCommentRanges(input: string): JsonCommentRange[] {
  const ranges: JsonCommentRange[] = [];
  const n = input.length;
  let i = 0;
  let inString = false;

  while (i < n) {
    const c = input[i];

    if (inString) {
      if (c === '\\') { i += 2; continue; } // skip the escaped character
      if (c === '"') inString = false;
      i++;
      continue;
    }

    if (c === '"') { inString = true; i++; continue; }

    const next = input[i + 1];

    if (c === '/' && next === '/') {
      const from = i;
      i += 2;
      while (i < n && input[i] !== '\n') i++; // up to (not including) the newline
      ranges.push({ from, to: i, type: 'line' });
      continue;
    }

    if (c === '/' && next === '*') {
      const from = i;
      i += 2;
      while (i < n && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i = Math.min(i + 2, n); // include the closing */
      ranges.push({ from, to: i, type: 'block' });
      continue;
    }

    i++;
  }

  return ranges;
}

/** Remove // and /* block *\/ comments, preserving newlines (so parse-error line
 *  numbers still line up) and everything inside string literals. */
export function stripJsonComments(input: string): string {
  const ranges = jsonCommentRanges(input);
  if (!ranges.length) return input;

  let out = '';
  let pos = 0;
  for (const r of ranges) {
    out += input.slice(pos, r.from);
    if (r.type === 'block') {
      // Keep any newlines that were inside the block comment.
      const seg = input.slice(r.from, r.to);
      for (let k = 0; k < seg.length; k++) if (seg[k] === '\n') out += '\n';
    }
    pos = r.to;
  }
  out += input.slice(pos);
  return out;
}
