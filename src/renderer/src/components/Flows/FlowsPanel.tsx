// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Sidebar list of flows. Selecting a flow sets activeFlowId, which the main
// area watches to render the FlowCanvas. New / rename / delete mirror the
// collection list conventions; persistence rides the workspace autosave.

import { useState } from 'react';
import { useStore } from '../../store';
import { EmptyState } from '../common/EmptyState';
import { useT } from '../../i18n';

export function FlowsPanel() {
  const t = useT();
  const flows        = useStore(s => s.flows);
  const activeFlowId = useStore(s => s.activeFlowId);
  const setActiveFlow = useStore(s => s.setActiveFlow);
  const renameFlow   = useStore(s => s.renameFlow);
  const deleteFlow   = useStore(s => s.deleteFlow);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const list = Object.values(flows).sort((a, b) => a.data.name.localeCompare(b.data.name));

  function commitRename(id: string) {
    const name = draft.trim();
    if (name) renameFlow(id, name);
    setEditingId(null);
  }

  if (list.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto">
        <EmptyState message={t('No flows yet. Press + to create one.')} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto py-1">
      {list.map(({ data }) => {
        const isActive = data.id === activeFlowId;
        const stepCount = data.nodes.filter(n => n.type !== 'start' && n.type !== 'end').length;
        return (
          <div
            key={data.id}
            className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
              isActive ? 'bg-surface-800 text-[var(--text-primary)]' : 'text-surface-400 hover:bg-surface-800/40'
            }`}
            onClick={() => setActiveFlow(data.id)}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" className="shrink-0 opacity-70">
              <path d="M4 4a2 2 0 100 4 2 2 0 000-4zM4 12a2 2 0 100 4 2 2 0 000-4zM16 6a2 2 0 100-4 2 2 0 000 4zM9 6h3.5a1.5 1.5 0 011.5 1.5V9a3 3 0 01-3 3H8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            {editingId === data.id ? (
              <input
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onClick={e => e.stopPropagation()}
                onBlur={() => commitRename(data.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename(data.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="flex-1 min-w-0 bg-surface-900 border border-surface-700 rounded px-1 py-0.5 text-xs focus:outline-none focus:border-blue-500"
              />
            ) : (
              <span
                className="flex-1 min-w-0 truncate text-xs"
                onDoubleClick={e => { e.stopPropagation(); setEditingId(data.id); setDraft(data.name); }}
                title={data.name}
              >
                {data.name}
              </span>
            )}
            {editingId !== data.id && (
              <>
                <span className="text-[10px] text-surface-600 tabular-nums shrink-0">{stepCount}</span>
                <button
                  onClick={e => { e.stopPropagation(); if (confirm(t('Delete flow ":name"?', { name: data.name }))) deleteFlow(data.id); }}
                  title={t('Delete flow')}
                  className="opacity-0 group-hover:opacity-100 text-surface-600 hover:text-red-400 transition-all text-sm leading-none shrink-0"
                >
                  ×
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
