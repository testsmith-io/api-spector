// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Prompt for the ask variables ({{@Message}}) a request uses, just before it is
// sent. Each message gets a text field, or a dropdown when the variable was
// written with a fixed list of choices ({{@Message[a, b]}}).

import React, { useEffect, useRef, useState } from 'react';
import type { AskVar } from '../../../../shared/ask-vars';
import { useT } from '../../i18n';
import { btnSecondaryCls, btnPrimaryCls } from '../../lib/ui-classes';

export function AskVarsModal({ asks, requestName, onSubmit, onCancel }: {
  readonly asks: AskVar[]
  readonly requestName: string
  readonly onSubmit: (answers: Record<string, string>) => void
  readonly onCancel: () => void
}) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const a of asks) init[a.message] = a.choices?.[0] ?? '';
    return init;
  });
  const firstRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  function submit() { onSubmit(values); }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={onCancel}>
      <div
        className="bg-surface-900 border border-surface-700 rounded-lg shadow-xl w-[420px] max-h-[80vh] flex flex-col"
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="px-4 py-3 border-b border-surface-800 flex-shrink-0">
          <div className="text-sm font-medium text-white">{t('Enter values')}</div>
          <div className="text-[11px] text-surface-500 truncate">{requestName}</div>
        </div>

        <div className="p-4 overflow-y-auto flex flex-col gap-3">
          {asks.map((a, i) => (
            <label key={a.key} className="flex flex-col gap-1">
              <span className="text-xs text-surface-300">{a.message}</span>
              {a.choices && a.choices.length > 0 ? (
                <select
                  ref={i === 0 ? (firstRef as React.RefObject<HTMLSelectElement>) : undefined}
                  value={values[a.message] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [a.message]: e.target.value }))}
                  className="bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500 text-surface-200"
                >
                  {a.choices.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <input
                  ref={i === 0 ? (firstRef as React.RefObject<HTMLInputElement>) : undefined}
                  value={values[a.message] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [a.message]: e.target.value }))}
                  placeholder={a.message}
                  className="bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-500 placeholder-surface-600"
                />
              )}
            </label>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-surface-800 flex-shrink-0 flex justify-end gap-2">
          <button onClick={onCancel} className={btnSecondaryCls}>{t('Cancel')}</button>
          <button onClick={submit} className={btnPrimaryCls}>{t('Send')}</button>
        </div>
      </div>
    </div>
  );
}
