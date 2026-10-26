// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useState, useEffect } from 'react';
import { useStore } from '../../store';
import type { DataSet, KeyValuePair } from '../../../../shared/types';
import { DataSetEditor } from '../common/DataSetEditor';
import { DocsEditor } from '../common/DocsEditor';
import { KVTable } from '../RequestBuilder/KVTable';
import { useAiAvailable, generateDocs, collectionDocsContext } from '../../lib/ai';
import { useT } from '../../i18n';

// ─── Component ───────────────────────────────────────────────────────────────

export function CollectionPanel() {
  const t = useT();
  const activeCollectionId        = useStore(s => s.activeCollectionId);
  const collections               = useStore(s => s.collections);
  const updateCollectionDataSet   = useStore(s => s.updateCollectionDataSet);
  const updateCollectionDescription = useStore(s => s.updateCollectionDescription);
  const updateCollectionVariables = useStore(s => s.updateCollectionVariables);
  const openRunner                = useStore(s => s.openRunner);
  const setCoverageOpen           = useStore(s => s.setCoverageOpen);
  const setCompareOpen            = useStore(s => s.setCompareOpen);
  const aiAvailable               = useAiAvailable();

  const [activeTab, setActiveTab] = useState<'documentation' | 'data' | 'variables'>('documentation');

  // Local draft rows for the variables editor. Kept in component state (not
  // derived each render) so a freshly-added blank row survives until it gets a
  // key — a Record<string,string> can't hold an empty key, so storing filters
  // blanks out. Reseeded when the active collection changes.
  const [varRows, setVarRows] = useState<KeyValuePair[]>([]);
  useEffect(() => {
    const data = activeCollectionId ? collections[activeCollectionId]?.data : undefined;
    setVarRows([
      ...Object.entries(data?.collectionVariables ?? {}).map(([key, value]) => ({ key, value, enabled: true })),
      ...Object.entries(data?.collectionVariablesDisabled ?? {}).map(([key, value]) => ({ key, value, enabled: false })),
    ]);
  // Reseed only on collection switch, not on every keystroke-driven store update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCollectionId]);

  function setVars(rows: KeyValuePair[]) {
    setVarRows(rows);
    if (!activeCollectionId) return;
    // Enabled rows apply; disabled rows are kept (not deleted) so a toggle persists.
    const variables = Object.fromEntries(rows.filter(r => r.enabled && r.key.trim()).map(r => [r.key.trim(), r.value]));
    const disabled = Object.fromEntries(rows.filter(r => !r.enabled && r.key.trim()).map(r => [r.key.trim(), r.value]));
    updateCollectionVariables(activeCollectionId, variables, disabled);
  }

  if (!activeCollectionId) {
    return (
      <div className="flex items-center justify-center h-full text-surface-400 text-sm">
        {t('Select a request from the sidebar')}
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
            {t(':count requests', { count: Object.keys(col.requests).length })}
            {iterCount > 0 ? ` · ${t(':count data row|:count data rows', { count: iterCount })}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCoverageOpen(true)}
            title={t('Measure how much of an OpenAPI spec this workspace tests')}
            className="px-3 py-1.5 text-xs border border-surface-700 text-surface-300 hover:text-white hover:border-surface-500 rounded font-medium transition-colors"
          >
            {t('Coverage')}
          </button>
          <button
            onClick={() => setCompareOpen(true)}
            title={t('Diff two OpenAPI versions: breaking changes and which tests they affect')}
            className="px-3 py-1.5 text-xs border border-surface-700 text-surface-300 hover:text-white hover:border-surface-500 rounded font-medium transition-colors"
          >
            {t('Compare')}
          </button>
          <button
            onClick={() => openRunner(activeCollectionId)}
            className="px-3 py-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 rounded font-medium transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"/>
            </svg>
            {t('Run collection')}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-surface-800 px-6 flex-shrink-0">
        {([
          { id: 'documentation', label: 'Documentation', badge: col.description?.trim() ? 1 : 0 },
          { id: 'data',          label: 'Data',          badge: Math.max(iterCount, 0) },
          { id: 'variables',     label: 'Variables',     badge: varRows.filter(r => r.key.trim()).length },
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
            {t(tab.label)}
            {tab.badge > 0 && (
              <span className="ml-1 text-[10px] bg-surface-600 text-white rounded px-1 font-medium">{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {activeTab === 'documentation' && (
          <DocsEditor
            value={col.description ?? ''}
            onChange={v => updateCollectionDescription(activeCollectionId!, v)}
            aiAvailable={aiAvailable}
            onGenerate={() => generateDocs({ level: 'collection', name: col.name, existing: col.description, context: collectionDocsContext(col) })}
          />
        )}

        {activeTab === 'data' && (
          <DataSetEditor ds={ds} onChange={setDs} exportName={col.name} scopeLabel="collection" />
        )}

        {activeTab === 'variables' && (
          <div className="flex flex-col gap-2 text-xs">
            <p className="text-surface-500">
              {t('Variables scoped to this collection. They override environment and global variables, and are overridden by folder and request variables (and runtime / CLI / data-row values). Reference them anywhere with :token.', { token: '{{name}}' })}
            </p>
            <KVTable rows={varRows} onChange={setVars} keyPlaceholder={t('name')} valuePlaceholder={t('value')} />
            <p className="text-surface-600 text-[11px]">
              {t('Scripts can also set these at runtime via')} <code className="text-surface-500">sp.collectionVariables.set(…)</code>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
