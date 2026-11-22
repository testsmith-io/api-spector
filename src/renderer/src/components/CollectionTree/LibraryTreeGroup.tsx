// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { libraryScopeKey } from '../../store/slices/libraries-slice';
import { useT } from '../../i18n';
import { DotsBtn } from '../common/ContextMenu';
import { FileCodeIcon, PlusIcon, PencilIcon, TrashIcon } from '../common/icons';
import {
  librariesInDir, libDirFor, libPathFor, isValidLibraryName,
  type LibraryScope,
} from '../../../../shared/libraries';

function template(name: string): string {
  return [
    `// ${name}.ts - reusable library. Load it in any script with sp.require('${name}').`,
    ``,
    `export function hello(name: string): string {`,
    `  return 'Hello, ' + name;`,
    `}`,
    ``,
  ].join('\n');
}

/** Context-menu entry point: ask the matching tree group to open its inline
 *  "new library" input. (window.prompt is unavailable in Electron.) */
export function requestNewLibrary(scope: LibraryScope, scopeId?: string): void {
  useStore.getState().requestLibraryCreate(scope, scopeId);
}

interface Props {
  readonly scope: LibraryScope
  readonly scopeId?: string
  /** Indent depth to align with sibling rows. */
  readonly depth: number
}

export function LibraryTreeGroup({ scope, scopeId, depth }: Props) {
  const t = useT();
  const contents           = useStore(s => s.libraryContents);
  const openLibraryTab     = useStore(s => s.openLibraryTab);
  const saveLibraryFile    = useStore(s => s.saveLibraryFile);
  const deleteLibraryFile  = useStore(s => s.deleteLibraryFile);
  const renameLibraryFile  = useStore(s => s.renameLibraryFile);
  const createRequest      = useStore(s => s.libraryCreateRequest);
  const clearCreateRequest = useStore(s => s.clearLibraryCreateRequest);
  const activeLibraryPath  = useStore(s => { const tb = s.tabs.find(x => x.id === s.activeTabId); return tb?.libraryPath ?? null; });

  const dir  = libDirFor(scope, scopeId);
  const libs = useMemo(() => librariesInDir(contents, dir), [contents, dir]);
  const key  = libraryScopeKey(scope, scopeId);

  const [expanded, setExpanded] = useState(true);
  const [adding, setAdding]     = useState(false);
  const [newName, setNewName]   = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);

  // A context-menu "New library" for this scope opens the inline input.
  useEffect(() => {
    if (createRequest === key) {
      setExpanded(true);
      setAdding(true);
      setError(null);
      clearCreateRequest();
    }
  }, [createRequest, key, clearCreateRequest]);

  // The group stays invisible until it holds a file; creation is via the scope's
  // "New library" menu, which flips `adding` on through the create-request signal
  // (this component stays mounted while hidden, so that effect still fires).
  if (libs.length === 0 && !adding) return null;

  const headerPad = 8 + depth * 12;
  const rowPad    = 8 + (depth + 1) * 12;

  function startAdd() { setAdding(true); setExpanded(true); setNewName(''); setError(null); }
  function cancelAdd() { setAdding(false); setNewName(''); setError(null); }

  async function commitAdd() {
    const name = newName.trim();
    if (!name) { cancelAdd(); return; }
    if (!isValidLibraryName(name)) { setError(t('Use letters, digits, - and _ (must not start with a digit).')); return; }
    if (libs.some(l => l.name === name)) { setError(t('A library with that name already exists here.')); return; }
    const path = libPathFor(scope, name, scopeId);
    await saveLibraryFile(path, template(name));
    openLibraryTab(path);
    cancelAdd();
  }

  async function commitRename(oldName: string, raw: string) {
    const next = raw.trim();
    setRenaming(null);
    if (!next || next === oldName) return;
    if (!isValidLibraryName(next)) return;
    if (libs.some(l => l.name === next)) return;
    await renameLibraryFile(libPathFor(scope, oldName, scopeId), libPathFor(scope, next, scopeId));
  }

  async function remove(name: string) {
    if (!window.confirm(t('Delete library :name? This cannot be undone.', { name }))) return;
    await deleteLibraryFile(libPathFor(scope, name, scopeId));
  }

  return (
    <div>
      <div
        data-row
        className="group flex items-center gap-1.5 py-1 pr-2 hover:bg-surface-800/40 cursor-pointer select-none"
        style={{ paddingLeft: headerPad }}
        onClick={() => setExpanded(v => !v)}
      >
        <span className="text-[9px] text-surface-500 w-2">{expanded ? '▾' : '▸'}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-500 flex-1">{t('Libraries')}</span>
        <button
          onClick={e => { e.stopPropagation(); startAdd(); }}
          title={t('New library')}
          aria-label={t('New library')}
          className="opacity-0 group-hover:opacity-100 text-surface-400 hover:text-white transition-opacity"
        >
          <PlusIcon />
        </button>
      </div>

      {expanded && adding && (
        <div style={{ paddingLeft: rowPad }} className="py-1 pr-2">
          <input
            autoFocus
            value={newName}
            onChange={e => { setNewName(e.target.value); setError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') void commitAdd(); if (e.key === 'Escape') cancelAdd(); }}
            onBlur={() => { if (!newName.trim()) cancelAdd(); }}
            placeholder={t('library-name')}
            className="w-full bg-surface-900 border border-surface-700 rounded px-1.5 py-1 text-xs font-mono focus:outline-none focus:border-blue-500"
          />
          {error && <p className="text-[10px] text-red-400 mt-0.5">{error}</p>}
        </div>
      )}

      {expanded && libs.map(lib => {
        const path = libPathFor(scope, lib.name, scopeId);
        const active = path === activeLibraryPath;
        if (renaming === lib.name) {
          return (
            <div key={lib.name} style={{ paddingLeft: rowPad }} className="py-1 pr-2">
              <input
                autoFocus
                defaultValue={lib.name}
                onKeyDown={e => {
                  if (e.key === 'Enter') void commitRename(lib.name, (e.target as HTMLInputElement).value);
                  if (e.key === 'Escape') setRenaming(null);
                }}
                onBlur={e => void commitRename(lib.name, e.target.value)}
                className="w-full bg-surface-900 border border-surface-700 rounded px-1.5 py-1 text-xs font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
          );
        }
        return (
          <div
            key={lib.name}
            data-row
            className={`group flex items-center gap-1.5 py-1 pr-2 cursor-pointer select-none ${active ? 'bg-surface-800 text-white' : 'text-surface-300 hover:bg-surface-800/40'}`}
            style={{ paddingLeft: rowPad }}
            onClick={() => openLibraryTab(path)}
            onDoubleClick={() => setRenaming(lib.name)}
          >
            <span className="text-surface-500 shrink-0"><FileCodeIcon className="w-3.5 h-3.5" /></span>
            <span className="text-xs font-mono truncate flex-1" title={lib.name}>{lib.name}</span>
            <DotsBtn items={[
              { type: 'item', label: t('Rename'), icon: <PencilIcon />, onClick: () => setRenaming(lib.name) },
              { type: 'item', label: t('Delete'), icon: <TrashIcon />, danger: true, onClick: () => void remove(lib.name) },
            ]} />
          </div>
        );
      })}
    </div>
  );
}
