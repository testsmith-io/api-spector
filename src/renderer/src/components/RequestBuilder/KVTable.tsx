import React from 'react';
import type { KeyValuePair } from '../../../../shared/types';
import { VarInput } from '../common/VarInput';

interface Props {
  rows: KeyValuePair[]
  onChange: (rows: KeyValuePair[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}

export function KVTable({ rows, onChange, keyPlaceholder = 'Key', valuePlaceholder = 'Value' }: Props) {
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
  }

  return (
    <div className="text-xs">
      {rows.map((row, idx) => (
        <div key={idx} className="flex items-center gap-1.5 mb-1 group">
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
          />
          <VarInput
            value={row.value}
            onChange={v => update(idx, { value: v })}
            placeholder={valuePlaceholder}
            wrapperClassName="flex-1"
            className="bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
          />
          <button
            onClick={() => remove(idx)}
            className="text-surface-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity px-1"
          >×</button>
        </div>
      ))}
      <button onClick={add} className="mt-1 text-surface-400 hover:text-white transition-colors">
        + Add
      </button>
    </div>
  );
}
