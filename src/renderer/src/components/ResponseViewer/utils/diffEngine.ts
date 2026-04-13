// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

export type DiffLineType = 'equal' | 'removed' | 'added'
export interface DiffLine { type: DiffLineType; text: string }

/**
 * Compute a line-by-line diff using the LCS algorithm. O(n*m) — fine for
 * response bodies up to a few thousand lines.
 *
 *   - 'equal'   line appears in both `a` and `b`
 *   - 'removed' line is in `a` but not `b` (would render with a "-" gutter)
 *   - 'added'   line is in `b` but not `a` (would render with a "+" gutter)
 */
export function computeLineDiff(a: string, b: string): DiffLine[] {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const m = aLines.length;
  const n = bLines.length;

  // dp[i][j] = length of LCS for aLines[0..i-1] and bLines[0..j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = aLines[i - 1] === bLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to produce the diff in source order
  const result: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aLines[i - 1] === bLines[j - 1]) {
      result.unshift({ type: 'equal', text: aLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', text: bLines[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'removed', text: aLines[i - 1] });
      i--;
    }
  }
  return result;
}
