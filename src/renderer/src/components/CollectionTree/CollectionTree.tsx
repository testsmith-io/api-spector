// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useState, useRef, useEffect, useContext, createContext } from 'react';
import { useStore } from '../../store';
import type { Folder, Collection, ApiRequest } from '../../../../shared/types';
import { FolderSettingsModal } from './FolderSettingsModal';
import { CollectionSettingsModal } from './CollectionSettingsModal';
import { SchemaSyncModal } from './SchemaSyncModal';
import { RequestRow } from './RequestRow';
import { InlineEdit } from '../common/InlineEdit';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { DotsBtn } from '../common/ContextMenu';
import {
  PlayIcon, PlusIcon, FolderIcon, TagIcon, PencilIcon, TrashIcon, TableIcon,
  CopyIcon, KeyIcon, ExpandAllIcon, CollapseAllIcon, SyncIcon, GearIcon,
} from '../common/icons';

// ─── Drag-and-drop context ────────────────────────────────────────────────────

export type DragState =
  | { type: 'request'; requestId: string; collectionId: string }
  | { type: 'folder'; folderId: string; collectionId: string }

export const DragCtx = createContext<{
  dragging: DragState | null
  setDragging: ( d: DragState | null ) => void
  onDropRequest: ( destCollectionId: string, destFolderId: string, destIndex?: number ) => void
  onDropFolder: ( destCollectionId: string, destParentFolderId: string, destIndex?: number ) => void
}>( { dragging: null, setDragging: () => { }, onDropRequest: () => { }, onDropFolder: () => { } } );

// ─── Tag chips ────────────────────────────────────────────────────────────────

export function TagChips ( {
  tags, onRemove, onAdd, forceAdding = false, onDoneAdding,
}: {
  tags: string[]
  onRemove: ( tag: string ) => void
  onAdd: ( tag: string ) => void
  forceAdding?: boolean
  onDoneAdding?: () => void
} ) {
  const [adding, setAdding] = useState( false );
  const [draft, setDraft] = useState( '' );
  const inputRef = useRef<HTMLInputElement>( null );
  useEffect( () => { if ( adding ) inputRef.current?.focus(); }, [adding] );
  useEffect( () => { if ( forceAdding ) setAdding( true ); }, [forceAdding] );

  function commit () {
    // Preserve case as typed. Tag matching at run-time is case-sensitive
    // (see request-collection.ts), so lowercasing here would silently make
    // tags entered as e.g. "Smoke" un-runnable via `--tags Smoke`.
    const t = draft.trim();
    if ( t && !tags.includes( t ) ) onAdd( t );
    setDraft( '' );
    setAdding( false );
    onDoneAdding?.();
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 mt-0.5" onClick={e => e.stopPropagation()}>
      {tags.map( tag => (
        <span
          key={tag}
          className="flex items-center gap-0.5 px-1 py-px rounded text-[9px] bg-blue-900/50 text-blue-300 border border-blue-800/50"
        >
          {tag}
          <button
            onClick={() => onRemove( tag )}
            className="hover:text-red-400 leading-none ml-0.5"
          >×</button>
        </span>
      ) )}
      {adding ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft( e.target.value )}
          onKeyDown={e => { if ( e.key === 'Enter' ) commit(); if ( e.key === 'Escape' ) { setAdding( false ); setDraft( '' ); onDoneAdding?.(); } e.stopPropagation(); }}
          onBlur={commit}
          className="w-16 text-[9px] bg-surface-700 rounded px-1 py-px focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="tag…"
        />
      ) : null}
    </div>
  );
}

// ─── Root tree ────────────────────────────────────────────────────────────────

export function CollectionTree () {
  const collections = useStore( s => s.collections );
  const activeCollectionId = useStore( s => s.activeCollectionId );
  const activeTabId = useStore( s => s.activeTabId );
  const tabs = useStore( s => s.tabs );
  const openInTab = useStore( s => s.openInTab );
  const setActiveCollection = useStore( s => s.setActiveCollection );

  // Derive the active request id from the active tab
  const activeRequestId = tabs.find( t => t.id === activeTabId )?.requestId ?? null;
  const addCollection = useStore( s => s.addCollection );
  const addRequest = useStore( s => s.addRequest );
  const addFolder = useStore( s => s.addFolder );
  const renameCollection = useStore( s => s.renameCollection );
  const deleteCollection = useStore( s => s.deleteCollection );
  const renameFolder = useStore( s => s.renameFolder );
  const deleteFolder = useStore( s => s.deleteFolder );
  const renameRequest = useStore( s => s.renameRequest );
  const deleteRequest = useStore( s => s.deleteRequest );
  const duplicateRequest = useStore( s => s.duplicateRequest );
  const duplicateCollection = useStore( s => s.duplicateCollection );
  const duplicateFolder = useStore( s => s.duplicateFolder );
  const updateFolderTags = useStore( s => s.updateFolderTags );
  const updateRequestTags = useStore( s => s.updateRequestTags );
  const updateRequest = useStore( s => s.updateRequest );
  const openRunner = useStore( s => s.openRunner );

  const moveRequest = useStore( s => s.moveRequest );
  const moveFolder = useStore( s => s.moveFolder );

  const colList = Object.values( collections );
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; onConfirm: () => void } | null>( null );
  const [newRequestId, setNewRequestId] = useState<string | null>( null );
  const [dragging, setDragging] = useState<DragState | null>( null );

  function confirmThen ( message: string, action: () => void ) {
    setPendingConfirm( { message, onConfirm: () => { action(); setPendingConfirm( null ); } } );
  }

  function onDropRequest ( destCollectionId: string, destFolderId: string, destIndex?: number ) {
    if ( !dragging || dragging.type !== 'request' ) return;
    moveRequest( dragging.collectionId, dragging.requestId, destCollectionId, destFolderId, destIndex );
    setDragging( null );
  }

  function onDropFolder ( destCollectionId: string, destParentFolderId: string, destIndex?: number ) {
    if ( !dragging || dragging.type !== 'folder' ) return;
    if ( dragging.collectionId !== destCollectionId ) return;  // cross-collection folder moves not supported
    moveFolder( dragging.collectionId, dragging.folderId, destParentFolderId, destIndex );
    setDragging( null );
  }

  return (
    <DragCtx.Provider value={{ dragging, setDragging, onDropRequest, onDropFolder }}>
      <div className="flex flex-col flex-1 min-h-0 select-none">
        {pendingConfirm && (
          <ConfirmDialog
            message={pendingConfirm.message}
            onConfirm={pendingConfirm.onConfirm}
            onCancel={() => setPendingConfirm( null )}
          />
        )}
        <div className="flex-1 overflow-y-auto">
          {colList.map( ( { data: col } ) => (
            <CollectionNode
              key={col.id}
              col={col}
              isActive={col.id === activeCollectionId}
              activeRequestId={activeRequestId}
              existingCollectionNames={colList.map( c => c.data.name )}
              onSelectCollection={() => setActiveCollection( col.id )}
              onSelectRequest={( reqId ) => openInTab( reqId, col.id )}
              newRequestId={newRequestId}
              onAddRequest={folderId => setNewRequestId( addRequest( col.id, folderId ) )}
              onAddFolder={( parentId, name ) => addFolder( col.id, parentId, name )}
              onRenameCollection={name => renameCollection( col.id, name )}
              onDeleteCollection={() => confirmThen( `Delete collection "${col.name}"?`, () => deleteCollection( col.id ) )}
              onDuplicateCollection={() => duplicateCollection( col.id )}
              onRenameFolder={( folderId, name ) => renameFolder( col.id, folderId, name )}
              onDeleteFolder={folderId => confirmThen( 'Delete this folder and all its requests?', () => deleteFolder( col.id, folderId ) )}
              onDuplicateFolder={folderId => duplicateFolder( col.id, folderId )}
              onRenameRequest={renameRequest}
              onDeleteRequest={reqId => deleteRequest( col.id, reqId )}
              onDuplicateRequest={reqId => duplicateRequest( col.id, reqId )}
              onUpdateFolderTags={( folderId, tags ) => updateFolderTags( col.id, folderId, tags )}
              onUpdateRequestTags={updateRequestTags}
              onSetRequestHookType={( reqId, hookType ) => updateRequest( reqId, { hookType } )}
              onToggleRequestDisabled={reqId => {
                const r = col.requests[reqId];
                if ( r ) updateRequest( reqId, { disabled: !r.disabled } );
              }}
              onRunCollection={() => openRunner( col.id )}
              onRunFolder={folderId => openRunner( col.id, folderId )}
            />
          ) )}

          {colList.length === 0 && (
            <div className="px-3 py-4 text-xs text-surface-400 space-y-1">
              <p>No collections yet.</p>
              <button onClick={() => addCollection( 'New Collection' )} className="text-blue-400 hover:text-blue-300 transition-colors">
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

function CollectionNode ( {
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
  onSelectRequest: ( id: string ) => void
  onAddRequest: ( folderId: string ) => void
  onAddFolder: ( parentId: string, name: string ) => void
  onRenameCollection: ( name: string ) => void
  onDeleteCollection: () => void
  onDuplicateCollection: () => void
  onRenameFolder: ( folderId: string, name: string ) => void
  onDeleteFolder: ( folderId: string ) => void
  onDuplicateFolder: ( folderId: string ) => void
  onRenameRequest: ( id: string, name: string ) => void
  onDeleteRequest: ( id: string ) => void
  onDuplicateRequest: ( id: string ) => void
  onUpdateFolderTags: ( folderId: string, tags: string[] ) => void
  onUpdateRequestTags: ( requestId: string, tags: string[] ) => void
  onSetRequestHookType: ( requestId: string, hookType: ApiRequest['hookType'] ) => void
  onToggleRequestDisabled: ( requestId: string ) => void
  onRunCollection: () => void
  onRunFolder: ( folderId: string ) => void
} ) {
  const [expanded, setExpanded] = useState( true );
  const [renaming, setRenaming] = useState( false );
  const [showSettings, setShowSettings] = useState( false );
  const [showSchemaSync, setShowSchemaSync] = useState( false );
  const [expandCtrl, setExpandCtrl] = useState<ExpandCtrl>( { value: true, seq: 0 } );
  const [dropOver, setDropOver] = useState( false );
  const dragCtx = useContext( DragCtx );

  function expandAll () { setExpandCtrl( c => ( { value: true, seq: c.seq + 1 } ) ); }
  function collapseAll () { setExpandCtrl( c => ( { value: false, seq: c.seq + 1 } ) ); }

  return (
    <div>
      <div
        className={`group flex items-start gap-1 px-2 py-1.5 cursor-pointer hover:bg-surface-800 transition-colors ${isActive ? 'text-[var(--text-primary)]' : 'text-surface-400'
          } ${dropOver ? 'outline outline-1 outline-blue-500 rounded' : ''}`}
        onClick={() => { onSelectCollection(); setExpanded( e => !e ); }}
        onDragOver={dragCtx.dragging ? e => { e.preventDefault(); setDropOver( true ); } : undefined}
        onDragLeave={() => setDropOver( false )}
        onDrop={e => {
          e.preventDefault(); setDropOver( false );
          if ( dragCtx.dragging?.type === 'folder' ) dragCtx.onDropFolder( col.id, col.rootFolder.id );
          else dragCtx.onDropRequest( col.id, col.rootFolder.id );
        }}
      >
        <span className="text-[10px] w-3 text-center shrink-0 mt-0.5">{expanded ? '▾' : '▸'}</span>

        <div className="flex-1 min-w-0">
          {renaming ? (
            <InlineEdit
              value={col.name}
              onCommit={v => { onRenameCollection( v ); setRenaming( false ); }}
              onCancel={() => setRenaming( false )}
              className="w-full text-xs"
              validate={v => existingCollectionNames.filter( n => n !== col.name ).includes( v )
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
            { type: 'item', label: 'Add request', icon: <PlusIcon />, onClick: () => onAddRequest( col.rootFolder.id ) },
            { type: 'item', label: 'Add folder', icon: <FolderIcon />, onClick: () => onAddFolder( col.rootFolder.id, 'New Folder' ) },
            { type: 'separator' },
            { type: 'item', label: 'Expand all', icon: <ExpandAllIcon />, onClick: expandAll },
            { type: 'item', label: 'Collapse all', icon: <CollapseAllIcon />, onClick: collapseAll },
            { type: 'separator' },
            { type: 'item', label: 'Collection data', icon: <TableIcon />, onClick: onSelectCollection },
            { type: 'item', label: 'Settings', icon: <GearIcon />, onClick: () => setShowSettings( true ) },
            { type: 'item', label: 'Sync schemas', icon: <SyncIcon />, onClick: () => setShowSchemaSync( true ) },
            { type: 'item', label: 'Rename', icon: <PencilIcon />, onClick: () => setRenaming( true ) },
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
        <CollectionSettingsModal collection={col} onClose={() => setShowSettings( false )} />
      )}
      {showSchemaSync && (
        <SchemaSyncModal collectionId={col.id} scope={{ type: 'collection' }} onClose={() => setShowSchemaSync( false )} />
      )}
    </div>
  );
}

// ─── Folder row ───────────────────────────────────────────────────────────────

function FolderRow ( {
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
  onRename: ( name: string ) => void
  onDelete: () => void
  onDuplicate: () => void
  onUpdateTags: ( tags: string[] ) => void
  onRun: () => void
  children: React.ReactNode
} ) {
  // Folders start collapsed so expanding a collection doesn't blow the whole
  // tree open. The user can still use "Expand all" from the collection
  // context menu, which propagates through expandCtrl.
  const [expanded, setExpanded] = useState( false );
  useEffect( () => {
    if ( expandCtrl.seq > 0 ) setExpanded( expandCtrl.value );
  }, [expandCtrl.seq] ); // eslint-disable-line react-hooks/exhaustive-deps
  const [renaming, setRenaming] = useState( false );
  const [showSettings, setShowSettings] = useState( false );
  const [showSchemaSync, setShowSchemaSync] = useState( false );
  const [addingTag, setAddingTag] = useState( false );
  const [dropPos, setDropPos] = useState<'before' | 'inside' | 'after' | null>( null );
  const dragCtx = useContext( DragCtx );
  const tags = folder.tags ?? [];
  const indent = depth * 12 + 8;
  const hasInheritedConfig = ( folder.auth && folder.auth.type !== 'none' ) || ( folder.headers && folder.headers.length > 0 );

  function handleFolderDragOver ( e: React.DragEvent<HTMLDivElement> ) {
    if ( !dragCtx.dragging ) return;
    // Don't allow dropping a folder onto itself
    if ( dragCtx.dragging.type === 'folder' && dragCtx.dragging.folderId === folder.id ) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const zone = y / rect.height;
    if ( dragCtx.dragging.type === 'folder' ) {
      // Folders can be reordered (before/after) or nested (inside)
      if ( zone < 0.25 ) setDropPos( 'before' );
      else if ( zone > 0.75 ) setDropPos( 'after' );
      else setDropPos( 'inside' );
    } else {
      // Requests always drop inside the folder
      setDropPos( 'inside' );
    }
  }

  function handleFolderDrop ( e: React.DragEvent<HTMLDivElement> ) {
    e.preventDefault();
    e.stopPropagation();
    if ( !dragCtx.dragging ) return;
    if ( dragCtx.dragging.type === 'folder' ) {
      if ( dropPos === 'inside' ) {
        dragCtx.onDropFolder( collectionId, folder.id );
      } else {
        const insertIndex = dropPos === 'before' ? folderIndex : folderIndex + 1;
        dragCtx.onDropFolder( collectionId, parentFolderId, insertIndex );
      }
    } else {
      dragCtx.onDropRequest( collectionId, folder.id );
    }
    setDropPos( null );
  }

  return (
    <div className="relative">
      {dropPos === 'before' && <div className="absolute top-0 inset-x-0 h-0.5 bg-blue-500 z-10 pointer-events-none" />}
      <div
        draggable
        className={`group flex items-start gap-1 py-1 hover:bg-surface-800 transition-colors cursor-pointer text-surface-400 ${dropPos === 'inside' ? 'outline outline-1 outline-blue-500 rounded' : ''}`}
        style={{ paddingLeft: indent }}
        onClick={() => setExpanded( e => !e )}
        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); dragCtx.setDragging( { type: 'folder', folderId: folder.id, collectionId } ); }}
        onDragEnd={() => { dragCtx.setDragging( null ); setDropPos( null ); }}
        onDragOver={handleFolderDragOver}
        onDragLeave={() => setDropPos( null )}
        onDrop={handleFolderDrop}
      >
        {dropPos === 'after' && <div className="absolute bottom-0 inset-x-0 h-0.5 bg-blue-500 z-10 pointer-events-none" />}
        <span className="text-[10px] w-3 text-center shrink-0 mt-0.5">{expanded ? '▾' : '▸'}</span>
        <FolderIcon className={`shrink-0 mt-0.5 ${hasInheritedConfig ? 'text-blue-500' : 'text-amber-600'}`} />

        <div className="flex-1 min-w-0">
          {renaming ? (
            <InlineEdit
              value={folder.name}
              onCommit={v => { onRename( v ); setRenaming( false ); }}
              onCancel={() => setRenaming( false )}
              className="w-full text-xs"
            />
          ) : (
            <span className="text-xs truncate block">{folder.name}</span>
          )}
          {( tags.length > 0 || addingTag ) && (
            <TagChips
              tags={tags}
              onRemove={tag => onUpdateTags( tags.filter( t => t !== tag ) )}
              onAdd={tag => onUpdateTags( [...tags, tag] )}
              forceAdding={addingTag}
              onDoneAdding={() => setAddingTag( false )}
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
            { type: 'item', label: 'Settings', icon: <KeyIcon />, onClick: () => setShowSettings( true ) },
            { type: 'item', label: 'Sync schemas', icon: <SyncIcon />, onClick: () => setShowSchemaSync( true ) },
            { type: 'item', label: 'Add tag', icon: <TagIcon />, onClick: () => setAddingTag( true ) },
            { type: 'item', label: 'Rename', icon: <PencilIcon />, onClick: () => setRenaming( true ) },
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
          onClose={() => setShowSettings( false )}
        />
      )}
      {showSchemaSync && (
        <SchemaSyncModal
          collectionId={collectionId}
          scope={{ type: 'folder', folderId: folder.id }}
          onClose={() => setShowSchemaSync( false )}
        />
      )}
    </div>
  );
}

// ─── Folder contents (recursive) ─────────────────────────────────────────────

function FolderContents ( {
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
  onSelectRequest: ( id: string ) => void
  onAddRequest: ( folderId: string ) => void
  onAddFolder: ( parentId: string, name: string ) => void
  onRenameFolder: ( folderId: string, name: string ) => void
  onDeleteFolder: ( folderId: string ) => void
  onDuplicateFolder: ( folderId: string ) => void
  onRenameRequest: ( id: string, name: string ) => void
  onDeleteRequest: ( id: string ) => void
  onDuplicateRequest: ( id: string ) => void
  onUpdateFolderTags: ( folderId: string, tags: string[] ) => void
  onUpdateRequestTags: ( requestId: string, tags: string[] ) => void
  onSetRequestHookType: ( requestId: string, hookType: ApiRequest['hookType'] ) => void
  onToggleRequestDisabled: ( requestId: string ) => void
  onRunFolder: ( folderId: string ) => void
} ) {
  return (
    <>
      {folder.folders.map( ( sub, subIndex ) => (
        <FolderRow
          key={sub.id}
          folder={sub}
          collectionId={collectionId}
          parentFolderId={folder.id}
          folderIndex={subIndex}
          depth={depth + 1}
          expandCtrl={expandCtrl}
          onAddRequest={() => onAddRequest( sub.id )}
          onAddFolder={() => onAddFolder( sub.id, 'New Folder' )}
          onRename={name => onRenameFolder( sub.id, name )}
          onDelete={() => onDeleteFolder( sub.id )}
          onDuplicate={() => onDuplicateFolder( sub.id )}
          onUpdateTags={tags => onUpdateFolderTags( sub.id, tags )}
          onRun={() => onRunFolder( sub.id )}
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
      ) )}

      {folder.requestIds.map( ( reqId, reqIndex ) => {
        const req = requests[reqId];
        if ( !req ) return null;
        return (
          <RequestRow
            key={req.id}
            reqId={req.id}
            collectionId={collectionId}
            folderId={folder.id}
            reqIndex={reqIndex}
            name={req.name}
            url={req.url}
            method={req.method}
            protocol={req.protocol}
            authType={req.auth.type}
            hookType={req.hookType}
            disabled={req.disabled}
            tags={req.meta?.tags ?? []}
            isActive={req.id === activeRequestId}
            autoRename={req.id === newRequestId}
            indent={( depth + 1 ) * 12 + 8}
            onSelect={() => onSelectRequest( req.id )}
            onRename={name => onRenameRequest( req.id, name )}
            onDelete={() => onDeleteRequest( req.id )}
            onDuplicate={() => onDuplicateRequest( req.id )}
            onUpdateTags={tags => onUpdateRequestTags( req.id, tags )}
            onSetHookType={ht => onSetRequestHookType( req.id, ht )}
            onToggleDisabled={() => onToggleRequestDisabled( req.id )}
          />
        );
      } )}
    </>
  );
}

