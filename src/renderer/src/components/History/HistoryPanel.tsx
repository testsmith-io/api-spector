// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

import React, { useState } from 'react';
import { useStore } from '../../store';
import type { HistoryEntry } from '../../../../shared/types';
import { MethodBadge } from '../common/MethodBadge';

const STATUS_COLOR: Record<string, string> = {
  '2': 'text-emerald-400',
  '3': 'text-amber-400',
  '4': 'text-orange-400',
  '5': 'text-red-400',
};
function statusColor(status: number) {
  return STATUS_COLOR[String(status)[0]] ?? 'text-surface-400';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function HistoryPanel() {
  const history = useStore(s => s.history);
  const clearHistory = useStore(s => s.clearHistory);
  const activeTabId = useStore(s => s.activeTabId);
  const setTabResponse = useStore(s => s.setTabResponse);
  const [selected, setSelected] = useState<HistoryEntry | null>(null);
  const [search, setSearch] = useState('');

  const filtered = search
    ? history.filter(e =>
        e.request.name.toLowerCase().includes(search.toLowerCase()) ||
        e.resolvedUrl.toLowerCase().includes(search.toLowerCase()) ||
        e.request.method.toLowerCase().includes(search.toLowerCase())
      )
    : history;

  // Group by date label
  const groups: { label: string; entries: HistoryEntry[] }[] = [];
  for (const entry of filtered) {
    const label = formatDate(entry.timestamp);
    const last = groups.at(-1);
    if (last?.label === label) {
      last.entries.push(entry);
    } else {
      groups.push({ label, entries: [entry] });
    }
  }

  function open(entry: HistoryEntry) {
    setSelected(entry);
    if (activeTabId) {
      setTabResponse(activeTabId, entry.response, entry.scriptResult ?? null);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search + clear */}
      <div className="px-2 py-2 border-b border-surface-800 flex gap-1.5 flex-shrink-0">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter history…"
          className="flex-1 bg-surface-800 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {history.length > 0 && (
          <button
            onClick={() => { clearHistory(); setSelected(null); }}
            className="text-xs text-surface-400 hover:text-red-400 transition-colors px-1"
            title="Clear all history"
          >
            Clear
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-surface-400 px-4 text-center">
          No history yet. Send a request to start recording.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-xs text-surface-400">No matches.</p>
          )}
          {groups.map(group => (
            <div key={group.label}>
              <div className="px-3 py-1 text-[10px] font-semibold text-surface-400 uppercase tracking-wider bg-surface-950/50 sticky top-0">
                {group.label}
              </div>
              {group.entries.map(entry => (
                <HistoryRow
                  key={entry.id}
                  entry={entry}
                  isSelected={selected?.id === entry.id}
                  onSelect={() => open(entry)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryRow({
  entry, isSelected, onSelect,
}: {
  entry: HistoryEntry
  isSelected: boolean
  onSelect: () => void
}) {
  const status = entry.response.status;
  const hasError = !!entry.response.error;

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 border-b border-surface-800/50 transition-colors ${
        isSelected ? 'bg-surface-800' : 'hover:bg-surface-800/50'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <MethodBadge method={entry.request.method} size="xs" />
        <span className="flex-1 text-xs truncate text-white">{entry.request.name}</span>
        {hasError ? (
          <span className="text-red-400 text-[10px] font-medium shrink-0">ERR</span>
        ) : (
          <span className={`text-[10px] font-bold shrink-0 ${statusColor(status)}`}>{status}</span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-0.5 min-w-0">
        <span className="text-[10px] text-surface-400 truncate flex-1 font-mono">{entry.resolvedUrl}</span>
        <div className="flex items-center gap-1.5 shrink-0 text-[10px] text-surface-400">
          {!hasError && <span>{entry.response.durationMs}ms</span>}
          <span>{formatTime(entry.timestamp)}</span>
        </div>
      </div>
      {entry.environmentName && (
        <div className="text-[10px] text-surface-400 mt-0.5">env: {entry.environmentName}</div>
      )}
    </button>
  );
}
