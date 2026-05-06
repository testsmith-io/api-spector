// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useState, useRef, useEffect, useContext, createContext } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store';
import type { Folder, Collection, ApiRequest } from '../../../../shared/types';
import { MethodBadge } from '../common/MethodBadge';
import { FolderSettingsModal } from './FolderSettingsModal';
import { CollectionSettingsModal } from './CollectionSettingsModal';
import { SchemaSyncModal } from './SchemaSyncModal';
import { RequestRow } from './RequestRow';

// ─── Drag-and-drop context ────────────────────────────────────────────────────

export type DragState =
  | { type: 'request'; requestId: string; collectionId: string }
  | { type: 'folder';  folderId: string;  collectionId: string }

export const DragCtx = createContext<{
  dragging:       DragState | null
  setDragging:    (d: DragState | null) => void
  onDropRequest:  (destCollectionId: string, destFolderId: string, destIndex?: number) => void
  onDropFolder:   (destCollectionId: string, destParentFolderId: string, destIndex?: number) => void
}>({ dragging: null, setDragging: () => {}, onDropRequest: () => {}, onDropFolder: () => {} });

// ─── Inline rename ────────────────────────────────────────────────────────────

export function InlineEdit({
  value, onCommit, onCancel, className = '', validate,
}: {
  value: string; onCommit: (v: string) => void; onCancel: () => void; className?: string
  validate?: (v: string) => string | null
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.select(); }, []);

  function tryCommit(v: string) {
    const trimmed = v.trim();
    if (!trimmed) { onCancel(); return; }
    const err = validate?.(trimmed) ?? null;
    if (err) { setError(err); setTimeout(() => ref.current?.focus(), 0); return; }
    onCommit(trimmed);
  }

  return (
    <div onClick={e => e.stopPropagation()}>
      <input
        ref={ref}
        value={draft}
        onChange={e => { setDraft(e.target.value); setError(null); }}
        onBlur={() => tryCommit(draft)}
        onKeyDown={e => {
          if (e.key === 'Enter') tryCommit(draft);
          if (e.key === 'Escape') onCancel();
          e.stopPropagation();
        }}
        // Force the input's own text color so it's consistent regardless of
        // the parent row's `text-surface-*` (folder rows are dimmer than
        // request rows; without this, renaming a folder *looks* different
        // from renaming a request).
        className={`bg-surface-700 text-[var(--text-primary)] rounded px-1 focus:outline-none focus:ring-1 w-full ${
          error ? 'ring-1 ring-red-500 focus:ring-red-500' : 'focus:ring-blue-500'
        } ${className}`}
      />
      {error && <p className="text-[10px] text-red-400 mt-0.5 px-1">{error}</p>}
    </div>
  );
}

// ─── Tag chips ────────────────────────────────────────────────────────────────

export function TagChips({
  tags, onRemove, onAdd, forceAdding = false, onDoneAdding,
}: {
  tags: string[]
  onRemove: (tag: string) => void
  onAdd: (tag: string) => void
  forceAdding?: boolean
  onDoneAdding?: () => void
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft]   = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);
  useEffect(() => { if (forceAdding) setAdding(true); }, [forceAdding]);

  function commit() {
    // Preserve case as typed. Tag matching at run-time is case-sensitive
    // (see request-collection.ts), so lowercasing here would silently make
    // tags entered as e.g. "Smoke" un-runnable via `--tags Smoke`.
    const t = draft.trim();
    if (t && !tags.includes(t)) onAdd(t);
    setDraft('');
    setAdding(false);
    onDoneAdding?.();
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 mt-0.5" onClick={e => e.stopPropagation()}>
      {tags.map(tag => (
        <span
          key={tag}
          className="flex items-center gap-0.5 px-1 py-px rounded text-[9px] bg-blue-900/50 text-blue-300 border border-blue-800/50"
        >
          {tag}
          <button
            onClick={() => onRemove(tag)}
            className="hover:text-red-400 leading-none ml-0.5"
          >×</button>
        </span>
      ))}
      {adding ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setAdding(false); setDraft(''); onDoneAdding?.(); } e.stopPropagation(); }}
          onBlur={commit}
          className="w-16 text-[9px] bg-surface-700 rounded px-1 py-px focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="tag…"
        />
      ) : null}
    </div>
  );
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({ message, onConfirm, onCancel }: {
  message: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 z-[300] flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        className="bg-surface-900 border border-surface-700 rounded-lg shadow-2xl p-4 w-72 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-sm text-white">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-surface-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs bg-red-700 hover:bg-red-600 rounded transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Context menu ─────────────────────────────────────────────────────────────

export type MenuItem =
  | { type: 'item'; label: string; icon?: React.ReactNode; danger?: boolean; onClick: () => void }
  | { type: 'separator' }
  | { type: 'header'; label: string }

function ContextMenu({ items, x, y, onClose }: {
  items: MenuItem[]
  x: number
  y: number
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handle, true);
    return () => document.removeEventListener('mousedown', handle, true);
  }, [onClose]);

  const [pos, setPos] = useState({ top: y, left: x });
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth) left = x - rect.width;
    if (top + rect.height > window.innerHeight) top = y - rect.height;
    setPos({ top, left });
  }, [x, y]);

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
      className="bg-surface-900 border border-surface-700 rounded-lg shadow-2xl py-1 min-w-[170px]"
      onMouseDown={e => e.stopPropagation()}
    >
      {items.map((item, i) =>
        item.type === 'separator' ? (
          <div key={i} className="border-t border-surface-700 my-1" />
        ) : item.type === 'header' ? (
          <div key={i} className="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider font-semibold text-surface-500 select-none">
            {item.label}
          </div>
        ) : (
          <button
            key={i}
            onClick={e => { e.stopPropagation(); item.onClick(); onClose(); }}
            className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
              item.danger
                ? 'text-red-400 hover:bg-surface-800 hover:text-red-300'
                : 'text-[var(--text-primary)] hover:bg-surface-800'
            }`}
          >
            {item.icon && <span className="w-3 h-3 shrink-0 flex items-center justify-center">{item.icon}</span>}
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  );
}

export function DotsBtn({ items }: { items: MenuItem[] }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  return (
    <div className="relative">
      <button
        onClick={e => {
          e.stopPropagation();
          if (menu) { setMenu(null); return; }
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setMenu({ x: rect.right + 4, y: rect.top });
        }}
        className="opacity-0 group-hover:opacity-100 px-1 py-0.5 rounded text-surface-400 hover:text-white hover:bg-surface-700 transition-all"
        title="Options"
      >
        <DotsHorizontalIcon />
      </button>
      {menu && (
        <ContextMenu items={items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

// ─── Root tree ────────────────────────────────────────────────────────────────

export function CollectionTree() {
  const collections        = useStore(s => s.collections);
  const activeCollectionId = useStore(s => s.activeCollectionId);
  const activeTabId        = useStore(s => s.activeTabId);
  const tabs               = useStore(s => s.tabs);
  const openInTab          = useStore(s => s.openInTab);
  const setActiveCollection = useStore(s => s.setActiveCollection);

  // Derive the active request id from the active tab
  const activeRequestId = tabs.find(t => t.id === activeTabId)?.requestId ?? null;
  const addCollection     = useStore(s => s.addCollection);
  const addRequest        = useStore(s => s.addRequest);
  const addFolder         = useStore(s => s.addFolder);
  const renameCollection  = useStore(s => s.renameCollection);
  const deleteCollection  = useStore(s => s.deleteCollection);
  const renameFolder      = useStore(s => s.renameFolder);
  const deleteFolder      = useStore(s => s.deleteFolder);
  const renameRequest       = useStore(s => s.renameRequest);
  const deleteRequest       = useStore(s => s.deleteRequest);
  const duplicateRequest    = useStore(s => s.duplicateRequest);
  const duplicateCollection = useStore(s => s.duplicateCollection);
  const duplicateFolder     = useStore(s => s.duplicateFolder);
  const updateFolderTags  = useStore(s => s.updateFolderTags);
  const updateRequestTags = useStore(s => s.updateRequestTags);
  const updateRequest     = useStore(s => s.updateRequest);
  const openRunner        = useStore(s => s.openRunner);

  const moveRequest = useStore(s => s.moveRequest);
  const moveFolder  = useStore(s => s.moveFolder);

  const colList = Object.values(collections);
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [newRequestId, setNewRequestId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);

  function confirmThen(message: string, action: () => void) {
    setPendingConfirm({ message, onConfirm: () => { action(); setPendingConfirm(null); } });
  }

  function onDropRequest(destCollectionId: string, destFolderId: string, destIndex?: number) {
    if (!dragging || dragging.type !== 'request') return;
    moveRequest(dragging.collectionId, dragging.requestId, destCollectionId, destFolderId, destIndex);
    setDragging(null);
  }

  function onDropFolder(destCollectionId: string, destParentFolderId: string, destIndex?: number) {
    if (!dragging || dragging.type !== 'folder') return;
    if (dragging.collectionId !== destCollectionId) return;  // cross-collection folder moves not supported
    moveFolder(dragging.collectionId, dragging.folderId, destParentFolderId, destIndex);
    setDragging(null);
  }

  return (
    <DragCtx.Provider value={{ dragging, setDragging, onDropRequest, onDropFolder }}>
    <div className="flex flex-col flex-1 min-h-0 select-none">
      {pendingConfirm && (
        <ConfirmDialog
          message={pendingConfirm.message}
          onConfirm={pendingConfirm.onConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
      <div className="flex-1 overflow-y-auto">
        {colList.map(({ data: col }) => (
          <CollectionNode
            key={col.id}
            col={col}
            isActive={col.id === activeCollectionId}
            activeRequestId={activeRequestId}
            existingCollectionNames={colList.map(c => c.data.name)}
            onSelectCollection={() => setActiveCollection(col.id)}
            onSelectRequest={(reqId) => openInTab(reqId, col.id)}
            newRequestId={newRequestId}
            onAddRequest={folderId => setNewRequestId(addRequest(col.id, folderId))}
            onAddFolder={(parentId, name) => addFolder(col.id, parentId, name)}
            onRenameCollection={name => renameCollection(col.id, name)}
            onDeleteCollection={() => confirmThen(`Delete collection "${col.name}"?`, () => deleteCollection(col.id))}
            onDuplicateCollection={() => duplicateCollection(col.id)}
            onRenameFolder={(folderId, name) => renameFolder(col.id, folderId, name)}
            onDeleteFolder={folderId => confirmThen('Delete this folder and all its requests?', () => deleteFolder(col.id, folderId))}
            onDuplicateFolder={folderId => duplicateFolder(col.id, folderId)}
            onRenameRequest={renameRequest}
            onDeleteRequest={reqId => deleteRequest(col.id, reqId)}
            onDuplicateRequest={reqId => duplicateRequest(col.id, reqId)}
            onUpdateFolderTags={(folderId, tags) => updateFolderTags(col.id, folderId, tags)}
            onUpdateRequestTags={updateRequestTags}
            onSetRequestHookType={(reqId, hookType) => updateRequest(reqId, { hookType })}
            onToggleRequestDisabled={reqId => {
              const r = col.requests[reqId];
              if (r) updateRequest(reqId, { disabled: !r.disabled });
            }}
            onRunCollection={() => openRunner(col.id)}
            onRunFolder={folderId => openRunner(col.id, folderId)}
          />
        ))}

        {colList.length === 0 && (
          <div className="px-3 py-4 text-xs text-surface-400 space-y-1">
            <p>No collections yet.</p>
            <button onClick={() => addCollection('New Collection')} className="text-blue-400 hover:text-blue-300 transition-colors">
              + New collection
            </button>
            <p className="pt-1">or import from Postman / OpenAPI above.</p>
          </div>
        )}
      </div>
    </div>
    </DragCtx.Provider>
  );
}

// ─── Collection row ───────────────────────────────────────────────────────────

type ExpandCtrl = { value: boolean; seq: number };

function CollectionNode({
  col, isActive, activeRequestId,
  existingCollectionNames,
  newRequestId,
  onSelectCollection, onSelectRequest,
  onAddRequest, onAddFolder,
  onRenameCollection, onDeleteCollection, onDuplicateCollection,
  onRenameFolder, onDeleteFolder, onDuplicateFolder,
  onRenameRequest, onDeleteRequest, onDuplicateRequest,
  onUpdateFolderTags, onUpdateRequestTags, onSetRequestHookType, onToggleRequestDisabled,
  onRunCollection, onRunFolder,
}: {
  col: Collection
  isActive: boolean
  activeRequestId: string | null
  existingCollectionNames: string[]
  newRequestId: string | null
  onSelectCollection: () => void
  onSelectRequest: (id: string) => void
  onAddRequest: (folderId: string) => void
  onAddFolder: (parentId: string, name: string) => void
  onRenameCollection: (name: string) => void
  onDeleteCollection: () => void
  onDuplicateCollection: () => void
  onRenameFolder: (folderId: string, name: string) => void
  onDeleteFolder: (folderId: string) => void
  onDuplicateFolder: (folderId: string) => void
  onRenameRequest: (id: string, name: string) => void
  onDeleteRequest: (id: string) => void
  onDuplicateRequest: (id: string) => void
  onUpdateFolderTags: (folderId: string, tags: string[]) => void
  onUpdateRequestTags: (requestId: string, tags: string[]) => void
  onSetRequestHookType: (requestId: string, hookType: ApiRequest['hookType']) => void
  onToggleRequestDisabled: (requestId: string) => void
  onRunCollection: () => void
  onRunFolder: (folderId: string) => void
}) {
  const [expanded, setExpanded] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSchemaSync, setShowSchemaSync] = useState(false);
  const [expandCtrl, setExpandCtrl] = useState<ExpandCtrl>({ value: true, seq: 0 });
  const [dropOver, setDropOver] = useState(false);
  const dragCtx = useContext(DragCtx);

  function expandAll()   { setExpandCtrl(c => ({ value: true,  seq: c.seq + 1 })); }
  function collapseAll() { setExpandCtrl(c => ({ value: false, seq: c.seq + 1 })); }

  return (
    <div>
      <div
        className={`group flex items-start gap-1 px-2 py-1.5 cursor-pointer hover:bg-surface-800 transition-colors ${
          isActive ? 'text-[var(--text-primary)]' : 'text-surface-400'
        } ${dropOver ? 'outline outline-1 outline-blue-500 rounded' : ''}`}
        onClick={() => { onSelectCollection(); setExpanded(e => !e); }}
        onDragOver={dragCtx.dragging ? e => { e.preventDefault(); setDropOver(true); } : undefined}
        onDragLeave={() => setDropOver(false)}
        onDrop={e => {
          e.preventDefault(); setDropOver(false);
          if (dragCtx.dragging?.type === 'folder') dragCtx.onDropFolder(col.id, col.rootFolder.id);
          else dragCtx.onDropRequest(col.id, col.rootFolder.id);
        }}
      >
        <span className="text-[10px] w-3 text-center shrink-0 mt-0.5">{expanded ? '▾' : '▸'}</span>

        <div className="flex-1 min-w-0">
          {renaming ? (
            <InlineEdit
              value={col.name}
              onCommit={v => { onRenameCollection(v); setRenaming(false); }}
              onCancel={() => setRenaming(false)}
              className="w-full text-xs"
              validate={v => existingCollectionNames.filter(n => n !== col.name).includes(v)
                ? `"${v}" already exists` : null}
            />
          ) : (
            <span className="text-xs font-semibold truncate block">{col.name}</span>
          )}
        </div>

        <div className="shrink-0">
          <DotsBtn items={[
            { type: 'item', label: 'Run collection', icon: <PlayIcon />, onClick: onRunCollection },
            { type: 'separator' },
            { type: 'item', label: 'Add request', icon: <PlusIcon />, onClick: () => onAddRequest(col.rootFolder.id) },
            { type: 'item', label: 'Add folder', icon: <FolderIcon />, onClick: () => onAddFolder(col.rootFolder.id, 'New Folder') },
            { type: 'separator' },
            { type: 'item', label: 'Expand all', icon: <ExpandAllIcon />, onClick: expandAll },
            { type: 'item', label: 'Collapse all', icon: <CollapseAllIcon />, onClick: collapseAll },
            { type: 'separator' },
            { type: 'item', label: 'Collection data', icon: <TableIcon />, onClick: onSelectCollection },
            { type: 'item', label: 'Settings', icon: <GearIcon />, onClick: () => setShowSettings(true) },
            { type: 'item', label: 'Sync schemas', icon: <SyncIcon />, onClick: () => setShowSchemaSync(true) },
            { type: 'item', label: 'Rename', icon: <PencilIcon />, onClick: () => setRenaming(true) },
            { type: 'item', label: 'Duplicate', icon: <CopyIcon />, onClick: onDuplicateCollection },
            { type: 'separator' },
            { type: 'item', label: 'Delete collection', icon: <TrashIcon />, danger: true, onClick: onDeleteCollection },
          ]} />
        </div>
      </div>

      {expanded && (
        <FolderContents
          folder={col.rootFolder}
          collectionId={col.id}
          requests={col.requests}
          activeRequestId={activeRequestId}
          depth={0}
          expandCtrl={expandCtrl}
          onSelectRequest={onSelectRequest}
          onAddRequest={onAddRequest}
          onAddFolder={onAddFolder}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          onDuplicateFolder={onDuplicateFolder}
          newRequestId={newRequestId}
          onRenameRequest={onRenameRequest}
          onDeleteRequest={onDeleteRequest}
          onDuplicateRequest={onDuplicateRequest}
          onUpdateFolderTags={onUpdateFolderTags}
          onUpdateRequestTags={onUpdateRequestTags}
          onSetRequestHookType={onSetRequestHookType}
          onToggleRequestDisabled={onToggleRequestDisabled}
          onRunFolder={onRunFolder}
        />
      )}
      {showSettings && (
        <CollectionSettingsModal collection={col} onClose={() => setShowSettings(false)} />
      )}
      {showSchemaSync && (
        <SchemaSyncModal collectionId={col.id} scope={{ type: 'collection' }} onClose={() => setShowSchemaSync(false)} />
      )}
    </div>
  );
}

// ─── Folder row ───────────────────────────────────────────────────────────────

function FolderRow({
  folder, collectionId, parentFolderId, folderIndex, depth,
  expandCtrl,
  onAddRequest, onAddFolder,
  onRename, onDelete, onDuplicate,
  onUpdateTags, onRun,
  children,
}: {
  folder: Folder
  collectionId: string
  parentFolderId: string
  folderIndex: number
  depth: number
  expandCtrl: ExpandCtrl
  onAddRequest: () => void
  onAddFolder: () => void
  onRename: (name: string) => void
  onDelete: () => void
  onDuplicate: () => void
  onUpdateTags: (tags: string[]) => void
  onRun: () => void
  children: React.ReactNode
}) {
  // Folders start collapsed so expanding a collection doesn't blow the whole
  // tree open. The user can still use "Expand all" from the collection
  // context menu, which propagates through expandCtrl.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (expandCtrl.seq > 0) setExpanded(expandCtrl.value);
  }, [expandCtrl.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  const [renaming, setRenaming] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSchemaSync, setShowSchemaSync] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [dropPos, setDropPos] = useState<'before' | 'inside' | 'after' | null>(null);
  const dragCtx = useContext(DragCtx);
  const tags = folder.tags ?? [];
  const indent = depth * 12 + 8;
  const hasInheritedConfig = (folder.auth && folder.auth.type !== 'none') || (folder.headers && folder.headers.length > 0);

  function handleFolderDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!dragCtx.dragging) return;
    // Don't allow dropping a folder onto itself
    if (dragCtx.dragging.type === 'folder' && dragCtx.dragging.folderId === folder.id) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const zone = y / rect.height;
    if (dragCtx.dragging.type === 'folder') {
      // Folders can be reordered (before/after) or nested (inside)
      if (zone < 0.25) setDropPos('before');
      else if (zone > 0.75) setDropPos('after');
      else setDropPos('inside');
    } else {
      // Requests always drop inside the folder
      setDropPos('inside');
    }
  }

  function handleFolderDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!dragCtx.dragging) return;
    if (dragCtx.dragging.type === 'folder') {
      if (dropPos === 'inside') {
        dragCtx.onDropFolder(collectionId, folder.id);
      } else {
        const insertIndex = dropPos === 'before' ? folderIndex : folderIndex + 1;
        dragCtx.onDropFolder(collectionId, parentFolderId, insertIndex);
      }
    } else {
      dragCtx.onDropRequest(collectionId, folder.id);
    }
    setDropPos(null);
  }

  return (
    <div className="relative">
      {dropPos === 'before' && <div className="absolute top-0 inset-x-0 h-0.5 bg-blue-500 z-10 pointer-events-none" />}
      <div
        draggable
        className={`group flex items-start gap-1 py-1 hover:bg-surface-800 transition-colors cursor-pointer text-surface-400 ${dropPos === 'inside' ? 'outline outline-1 outline-blue-500 rounded' : ''}`}
        style={{ paddingLeft: indent }}
        onClick={() => setExpanded(e => !e)}
        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); dragCtx.setDragging({ type: 'folder', folderId: folder.id, collectionId }); }}
        onDragEnd={() => { dragCtx.setDragging(null); setDropPos(null); }}
        onDragOver={handleFolderDragOver}
        onDragLeave={() => setDropPos(null)}
        onDrop={handleFolderDrop}
      >
      {dropPos === 'after' && <div className="absolute bottom-0 inset-x-0 h-0.5 bg-blue-500 z-10 pointer-events-none" />}
        <span className="text-[10px] w-3 text-center shrink-0 mt-0.5">{expanded ? '▾' : '▸'}</span>
        <FolderIcon className={`shrink-0 mt-0.5 ${hasInheritedConfig ? 'text-blue-500' : 'text-amber-600'}`} />

        <div className="flex-1 min-w-0">
          {renaming ? (
            <InlineEdit
              value={folder.name}
              onCommit={v => { onRename(v); setRenaming(false); }}
              onCancel={() => setRenaming(false)}
              className="w-full text-xs"
            />
          ) : (
            <span className="text-xs truncate block">{folder.name}</span>
          )}
          {(tags.length > 0 || addingTag) && (
            <TagChips
              tags={tags}
              onRemove={tag => onUpdateTags(tags.filter(t => t !== tag))}
              onAdd={tag => onUpdateTags([...tags, tag])}
              forceAdding={addingTag}
              onDoneAdding={() => setAddingTag(false)}
            />
          )}
        </div>

        <div className="shrink-0">
          <DotsBtn items={[
            { type: 'item', label: 'Run folder', icon: <PlayIcon />, onClick: onRun },
            { type: 'separator' },
            { type: 'item', label: 'Add request', icon: <PlusIcon />, onClick: onAddRequest },
            { type: 'item', label: 'Add sub-folder', icon: <FolderIcon />, onClick: onAddFolder },
            { type: 'separator' },
            { type: 'item', label: 'Settings', icon: <KeyIcon />, onClick: () => setShowSettings(true) },
            { type: 'item', label: 'Sync schemas', icon: <SyncIcon />, onClick: () => setShowSchemaSync(true) },
            { type: 'item', label: 'Add tag', icon: <TagIcon />, onClick: () => setAddingTag(true) },
            { type: 'item', label: 'Rename', icon: <PencilIcon />, onClick: () => setRenaming(true) },
            { type: 'item', label: 'Duplicate', icon: <CopyIcon />, onClick: onDuplicate },
            { type: 'separator' },
            { type: 'item', label: 'Delete folder', icon: <TrashIcon />, danger: true, onClick: onDelete },
          ]} />
        </div>
      </div>

      {expanded && children}

      {showSettings && (
        <FolderSettingsModal
          collectionId={collectionId}
          folder={folder}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showSchemaSync && (
        <SchemaSyncModal
          collectionId={collectionId}
          scope={{ type: 'folder', folderId: folder.id }}
          onClose={() => setShowSchemaSync(false)}
        />
      )}
    </div>
  );
}

// ─── Folder contents (recursive) ─────────────────────────────────────────────

function FolderContents({
  folder, collectionId, requests, activeRequestId, depth,
  expandCtrl, newRequestId,
  onSelectRequest, onAddRequest, onAddFolder,
  onRenameFolder, onDeleteFolder, onDuplicateFolder,
  onRenameRequest, onDeleteRequest, onDuplicateRequest,
  onUpdateFolderTags, onUpdateRequestTags, onSetRequestHookType, onToggleRequestDisabled, onRunFolder,
}: {
  folder: Folder
  collectionId: string
  requests: Collection['requests']
  activeRequestId: string | null
  depth: number
  expandCtrl: ExpandCtrl
  newRequestId: string | null
  onSelectRequest: (id: string) => void
  onAddRequest: (folderId: string) => void
  onAddFolder: (parentId: string, name: string) => void
  onRenameFolder: (folderId: string, name: string) => void
  onDeleteFolder: (folderId: string) => void
  onDuplicateFolder: (folderId: string) => void
  onRenameRequest: (id: string, name: string) => void
  onDeleteRequest: (id: string) => void
  onDuplicateRequest: (id: string) => void
  onUpdateFolderTags: (folderId: string, tags: string[]) => void
  onUpdateRequestTags: (requestId: string, tags: string[]) => void
  onSetRequestHookType: (requestId: string, hookType: ApiRequest['hookType']) => void
  onToggleRequestDisabled: (requestId: string) => void
  onRunFolder: (folderId: string) => void
}) {
  return (
    <>
      {folder.folders.map((sub, subIndex) => (
        <FolderRow
          key={sub.id}
          folder={sub}
          collectionId={collectionId}
          parentFolderId={folder.id}
          folderIndex={subIndex}
          depth={depth + 1}
          expandCtrl={expandCtrl}
          onAddRequest={() => onAddRequest(sub.id)}
          onAddFolder={() => onAddFolder(sub.id, 'New Folder')}
          onRename={name => onRenameFolder(sub.id, name)}
          onDelete={() => onDeleteFolder(sub.id)}
          onDuplicate={() => onDuplicateFolder(sub.id)}
          onUpdateTags={tags => onUpdateFolderTags(sub.id, tags)}
          onRun={() => onRunFolder(sub.id)}
        >
          <FolderContents
            folder={sub}
            collectionId={collectionId}
            requests={requests}
            activeRequestId={activeRequestId}
            depth={depth + 1}
            expandCtrl={expandCtrl}
            newRequestId={newRequestId}
            onSelectRequest={onSelectRequest}
            onAddRequest={onAddRequest}
            onAddFolder={onAddFolder}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
            onDuplicateFolder={onDuplicateFolder}
            onRenameRequest={onRenameRequest}
            onDeleteRequest={onDeleteRequest}
            onDuplicateRequest={onDuplicateRequest}
            onUpdateFolderTags={onUpdateFolderTags}
            onUpdateRequestTags={onUpdateRequestTags}
            onSetRequestHookType={onSetRequestHookType}
            onToggleRequestDisabled={onToggleRequestDisabled}
            onRunFolder={onRunFolder}
          />
        </FolderRow>
      ))}

      {folder.requestIds.map((reqId, reqIndex) => {
        const req = requests[reqId];
        if (!req) return null;
        return (
          <RequestRow
            key={req.id}
            reqId={req.id}
            collectionId={collectionId}
            folderId={folder.id}
            reqIndex={reqIndex}
            name={req.name}
            method={req.method}
            protocol={req.protocol}
            authType={req.auth.type}
            hookType={req.hookType}
            disabled={req.disabled}
            tags={req.meta?.tags ?? []}
            isActive={req.id === activeRequestId}
            autoRename={req.id === newRequestId}
            indent={(depth + 1) * 12 + 8}
            onSelect={() => onSelectRequest(req.id)}
            onRename={name => onRenameRequest(req.id, name)}
            onDelete={() => onDeleteRequest(req.id)}
            onDuplicate={() => onDuplicateRequest(req.id)}
            onUpdateTags={tags => onUpdateRequestTags(req.id, tags)}
            onSetHookType={ht => onSetRequestHookType(req.id, ht)}
            onToggleDisabled={() => onToggleRequestDisabled(req.id)}
          />
        );
      })}
    </>
  );
}

// ─── Micro icons ──────────────────────────────────────────────────────────────

function DotsHorizontalIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
      <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}
export function TagIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A2 2 0 013 10V5a2 2 0 012-2z" />
    </svg>
  );
}
function FolderIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={`w-3 h-3 ${className}`} fill="currentColor" viewBox="0 0 20 20">
      <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  );
}
export function PencilIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.768-6.768a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z" />
    </svg>
  );
}
export function TrashIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m2 0a1 1 0 00-1-1h-4a1 1 0 00-1 1m6 0H7" />
    </svg>
  );
}
function TableIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M10 3v18M3 6a1 1 0 011-1h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6z" />
    </svg>
  );
}
export function CopyIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}
function KeyIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a4 4 0 110 8 4 4 0 010-8zm-7 8l-1 1m0 0l-1 1m1-1l1 1M3 20l5-5" />
    </svg>
  );
}
function ExpandAllIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h8M4 18h16M15 15l3 3 3-3" />
    </svg>
  );
}
function CollapseAllIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h8M4 18h16M21 12l-3-3-3 3" />
    </svg>
  );
}

export function SyncIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.984 4.356v4.993" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
