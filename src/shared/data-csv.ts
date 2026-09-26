// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { DataSet } from './types';

// CSV serialization for data tables. Pure (no fs), so it is safe to import from
// the renderer, main, and CLI. Data tables are externalized to `data/*.csv`
// files on save (see main/data-files.ts) so they are git-diffable and editable.

export function toCSV(ds: DataSet): string {
  const escape = (s: string) => (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
  return [ds.columns, ...ds.rows].map(row => row.map(escape).join(',')).join('\n');
}

export function parseCSV(text: string): DataSet {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { columns: [], rows: [] };
  function splitRow(line: string): string[] {
    const cells: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) { cells.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    cells.push(cur.trim());
    return cells;
  }
  const columns = splitRow(lines[0]);
  const rows    = lines.slice(1).map(splitRow);
  return { columns, rows };
}
