// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React from 'react';
import type { MultipartPart } from '../../../../shared/types';
import { VarInput } from '../common/VarInput';
import { useT } from '../../i18n';

interface Props {
  readonly rows: MultipartPart[]
  readonly onChange: (rows: MultipartPart[]) => void
}

// The basename of a path, tolerant of both / and \ separators (the renderer has
// no node:path), for the compact label next to a chosen file.
function baseName(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

/** Editor for a multipart/form-data body. File rows pick a path via the native
 * dialog; the file is read at send time, never stored in the collection. */
export function MultipartTable({ rows, onChange }: Props) {
  const t = useT();

  function update(idx: number, patch: Partial<MultipartPart>) {
    const next = [...rows];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  }

  function add() {
    onChange([...rows, { key: '', value: '', enabled: true, type: 'text' }]);
  }

  function remove(idx: number) {
    onChange(rows.filter((_, i) => i !== idx));
  }

  async function pick(idx: number) {
    const path = await window.electron.pickFile();
    if (path) update(idx, { filePath: path });
  }

  return (
    <div className="text-xs">
      {rows.map((row, idx) => (
        <div key={idx} className="mb-1 flex items-center gap-1.5 group">
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={e => update(idx, { enabled: e.target.checked })}
            className="accent-blue-500 flex-shrink-0"
            aria-label={t('Enabled')}
          />
          <select
            value={row.type}
            onChange={e => update(idx, { type: e.target.value as MultipartPart['type'] })}
            aria-label={t('Part type')}
            title={row.type === 'file' ? t('File upload part') : t('Text field part')}
            className={`flex-shrink-0 text-[10px] bg-surface-800 border border-surface-700 rounded px-1.5 py-1 focus:outline-none focus:border-blue-500 font-mono ${
              row.type === 'file' ? 'text-violet-400' : 'text-surface-400'
            }`}
          >
            <option value="text">{t('text')}</option>
            <option value="file">{t('file')}</option>
          </select>
          <VarInput
            value={row.key}
            onChange={v => update(idx, { key: v })}
            placeholder={t('field')}
            wrapperClassName="flex-1"
            className="bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
          />
          {row.type === 'file' ? (
            <div className="flex-1 flex items-center gap-1 min-w-0">
              <button
                onClick={() => pick(idx)}
                className="flex-shrink-0 px-2 py-1 bg-surface-800 border border-surface-700 rounded hover:border-blue-500 text-surface-300 transition-colors"
              >
                {t('Choose file…')}
              </button>
              <span
                className="truncate text-surface-400 font-mono"
                title={row.filePath || t('No file selected')}
              >
                {row.filePath ? baseName(row.filePath) : t('No file selected')}
              </span>
            </div>
          ) : (
            <VarInput
              value={row.value ?? ''}
              onChange={v => update(idx, { value: v })}
              placeholder={t('value')}
              wrapperClassName="flex-1"
              className="bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
            />
          )}
          <button
            onClick={() => remove(idx)}
            aria-label={t('Remove')}
            className="text-surface-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity px-1"
          >×</button>
        </div>
      ))}
      <button onClick={add} className="mt-1 text-surface-400 hover:text-white transition-colors">
        {t('+ Add')}
      </button>
    </div>
  );
}
