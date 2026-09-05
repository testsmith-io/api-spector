// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useState } from 'react';
import { useStore } from '../../store';
import type { DataSet } from '../../../../shared/types';
import { DataSetEditor } from '../common/DataSetEditor';

// ─── Component ───────────────────────────────────────────────────────────────

export function CollectionPanel() {
  const activeCollectionId        = useStore(s => s.activeCollectionId);
  const collections               = useStore(s => s.collections);
  const updateCollectionDataSet   = useStore(s => s.updateCollectionDataSet);
  const openRunner                = useStore(s => s.openRunner);
  const setCoverageOpen           = useStore(s => s.setCoverageOpen);
  const setCompareOpen            = useStore(s => s.setCompareOpen);

  const [activeTab, setActiveTab] = useState<'data' | 'variables'>('data');

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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCoverageOpen(true)}
            title="Measure how much of an OpenAPI spec this workspace tests"
            className="px-3 py-1.5 text-xs border border-surface-700 text-surface-300 hover:text-white hover:border-surface-500 rounded font-medium transition-colors"
          >
            Coverage
          </button>
          <button
            onClick={() => setCompareOpen(true)}
            title="Diff two OpenAPI versions: breaking changes and which tests they affect"
            className="px-3 py-1.5 text-xs border border-surface-700 text-surface-300 hover:text-white hover:border-surface-500 rounded font-medium transition-colors"
          >
            Compare
          </button>
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
          <DataSetEditor ds={ds} onChange={setDs} exportName={col.name} scopeLabel="collection" />
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
