// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT
//
// A small "move ▸" control shown next to a variable in any scope editor. Opens
// a popover to pick the destination scope; when that scope has several instances
// (which collection / folder / environment / request) it shows an instance
// picker. Moves via moveVariable, which blocks on a name clash and surfaces the
// reason inline.

import React, { useState } from 'react';
import { useT } from '../../i18n';
import {
  type VarLoc, type VarScopeKind,
  SCOPE_HAS_INSTANCES, listScopeInstances, moveVariable,
} from '../../lib/variableMove';

const KINDS: VarScopeKind[] = ['request', 'folder', 'collection', 'environment', 'global'];

export function MoveVariableMenu({ from, name, onMoved, buttonClassName }: {
  readonly from: VarLoc
  readonly name: string
  /** Called after a successful move so the host can resync its local row buffer. */
  readonly onMoved?: () => void
  readonly buttonClassName?: string
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<VarScopeKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scopeWord: Record<VarScopeKind, string> = {
    request: t('request'), folder: t('folder'), collection: t('collection'),
    environment: t('environment'), global: t('globals'),
  };

  function close() { setOpen(false); setKind(null); setError(null); }

  function pick(dst: VarLoc) {
    const res = moveVariable(from, dst, name.trim());
    if (!res.ok) { setError(res.error ?? t('Move failed')); return; }
    close();
    onMoved?.();
  }

  function chooseKind(k: VarScopeKind) {
    setError(null);
    const insts = listScopeInstances(k, from);
    if (insts.length === 0) { setError(t('Nowhere to move it in that scope.')); return; }
    if (insts.length === 1) { pick(insts[0].loc); return; }   // e.g. globals, or a single collection/env
    setKind(k);                                                // let the user pick which instance
  }

  const instances = kind ? listScopeInstances(kind, from) : [];
  // Moving to the same single-instance scope makes no sense; only hide `global`
  // when the source is already global (every other kind can target a sibling).
  const kinds = KINDS.filter(k => !(k === 'global' && from.kind === 'global'));

  return (
    <div className="relative inline-block" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => { setOpen(o => !o); setKind(null); setError(null); }}
        title={t('Move this variable to another scope')}
        className={buttonClassName ?? 'shrink-0 text-[9px] uppercase tracking-wider text-surface-500 hover:text-blue-400 border border-surface-700 hover:border-blue-500/40 rounded px-1 py-px'}
      >
        {t('move')} ▸
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div className="absolute right-0 z-50 mt-1 min-w-[190px] max-h-72 overflow-auto bg-surface-800 border border-surface-600 rounded shadow-xl text-xs py-1">
            {error && (
              <div className="px-2 py-1.5 text-[10px] text-red-400 whitespace-normal break-words border-b border-surface-700">{error}</div>
            )}
            {!kind ? (
              kinds.map(k => (
                <button
                  key={k}
                  onClick={() => chooseKind(k)}
                  className="w-full text-left px-2 py-1 hover:bg-surface-700 flex items-center justify-between gap-2"
                >
                  <span>{t('to')} {scopeWord[k]}</span>
                  {SCOPE_HAS_INSTANCES[k] && <span className="text-surface-500">▸</span>}
                </button>
              ))
            ) : (
              <>
                <button onClick={() => { setKind(null); setError(null); }} className="w-full text-left px-2 py-1 text-surface-500 hover:bg-surface-700">‹ {t('back')}</button>
                {instances.map((ins, i) => (
                  <button key={i} onClick={() => pick(ins.loc)} className="w-full text-left px-2 py-1 hover:bg-surface-700 truncate" title={ins.label}>{ins.label}</button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
