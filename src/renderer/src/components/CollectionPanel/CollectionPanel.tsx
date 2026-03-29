// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useRef, useState } from 'react';
import { useStore } from '../../store';
import type { DataSet } from '../../../../shared/types';

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function parseCSV(text: string): DataSet {
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

function toCSV(ds: DataSet): string {
  const escape = (s: string) => s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  return [ds.columns, ...ds.rows].map(row => row.map(escape).join(',')).join('\n');
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CollectionPanel() {
  const activeCollectionId        = useStore(s => s.activeCollectionId);
  const collections               = useStore(s => s.collections);
  const updateCollectionDataSet   = useStore(s => s.updateCollectionDataSet);
  const openRunner                = useStore(s => s.openRunner);

  const [activeTab, setActiveTab] = useState<'data' | 'variables'>('data');
  const csvFileRef = useRef<HTMLInputElement>(null);

  if (!activeCollectionId) {
    return (
      <div className="flex items-center justify-center h-full text-surface-400 text-sm">
        Select a request from the sidebar
      </div>
    );
  }

  const col = collections[activeCollectionId]?.data;
  if (!col) return null;

  const ds: DataSet = col.dataSet ?? { columns: [], rows: [] };

  function setDs(next: DataSet) {
    updateCollectionDataSet(activeCollectionId!, next);
  }

  // ── Column ops ──────────────────────────────────────────────────────────────
  function addColumn() {
    const name = `var${ds.columns.length + 1}`;
    setDs({ columns: [...ds.columns, name], rows: ds.rows.map(r => [...r, '']) });
  }
  function renameColumn(ci: number, name: string) {
    setDs({ ...ds, columns: ds.columns.map((c, i) => i === ci ? name : c) });
  }
  function removeColumn(ci: number) {
    setDs({ columns: ds.columns.filter((_, i) => i !== ci), rows: ds.rows.map(r => r.filter((_, i) => i !== ci)) });
  }

  // ── Row ops ─────────────────────────────────────────────────────────────────
  function addRow() {
    setDs({ ...ds, rows: [...ds.rows, ds.columns.map(() => '')] });
  }
  function setCell(ri: number, ci: number, v: string) {
    setDs({ ...ds, rows: ds.rows.map((row, i) => i === ri ? row.map((c, j) => j === ci ? v : c) : row) });
  }
  function removeRow(ri: number) {
    setDs({ ...ds, rows: ds.rows.filter((_, i) => i !== ri) });
  }

  // ── CSV import / export ─────────────────────────────────────────────────────
  function importCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setDs(parseCSV(ev.target?.result as string));
    reader.readAsText(file);
    e.target.value = '';
  }
  function exportCSV() {
    const blob = new Blob([toCSV(ds)], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${col.name.replace(/\s+/g, '_')}_data.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasColumns = ds.columns.length > 0;
  const iterCount  = ds.rows.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-surface-800 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold">{col.name}</h1>
          <p className="text-[10px] text-surface-400 mt-0.5">
            {Object.keys(col.requests).length} requests
            {iterCount > 0 ? ` · ${iterCount} data row${iterCount !== 1 ? 's' : ''}` : ''}
          </p>
        </div>
        <button
          onClick={() => openRunner(activeCollectionId)}
          className="px-3 py-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 rounded font-medium transition-colors flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"/>
          </svg>
          Run collection
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-surface-800 px-6 flex-shrink-0">
        {([
          { id: 'data',      label: 'Data',      badge: iterCount > 0 ? iterCount : 0 },
          { id: 'variables', label: 'Variables',  badge: Object.keys(col.collectionVariables ?? {}).length },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-blue-500 text-white'
                : 'border-transparent text-surface-400 hover:text-white'
            }`}
          >
            {tab.label}
            {tab.badge > 0 && (
              <span className="ml-1 text-[10px] bg-surface-600 text-white rounded px-1 font-medium">{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {activeTab === 'data' && (
          <div className="flex flex-col gap-3 text-xs">
            <p className="text-surface-600 text-[11px]">
              Define variables here — each row runs the entire collection once with those values injected.
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
                title="Import CSV — first row is column headers"
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
                  ? 'No rows yet — add rows or import a CSV.'
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
                          No rows — click "+ Row" or import a CSV
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
        )}

        {activeTab === 'variables' && (
          <div className="flex flex-col gap-2 text-xs text-surface-600">
            {Object.keys(col.collectionVariables ?? {}).length === 0 ? (
              <p>No collection variables. Scripts can set them via <code className="text-surface-500">sp.collectionVariables.set(…)</code>.</p>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-surface-700 text-surface-500">
                    <th className="px-2 py-1 text-left font-medium">Key</th>
                    <th className="px-2 py-1 text-left font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(col.collectionVariables ?? {}).map(([k, v]) => (
                    <tr key={k} className="border-b border-surface-800/60">
                      <td className="px-2 py-1 font-mono text-blue-400">{k}</td>
                      <td className="px-2 py-1 font-mono text-surface-300">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
