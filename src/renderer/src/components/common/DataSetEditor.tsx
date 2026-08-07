// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useRef } from 'react';
import type { DataSet } from '../../../../shared/types';

// ─── CSV helpers ──────────────────────────────────────────────────────────────

export function parseCSV(text: string): DataSet {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { columns: [], rows: [] };
  function splitRow(line: string): string[] {
    const cells: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { cells.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    cells.push(cur.trim());
    return cells;
  }
  const columns = splitRow(lines[0]);
  const rows    = lines.slice(1).map(splitRow);
  return { columns, rows };
}

export function toCSV(ds: DataSet): string {
  const escape = (s: string) => s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  return [ds.columns, ...ds.rows].map(row => row.map(escape).join(',')).join('\n');
}

// ─── Editor ──────────────────────────────────────────────────────────────────

interface Props {
  ds: DataSet
  onChange: (ds: DataSet) => void
  /** Base filename (without extension) used when exporting to CSV. */
  exportName: string
  /** Scope word shown in the intro line, e.g. "collection" or "folder". */
  scopeLabel?: string
}

/** Column/row table editor for a data-driven DataSet, with CSV import/export.
 *  Shared by the collection panel and the folder settings modal. */
export function DataSetEditor({ ds, onChange, exportName, scopeLabel = 'collection' }: Props) {
  const csvFileRef = useRef<HTMLInputElement>(null);

  // ── Column ops ──
  function addColumn() {
    const name = `var${ds.columns.length + 1}`;
    onChange({ columns: [...ds.columns, name], rows: ds.rows.map(r => [...r, '']) });
  }
  function renameColumn(ci: number, name: string) {
    onChange({ ...ds, columns: ds.columns.map((c, i) => i === ci ? name : c) });
  }
  function removeColumn(ci: number) {
    onChange({ columns: ds.columns.filter((_, i) => i !== ci), rows: ds.rows.map(r => r.filter((_, i) => i !== ci)) });
  }

  // ── Row ops ──
  function addRow() {
    onChange({ ...ds, rows: [...ds.rows, ds.columns.map(() => '')] });
  }
  function setCell(ri: number, ci: number, v: string) {
    onChange({ ...ds, rows: ds.rows.map((row, i) => i === ri ? row.map((c, j) => j === ci ? v : c) : row) });
  }
  function removeRow(ri: number) {
    onChange({ ...ds, rows: ds.rows.filter((_, i) => i !== ri) });
  }

  // ── CSV import / export ──
  function importCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => onChange(parseCSV(ev.target?.result as string));
    reader.readAsText(file);
    e.target.value = '';
  }
  function exportCSV() {
    const blob = new Blob([toCSV(ds)], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${exportName.replace(/\s+/g, '_')}_data.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasColumns = ds.columns.length > 0;
  const iterCount  = ds.rows.length;

  return (
    <div className="flex flex-col gap-3 text-xs">
      <p className="text-surface-600 text-[11px]">
        Define variables here - each row runs the entire {scopeLabel} once with those values injected.
        Columns become <code className="text-surface-500">{'{{variable}}'}</code> placeholders.
      </p>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={addColumn} className="px-2.5 py-1 bg-surface-700 hover:bg-surface-600 rounded transition-colors">+ Column</button>
        <button onClick={addRow} disabled={!hasColumns} className="px-2.5 py-1 bg-surface-700 hover:bg-surface-600 disabled:opacity-40 rounded transition-colors">+ Row</button>
        <div className="flex-1" />
        <button
          onClick={() => csvFileRef.current?.click()}
          className="px-2.5 py-1 bg-surface-700 hover:bg-surface-600 rounded transition-colors"
          title="Import CSV - first row is column headers"
        >↑ Import CSV</button>
        {hasColumns && iterCount > 0 && (
          <button onClick={exportCSV} className="px-2.5 py-1 bg-surface-700 hover:bg-surface-600 rounded transition-colors">↓ Export CSV</button>
        )}
        <input ref={csvFileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={importCSV} />
      </div>

      {/* Summary */}
      {hasColumns && (
        <p className="text-surface-500">
          {iterCount === 0
            ? 'No rows yet - add rows or import a CSV.'
            : `${iterCount} iteration${iterCount !== 1 ? 's' : ''} · columns: ${ds.columns.join(', ')}`}
        </p>
      )}

      {/* Table */}
      {hasColumns ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-surface-700">
                <th className="w-8 px-2 py-1 text-surface-600 font-normal text-left">#</th>
                {ds.columns.map((col, ci) => (
                  <th key={ci} className="px-1 py-1 font-normal text-left min-w-[120px]">
                    <div className="flex items-center gap-1">
                      <input
                        value={col}
                        onChange={e => renameColumn(ci, e.target.value)}
                        className="flex-1 bg-surface-800 border border-surface-700 rounded px-1.5 py-0.5 font-mono text-blue-400 focus:outline-none focus:border-blue-500"
                        title="Variable name"
                      />
                      <button onClick={() => removeColumn(ci)} className="text-surface-400 hover:text-red-400 transition-colors shrink-0">×</button>
                    </div>
                  </th>
                ))}
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {ds.rows.map((row, ri) => (
                <tr key={ri} className="group border-b border-surface-800/60 hover:bg-surface-800/30">
                  <td className="px-2 py-1 text-surface-600">{ri + 1}</td>
                  {ds.columns.map((_, ci) => (
                    <td key={ci} className="px-1 py-1">
                      <input
                        value={row[ci] ?? ''}
                        onChange={e => setCell(ri, ci, e.target.value)}
                        className="w-full bg-surface-800 border border-transparent rounded px-1.5 py-0.5 font-mono focus:outline-none focus:border-blue-500 hover:border-surface-600"
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1">
                    <button onClick={() => removeRow(ri)} className="text-surface-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">×</button>
                  </td>
                </tr>
              ))}
              {iterCount === 0 && (
                <tr>
                  <td colSpan={ds.columns.length + 2} className="px-2 py-3 text-surface-600 text-center">
                    No rows - click "+ Row" or import a CSV
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-surface-600">
          <p>No columns defined.</p>
          <p className="text-[10px]">
            Click <strong>+ Column</strong> to add a variable, or <strong>↑ Import CSV</strong> to load from a file.
          </p>
        </div>
      )}
    </div>
  );
}
