import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../../store';
import type { Folder, Collection } from '../../../../shared/types';
import { MethodBadge } from '../common/MethodBadge';
import { FolderSettingsModal } from './FolderSettingsModal';

// ─── Inline rename ────────────────────────────────────────────────────────────

function InlineEdit({
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
        className={`bg-surface-700 rounded px-1 focus:outline-none focus:ring-1 w-full ${
          error ? 'ring-1 ring-red-500 focus:ring-red-500' : 'focus:ring-blue-500'
        } ${className}`}
      />
      {error && <p className="text-[10px] text-red-400 mt-0.5 px-1">{error}</p>}
    </div>
  );
}

// ─── Tag chips ────────────────────────────────────────────────────────────────

function TagChips({
  tags, onRemove, onAdd,
}: {
  tags: string[]
  onRemove: (tag: string) => void
  onAdd: (tag: string) => void
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft]   = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);

  function commit() {
    const t = draft.trim().toLowerCase();
    if (t && !tags.includes(t)) onAdd(t);
    setDraft('');
    setAdding(false);
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
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setAdding(false); setDraft(''); } e.stopPropagation(); }}
          onBlur={commit}
          className="w-16 text-[9px] bg-surface-700 rounded px-1 py-px focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="tag…"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-[9px] text-surface-400 hover:text-blue-400 px-0.5 opacity-0 group-hover:opacity-100 transition-all"
          title="Add tag"
        >+tag</button>
      )}
    </div>
  );
}

// ─── Icon button ──────────────────────────────────────────────────────────────

function IconBtn({
  title, onClick, children, danger = false, alwaysVisible = false,
}: {
  title: string
  onClick: (e: React.MouseEvent) => void
  children: React.ReactNode
  danger?: boolean
  alwaysVisible?: boolean
}) {
  return (
    <div className="relative group/tip">
      <button
        onClick={e => { e.stopPropagation(); onClick(e); }}
        className={`px-1 py-0.5 rounded transition-all ${
          alwaysVisible ? '' : 'opacity-0 group-hover:opacity-100'
        } ${danger ? 'hover:text-red-400' : 'hover:text-blue-400'} text-surface-400 hover:scale-150`}
      >
        {children}
      </button>
      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50 hidden group-hover/tip:block">
        <span className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] bg-[#1e1b2e] text-gray-300 border border-white/10 shadow-lg">
          {title}
        </span>
      </div>
    </div>
  );
}

function RunBtn({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      title="Run"
      onClick={e => { e.stopPropagation(); onClick(e); }}
      className="opacity-0 group-hover:opacity-100 px-1 py-0.5 rounded text-emerald-500 hover:text-emerald-400 transition-all"
    >
      <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"/>
      </svg>
    </button>
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
  const renameRequest     = useStore(s => s.renameRequest);
  const deleteRequest     = useStore(s => s.deleteRequest);
  const duplicateRequest  = useStore(s => s.duplicateRequest);
  const updateFolderTags  = useStore(s => s.updateFolderTags);
  const updateRequestTags = useStore(s => s.updateRequestTags);
  const openRunner        = useStore(s => s.openRunner);

  const colList = Object.values(collections);

  return (
    <div className="flex flex-col flex-1 min-h-0 select-none">
      <div className="px-3 py-2 text-xs font-semibold text-surface-400 uppercase tracking-wider flex items-center justify-between flex-shrink-0">
        <span>Collections</span>
        <button
          onClick={() => addCollection('New Collection')}
          title="New collection"
          className="text-surface-400 hover:text-blue-400 transition-colors px-1"
        >+</button>
      </div>

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
            onAddRequest={folderId => addRequest(col.id, folderId)}
            onAddFolder={(parentId, name) => addFolder(col.id, parentId, name)}
            onRenameCollection={name => renameCollection(col.id, name)}
            onDeleteCollection={() => { if (confirm(`Delete collection "${col.name}"?`)) deleteCollection(col.id); }}
            onRenameFolder={(folderId, name) => renameFolder(col.id, folderId, name)}
            onDeleteFolder={folderId => { if (confirm('Delete this folder and all its requests?')) deleteFolder(col.id, folderId); }}
            onRenameRequest={renameRequest}
            onDeleteRequest={reqId => deleteRequest(col.id, reqId)}
            onDuplicateRequest={reqId => duplicateRequest(col.id, reqId)}
            onUpdateFolderTags={(folderId, tags) => updateFolderTags(col.id, folderId, tags)}
            onUpdateRequestTags={updateRequestTags}
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
  );
}

// ─── Collection row ───────────────────────────────────────────────────────────

type ExpandCtrl = { value: boolean; seq: number };

function CollectionNode({
  col, isActive, activeRequestId,
  existingCollectionNames,
  onSelectCollection, onSelectRequest,
  onAddRequest, onAddFolder,
  onRenameCollection, onDeleteCollection,
  onRenameFolder, onDeleteFolder,
  onRenameRequest, onDeleteRequest, onDuplicateRequest,
  onUpdateFolderTags, onUpdateRequestTags,
  onRunCollection, onRunFolder,
}: {
  col: Collection
  isActive: boolean
  activeRequestId: string | null
  existingCollectionNames: string[]
  onSelectCollection: () => void
  onSelectRequest: (id: string) => void
  onAddRequest: (folderId: string) => void
  onAddFolder: (parentId: string, name: string) => void
  onRenameCollection: (name: string) => void
  onDeleteCollection: () => void
  onRenameFolder: (folderId: string, name: string) => void
  onDeleteFolder: (folderId: string) => void
  onRenameRequest: (id: string, name: string) => void
  onDeleteRequest: (id: string) => void
  onDuplicateRequest: (id: string) => void
  onUpdateFolderTags: (folderId: string, tags: string[]) => void
  onUpdateRequestTags: (requestId: string, tags: string[]) => void
  onRunCollection: () => void
  onRunFolder: (folderId: string) => void
}) {
  const [expanded, setExpanded] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [expandCtrl, setExpandCtrl] = useState<ExpandCtrl>({ value: true, seq: 0 });

  function expandAll()   { setExpandCtrl(c => ({ value: true,  seq: c.seq + 1 })); }
  function collapseAll() { setExpandCtrl(c => ({ value: false, seq: c.seq + 1 })); }

  return (
    <div>
      <div
        className={`group flex items-start gap-1 px-2 py-1.5 cursor-pointer hover:bg-surface-800 transition-colors ${
          isActive ? 'text-[var(--text-primary)]' : 'text-surface-400'
        }`}
        onClick={() => { onSelectCollection(); setExpanded(e => !e); }}
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

        <div className="flex items-center shrink-0 gap-0">
          <RunBtn onClick={onRunCollection} />
          <IconBtn title="Expand all folders" onClick={expandAll}><ExpandAllIcon /></IconBtn>
          <IconBtn title="Collapse all folders" onClick={collapseAll}><CollapseAllIcon /></IconBtn>
          <IconBtn title="Collection data (iterations)" onClick={onSelectCollection}><TableIcon /></IconBtn>
          <IconBtn title="Add request" onClick={() => onAddRequest(col.rootFolder.id)}><span className="text-xs">+</span></IconBtn>
          <IconBtn title="Add folder" onClick={() => onAddFolder(col.rootFolder.id, 'New Folder')}><FolderIcon /></IconBtn>
          <IconBtn title="Rename" onClick={() => setRenaming(true)}><PencilIcon /></IconBtn>
          <IconBtn title="Delete collection" onClick={onDeleteCollection} danger><TrashIcon /></IconBtn>
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
          onRenameRequest={onRenameRequest}
          onDeleteRequest={onDeleteRequest}
          onDuplicateRequest={onDuplicateRequest}
          onUpdateFolderTags={onUpdateFolderTags}
          onUpdateRequestTags={onUpdateRequestTags}
          onRunFolder={onRunFolder}
        />
      )}
    </div>
  );
}

// ─── Folder row ───────────────────────────────────────────────────────────────

function FolderRow({
  folder, collectionId, depth,
  expandCtrl,
  onAddRequest, onAddFolder,
  onRename, onDelete,
  onUpdateTags, onRun,
  children,
}: {
  folder: Folder
  collectionId: string
  depth: number
  expandCtrl: ExpandCtrl
  onAddRequest: () => void
  onAddFolder: () => void
  onRename: (name: string) => void
  onDelete: () => void
  onUpdateTags: (tags: string[]) => void
  onRun: () => void
  children: React.ReactNode
}) {
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    if (expandCtrl.seq > 0) setExpanded(expandCtrl.value);
  }, [expandCtrl.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  const [renaming, setRenaming] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const tags = folder.tags ?? [];
  const indent = depth * 12 + 8;
  const hasInheritedConfig = (folder.auth && folder.auth.type !== 'none') || (folder.headers && folder.headers.length > 0);

  return (
    <div>
      <div
        className="group flex items-start gap-1 py-1 hover:bg-surface-800 transition-colors cursor-pointer text-surface-400"
        style={{ paddingLeft: indent }}
        onClick={() => setExpanded(e => !e)}
      >
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
          {tags.length > 0 && (
            <TagChips
              tags={tags}
              onRemove={tag => onUpdateTags(tags.filter(t => t !== tag))}
              onAdd={tag => onUpdateTags([...tags, tag])}
            />
          )}
        </div>

        <div className="flex items-center shrink-0 gap-0">
          <RunBtn onClick={onRun} />
          <IconBtn title="Add request" onClick={onAddRequest}><span className="text-xs">+</span></IconBtn>
          <IconBtn title="Add sub-folder" onClick={onAddFolder}><FolderIcon /></IconBtn>
          <IconBtn title="Folder auth &amp; headers" onClick={() => setShowSettings(true)}>
            <KeyIcon />
          </IconBtn>
          <IconBtn title="Add tag" onClick={() => {}} alwaysVisible={false}>
            <TagChips tags={[]} onRemove={() => {}} onAdd={tag => onUpdateTags([...tags, tag])} />
          </IconBtn>
          <IconBtn title="Rename" onClick={() => setRenaming(true)}><PencilIcon /></IconBtn>
          <IconBtn title="Delete folder" onClick={onDelete} danger><TrashIcon /></IconBtn>
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
    </div>
  );
}

// ─── Folder contents (recursive) ─────────────────────────────────────────────

function FolderContents({
  folder, collectionId, requests, activeRequestId, depth,
  expandCtrl,
  onSelectRequest, onAddRequest, onAddFolder,
  onRenameFolder, onDeleteFolder,
  onRenameRequest, onDeleteRequest, onDuplicateRequest,
  onUpdateFolderTags, onUpdateRequestTags, onRunFolder,
}: {
  folder: Folder
  collectionId: string
  requests: Collection['requests']
  activeRequestId: string | null
  depth: number
  expandCtrl: ExpandCtrl
  onSelectRequest: (id: string) => void
  onAddRequest: (folderId: string) => void
  onAddFolder: (parentId: string, name: string) => void
  onRenameFolder: (folderId: string, name: string) => void
  onDeleteFolder: (folderId: string) => void
  onRenameRequest: (id: string, name: string) => void
  onDeleteRequest: (id: string) => void
  onDuplicateRequest: (id: string) => void
  onUpdateFolderTags: (folderId: string, tags: string[]) => void
  onUpdateRequestTags: (requestId: string, tags: string[]) => void
  onRunFolder: (folderId: string) => void
}) {
  return (
    <>
      {folder.folders.map(sub => (
        <FolderRow
          key={sub.id}
          folder={sub}
          collectionId={collectionId}
          depth={depth + 1}
          expandCtrl={expandCtrl}
          onAddRequest={() => onAddRequest(sub.id)}
          onAddFolder={() => onAddFolder(sub.id, 'New Folder')}
          onRename={name => onRenameFolder(sub.id, name)}
          onDelete={() => onDeleteFolder(sub.id)}
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
            onSelectRequest={onSelectRequest}
            onAddRequest={onAddRequest}
            onAddFolder={onAddFolder}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
            onRenameRequest={onRenameRequest}
            onDeleteRequest={onDeleteRequest}
            onDuplicateRequest={onDuplicateRequest}
            onUpdateFolderTags={onUpdateFolderTags}
            onUpdateRequestTags={onUpdateRequestTags}
            onRunFolder={onRunFolder}
          />
        </FolderRow>
      ))}

      {folder.requestIds.map(reqId => {
        const req = requests[reqId];
        if (!req) return null;
        return (
          <RequestRow
            key={req.id}
            reqId={req.id}
            name={req.name}
            method={req.method}
            tags={req.meta?.tags ?? []}
            isActive={req.id === activeRequestId}
            indent={(depth + 1) * 12 + 8}
            onSelect={() => onSelectRequest(req.id)}
            onRename={name => onRenameRequest(req.id, name)}
            onDelete={() => onDeleteRequest(req.id)}
            onDuplicate={() => onDuplicateRequest(req.id)}
            onUpdateTags={tags => onUpdateRequestTags(req.id, tags)}
          />
        );
      })}
    </>
  );
}

// ─── Request row ──────────────────────────────────────────────────────────────

function RequestRow({
  reqId: _reqId, name, method, tags, isActive, indent,
  onSelect, onRename, onDelete, onDuplicate, onUpdateTags,
}: {
  reqId: string
  name: string
  method: string
  tags: string[]
  isActive: boolean
  indent: number
  onSelect: () => void
  onRename: (name: string) => void
  onDelete: () => void
  onDuplicate: () => void
  onUpdateTags: (tags: string[]) => void
}) {
  const [renaming, setRenaming] = useState(false);

  return (
    <div
      className={`group flex items-start gap-1.5 py-1 pr-1 rounded-sm cursor-pointer transition-colors ${
        isActive ? 'bg-surface-800 text-[var(--text-primary)]' : 'text-surface-300 hover:bg-surface-800'
      }`}
      style={{ paddingLeft: indent }}
      onClick={onSelect}
      onDoubleClick={() => setRenaming(true)}
    >
      <MethodBadge method={method} size="xs" />

      <div className="flex-1 min-w-0">
        {renaming ? (
          <InlineEdit
            value={name}
            onCommit={v => { onRename(v); setRenaming(false); }}
            onCancel={() => setRenaming(false)}
            className="w-full text-xs"
          />
        ) : (
          <span className="text-xs truncate block">{name}</span>
        )}
        {tags.length > 0 && (
          <TagChips
            tags={tags}
            onRemove={tag => onUpdateTags(tags.filter(t => t !== tag))}
            onAdd={tag => onUpdateTags([...tags, tag])}
          />
        )}
      </div>

      <div className="flex items-center shrink-0 gap-0">
        {tags.length === 0 && (
          <span className="opacity-0 group-hover:opacity-100 transition-all" onClick={e => e.stopPropagation()}>
            <TagChips tags={[]} onRemove={() => {}} onAdd={tag => onUpdateTags([tag])} />
          </span>
        )}
        <IconBtn title="Rename" onClick={() => setRenaming(true)}><PencilIcon /></IconBtn>
        <IconBtn title="Duplicate" onClick={onDuplicate}><CopyIcon /></IconBtn>
        <IconBtn title="Delete" onClick={onDelete} danger><TrashIcon /></IconBtn>
      </div>
    </div>
  );
}

// ─── Micro icons ──────────────────────────────────────────────────────────────

function FolderIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={`w-3 h-3 ${className}`} fill="currentColor" viewBox="0 0 20 20">
      <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.768-6.768a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z" />
    </svg>
  );
}
function TrashIcon() {
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
function CopyIcon() {
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
