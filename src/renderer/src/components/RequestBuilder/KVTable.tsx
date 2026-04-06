// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useState } from 'react';
import type { KeyValuePair } from '../../../../shared/types';
import { VarInput } from '../common/VarInput';
import { HEADER_NAMES, getValueSuggestions } from './header-suggestions';

interface Props {
  rows: KeyValuePair[]
  onChange: (rows: KeyValuePair[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
  /** When true, provides autocomplete for HTTP header names and common values. */
  headerMode?: boolean
}

export function KVTable({ rows, onChange, keyPlaceholder = 'Key', valuePlaceholder = 'Value', headerMode }: Props) {
  // Track which rows have their description input visible.
  // Initialise with indices of rows that already have a description.
  const [descVisible, setDescVisible] = useState<Set<number>>(
    () => new Set(rows.map((r, i) => (r.description ? i : -1)).filter(i => i >= 0)),
  );

  function update(idx: number, patch: Partial<KeyValuePair>) {
    const next = [...rows];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  }

  function add() {
    onChange([...rows, { key: '', value: '', enabled: true }]);
  }

  function remove(idx: number) {
    onChange(rows.filter((_, i) => i !== idx));
    setDescVisible(prev => {
      const next = new Set<number>();
      prev.forEach(i => { if (i < idx) next.add(i); else if (i > idx) next.add(i - 1); });
      return next;
    });
  }

  function toggleDesc(idx: number) {
    setDescVisible(prev => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
        // Clear the stored description when hiding
        update(idx, { description: '' });
      } else {
        next.add(idx);
      }
      return next;
    });
  }

  return (
    <div className="text-xs">
      {rows.map((row, idx) => (
        <div key={idx} className="mb-1">
          <div className="flex items-center gap-1.5 group">
            <input
              type="checkbox"
              checked={row.enabled}
              onChange={e => update(idx, { enabled: e.target.checked })}
              className="accent-blue-500 flex-shrink-0"
            />
            <VarInput
              value={row.key}
              onChange={v => update(idx, { key: v })}
              placeholder={keyPlaceholder}
              wrapperClassName="flex-1"
              className="bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
              staticSuggestions={headerMode ? HEADER_NAMES : undefined}
            />
            <VarInput
              value={row.value}
              onChange={v => update(idx, { value: v })}
              placeholder={valuePlaceholder}
              wrapperClassName="flex-1"
              className="bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
              staticSuggestions={headerMode ? (getValueSuggestions(row.key) ?? undefined) : undefined}
            />
            {/* Description toggle */}
            <button
              onClick={() => toggleDesc(idx)}
              title={descVisible.has(idx) ? 'Hide description' : 'Add description'}
              className={`flex-shrink-0 px-1 transition-colors opacity-0 group-hover:opacity-100 ${
                descVisible.has(idx) || row.description
                  ? 'text-blue-400 opacity-100'
                  : 'text-surface-400 hover:text-blue-400'
              }`}
            >
              ≡
            </button>
            <button
              onClick={() => remove(idx)}
              className="text-surface-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity px-1"
            >×</button>
          </div>

          {/* Description row */}
          {(descVisible.has(idx) || row.description) && (
            <div className="ml-5 mt-0.5 pr-10">
              <input
                value={row.description ?? ''}
                onChange={e => update(idx, { description: e.target.value })}
                placeholder="Description…"
                className="w-full bg-surface-800/50 border border-surface-700/50 rounded px-2 py-0.5 text-[10px] text-surface-300 placeholder-surface-600 focus:outline-none focus:border-blue-500/60"
              />
            </div>
          )}
        </div>
      ))}
      <button onClick={add} className="mt-1 text-surface-400 hover:text-white transition-colors">
        + Add
      </button>
    </div>
  );
}
