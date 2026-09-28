// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useState } from 'react';
import { useStore } from '../../store';
import type { DataSet, KeyValuePair } from '../../../../shared/types';
import { findFolder } from '../../../../shared/folder-tree';
import { DataSetEditor } from '../common/DataSetEditor';
import { DocsEditor } from '../common/DocsEditor';
import { KVTable } from '../RequestBuilder/KVTable';
import { useAiAvailable, generateDocs, folderDocsContext } from '../../lib/ai';
import { useT } from '../../i18n';

// The folder counterpart of CollectionPanel: opened when a folder is clicked in
// the tree, it shows the folder's Documentation, Data table, and Variables in
// the main pane (config like auth/headers still lives in the Settings modal).

export function FolderPanel() {
  const t = useT();
  const folderPanel   = useStore(s => s.folderPanel);
  const collections   = useStore(s => s.collections);
  const updateFolder  = useStore(s => s.updateFolder);
  const openRunner    = useStore(s => s.openRunner);
  const aiAvailable   = useAiAvailable();

  const [activeTab, setActiveTab] = useState<'documentation' | 'data' | 'variables'>('documentation');

  if (!folderPanel) return null;
  const col = collections[folderPanel.collectionId]?.data;
  const folder = col ? findFolder(col.rootFolder, folderPanel.folderId) : null;
  if (!col || !folder) return null;

  const cid = folderPanel.collectionId;
  const ds: DataSet = folder.dataSet ?? { columns: [], rows: [] };
  const varRows: KeyValuePair[] = Object.entries(folder.variables ?? {}).map(([key, value]) => ({ key, value, enabled: true }));
  const iterCount = ds.rows.length;

  function setVars(rows: KeyValuePair[]) {
    const variables = Object.fromEntries(rows.filter(r => r.key.trim()).map(r => [r.key.trim(), r.value]));
    updateFolder(cid, folder!.id, { variables });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-surface-800 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold">{folder.name}</h1>
          <p className="text-[10px] text-surface-400 mt-0.5">
            {t(':count requests', { count: folder.requestIds.length })}
            {iterCount > 0 ? ` · ${t(':count data row|:count data rows', { count: iterCount })}` : ''}
          </p>
        </div>
        <button
          onClick={() => openRunner(cid, folder.id)}
          className="px-3 py-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 rounded font-medium transition-colors flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"/>
          </svg>
          {t('Run folder')}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-surface-800 px-6 flex-shrink-0">
        {([
          { id: 'documentation', label: 'Documentation', badge: folder.description?.trim() ? 1 : 0 },
          { id: 'data',          label: 'Data',          badge: Math.max(iterCount, 0) },
          { id: 'variables',     label: 'Variables',     badge: varRows.length },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px ${
              activeTab === tab.id ? 'border-blue-500 text-white' : 'border-transparent text-surface-400 hover:text-white'
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
            value={folder.description ?? ''}
            onChange={v => updateFolder(cid, folder.id, { description: v })}
            aiAvailable={aiAvailable}
            onGenerate={() => generateDocs({ level: 'folder', name: folder.name, existing: folder.description, context: folderDocsContext(folder, col.requests) })}
          />
        )}

        {activeTab === 'data' && (
          <DataSetEditor ds={ds} onChange={next => updateFolder(cid, folder.id, { dataSet: next })} exportName={folder.name} scopeLabel="folder" />
        )}

        {activeTab === 'variables' && (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-surface-500 leading-relaxed">
              {t('Variables scoped to this folder. They override collection variables and are overridden by an inner folder, the active environment, and script-set values. Reference them anywhere with :token.', { token: '{{name}}' })}
            </p>
            <KVTable rows={varRows} onChange={setVars} keyPlaceholder={t('name')} valuePlaceholder={t('value')} />
          </div>
        )}
      </div>
    </div>
  );
}
