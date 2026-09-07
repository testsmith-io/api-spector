// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Turning an array in a JSON/XML response into table data: find the array,
// address it by path, derive columns, and sort rows. Pure and dependency-free
// so it's unit-testable; the component handles parsing and rendering.

export type CellKind = 'null' | 'array' | 'object' | 'primitive';

/** Read a value at a dotted/indexed path, e.g. "data.items[0].tags". Empty
 *  path returns the root. */
export function getByPath(data: unknown, path: string): unknown {
  if (!path) return data;
  const tokens = path.match(/[^.[\]]+|\[\d+\]/g) ?? [];
  let cur: unknown = data;
  for (const tok of tokens) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = tok.startsWith('[')
      ? (cur as unknown[])[Number(tok.slice(1, -1))]
      : (cur as Record<string, unknown>)[tok];
  }
  return cur;
}

/** Append a row index (and optional key) to a path: joinPath("data.items", 2,
 *  "tags") -> "data.items[2].tags". Used for drilling into a nested cell. */
export function joinPath(base: string, index: number, key?: string): string {
  return `${base}[${index}]${key ? `.${key}` : ''}`;
}

const PREFERRED = /^(data|items|results|records|rows|list|content|entries|values|payload|elements)$/i;

/** Auto-pick the array most likely to be "the data": the root if it's an array,
 *  else the shallowest array under a data-ish key, preferring arrays of objects
 *  and larger arrays. Returns its path (for the starting-point input). */
export function findPrimaryArray(data: unknown): { path: string; array: unknown[] } | null {
  if (Array.isArray(data)) return { path: '', array: data };

  const found: { path: string; array: unknown[]; pref: number; objs: number; depth: number }[] = [];
  const queue: { node: unknown; path: string; depth: number }[] = [{ node: data, path: '', depth: 0 }];
  while (queue.length) {
    const { node, path, depth } = queue.shift()!;
    if (depth > 6 || node === null || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      const key = (path.split('.').pop() ?? '').replace(/\[\d+\]/g, '');
      const objs = node.filter(x => x && typeof x === 'object' && !Array.isArray(x)).length;
      found.push({ path, array: node, pref: PREFERRED.test(key) ? 1 : 0, objs, depth });
      // Do not descend into array elements: the primary array is near the top.
    } else {
      for (const [k, v] of Object.entries(node)) {
        queue.push({ node: v, path: path ? `${path}.${k}` : k, depth: depth + 1 });
      }
    }
  }
  if (!found.length) return null;

  found.sort((a, b) =>
    (b.pref - a.pref) ||
    (Math.sign(b.objs) - Math.sign(a.objs)) ||
    (b.array.length - a.array.length) ||
    (a.depth - b.depth),
  );
  return { path: found[0].path, array: found[0].array };
}

/** Column keys for a set of rows: the union of object keys in first-seen order.
 *  Empty means the rows are primitives/arrays (render a single value column). */
export function tableColumns(rows: unknown[], cap = 60): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      for (const k of Object.keys(row)) {
        if (!seen.has(k)) { seen.add(k); cols.push(k); if (cols.length >= cap) return cols; }
      }
    }
  }
  return cols;
}

export function classify(v: unknown): CellKind {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  return 'primitive';
}

/** Compact text for a cell: primitives as-is, arrays as "[n]", objects as
 *  truncated JSON. */
export function cellPreview(v: unknown): string {
  switch (classify(v)) {
    case 'null': return '';
    case 'array': return `[${(v as unknown[]).length}]`;
    case 'object': { const s = JSON.stringify(v); return s.length > 60 ? s.slice(0, 57) + '…' : s; }
    default: return String(v);
  }
}

/** Compare two cell values: numeric when both are numbers, else string
 *  compare; nulls sort last. */
export function compareValues(x: unknown, y: unknown): number {
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  const nx = Number(x), ny = Number(y);
  if (!Number.isNaN(nx) && !Number.isNaN(ny) && String(x).trim() !== '' && String(y).trim() !== '') return nx - ny;
  return String(x).localeCompare(String(y));
}

/** The value a column reads from a row ("$value" means the row itself). */
export function cellAt(row: unknown, col: string): unknown {
  return col === '$value' ? row : (row && typeof row === 'object' ? (row as Record<string, unknown>)[col] : undefined);
}

/** Row indices in sorted order, so a sorted view can still map a display row
 *  back to its original index (for drill-down paths). */
export function sortedIndices(rows: unknown[], col: string, dir: 'asc' | 'desc'): number[] {
  const idx = rows.map((_, i) => i);
  idx.sort((a, b) => compareValues(cellAt(rows[a], col), cellAt(rows[b], col)));
  return dir === 'desc' ? idx.reverse() : idx;
}

/** Sort rows by a column (or the whole row for a primitive column, key
 *  "$value"). Returns a new array. */
export function sortRows<T>(rows: T[], col: string, dir: 'asc' | 'desc'): T[] {
  return sortedIndices(rows as unknown[], col, dir).map(i => rows[i]);
}
