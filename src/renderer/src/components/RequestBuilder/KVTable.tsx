// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useState } from 'react';
import type { KeyValuePair } from '../../../../shared/types';
import { VarInput } from '../common/VarInput';
import { MoveVariableMenu } from '../common/MoveVariableMenu';
import type { VarLoc } from '../../lib/variableMove';
import { HEADER_NAMES, getValueSuggestions } from './header-suggestions';
import { useT } from '../../i18n';

interface Props {
  readonly rows: KeyValuePair[]
  readonly onChange: (rows: KeyValuePair[]) => void
  readonly keyPlaceholder?: string
  readonly valuePlaceholder?: string
  /** When true, provides autocomplete for HTTP header names and common values. */
  readonly headerMode?: boolean
  /** When true, each row shows a "query/path" type selector. */
  readonly paramMode?: boolean
  /** When these rows are scope variables, the source location for each key — a
   *  per-row "move ▸" control relocates it to another scope. */
  readonly moveFrom?: (key: string) => VarLoc | null
  readonly onMoved?: () => void
}

export function KVTable({ rows, onChange, keyPlaceholder, valuePlaceholder, headerMode, paramMode, moveFrom, onMoved }: Props) {
  const t = useT();
  const keyPh = keyPlaceholder ?? t('Key');
  const valuePh = valuePlaceholder ?? t('Value');
  // Track which rows have their description input visible.
  // Initialise with indices of rows that already have a description.
  const [descVisible, setDescVisible] = useState<Set<number>>(
    () => new Set(rows.map((r, i) => (r.description ? i : -1)).filter(i => i >= 0)),
  );
  // Track which rows have their allowed-values (choices) editor visible.
  const [choicesVisible, setChoicesVisible] = useState<Set<number>>(
    () => new Set(rows.map((r, i) => (r.enum && r.enum.length ? i : -1)).filter(i => i >= 0)),
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

  function toggleChoices(idx: number) {
    setChoicesVisible(prev => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
        // Clear the allowed values when hiding, so the cell reverts to free text.
        update(idx, { enum: undefined });
      } else {
        next.add(idx);
      }
      return next;
    });
  }

  // Parse a comma-separated list into trimmed, non-empty choices.
  function parseChoices(text: string): string[] {
    return text.split(',').map(s => s.trim()).filter(Boolean);
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
            {paramMode && (
              <select
                value={row.paramType ?? 'query'}
                onChange={e => update(idx, { paramType: e.target.value as 'query' | 'path' })}
                title={(row.paramType ?? 'query') === 'path'
                  ? t('Path variable - substituted into the URL via {{name}}')
                  : t('Query string parameter - appended as ?key=value')}
                className={`flex-shrink-0 text-[10px] bg-surface-800 border border-surface-700 rounded px-1.5 py-1 focus:outline-none focus:border-blue-500 font-mono ${
                  (row.paramType ?? 'query') === 'path' ? 'text-violet-400' : 'text-surface-400'
                }`}
              >
                <option value="query">query</option>
                <option value="path">path</option>
              </select>
            )}
            <VarInput
              value={row.key}
              onChange={v => update(idx, { key: v })}
              placeholder={keyPh}
              wrapperClassName="flex-1"
              className="bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
              staticSuggestions={headerMode ? HEADER_NAMES : undefined}
            />
            {row.enum && row.enum.length > 0 ? (
              <select
                value={row.value}
                onChange={e => update(idx, { value: e.target.value })}
                title={t('Allowed values')}
                className="flex-1 min-w-0 bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono text-surface-200"
              >
                {!row.enum.includes(row.value) && (
                  <option value={row.value}>{row.value || t('Select…')}</option>
                )}
                {row.enum.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <VarInput
                value={row.value}
                onChange={v => update(idx, { value: v })}
                placeholder={valuePh}
                wrapperClassName="flex-1"
                className="bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
                staticSuggestions={headerMode ? (getValueSuggestions(row.key) ?? undefined) : undefined}
              />
            )}
            {/* Allowed-values (choices) toggle */}
            <button
              onClick={() => toggleChoices(idx)}
              title={choicesVisible.has(idx) ? t('Remove allowed values') : t('Add allowed values (dropdown)')}
              className={`flex-shrink-0 px-1 transition-colors opacity-0 group-hover:opacity-100 ${
                choicesVisible.has(idx) || (row.enum && row.enum.length)
                  ? 'text-blue-400 opacity-100'
                  : 'text-surface-400 hover:text-blue-400'
              }`}
            >
              ▾
            </button>
            {/* Description toggle */}
            <button
              onClick={() => toggleDesc(idx)}
              title={descVisible.has(idx) ? t('Hide description') : t('Add description')}
              className={`flex-shrink-0 px-1 transition-colors opacity-0 group-hover:opacity-100 ${
                descVisible.has(idx) || row.description
                  ? 'text-blue-400 opacity-100'
                  : 'text-surface-400 hover:text-blue-400'
              }`}
            >
              ≡
            </button>
            {moveFrom && row.key.trim() && moveFrom(row.key.trim()) && (
              <MoveVariableMenu
                from={moveFrom(row.key.trim())!}
                name={row.key.trim()}
                onMoved={onMoved}
                buttonClassName="flex-shrink-0 text-[9px] uppercase tracking-wider text-surface-500 hover:text-blue-400 border border-surface-700 hover:border-blue-500/40 rounded px-1 py-px opacity-0 group-hover:opacity-100 transition-opacity"
              />
            )}
            <button
              onClick={() => remove(idx)}
              className="text-surface-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity px-1"
            >×</button>
          </div>

          {/* Allowed-values editor row */}
          {(choicesVisible.has(idx) || (row.enum && row.enum.length)) && (
            <div className="ml-5 mt-0.5 pr-10">
              <input
                value={(row.enum ?? []).join(', ')}
                onChange={e => {
                  const vals = parseChoices(e.target.value);
                  update(idx, { enum: vals.length ? vals : undefined });
                }}
                placeholder={t('Allowed values, comma separated (e.g. asc, desc)')}
                className="w-full bg-surface-800/50 border border-surface-700/50 rounded px-2 py-0.5 text-[10px] text-surface-300 placeholder-surface-600 focus:outline-none focus:border-blue-500/60 font-mono"
              />
            </div>
          )}

          {/* Description row */}
          {(descVisible.has(idx) || row.description) && (
            <div className="ml-5 mt-0.5 pr-10">
              <input
                value={row.description ?? ''}
                onChange={e => update(idx, { description: e.target.value })}
                placeholder={t('Description…')}
                className="w-full bg-surface-800/50 border border-surface-700/50 rounded px-2 py-0.5 text-[10px] text-surface-300 placeholder-surface-600 focus:outline-none focus:border-blue-500/60"
              />
            </div>
          )}
        </div>
      ))}
      <button onClick={add} className="mt-1 text-surface-400 hover:text-white transition-colors">
        {t('+ Add')}
      </button>
    </div>
  );
}
