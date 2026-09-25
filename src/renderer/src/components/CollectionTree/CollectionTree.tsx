// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useState, useRef, useEffect, useContext, createContext } from 'react';
import { useStore } from '../../store';
import type { Folder, Collection, ApiRequest, ChildRef } from '../../../../shared/types';
import { orderedChildren } from '../../../../shared/folder-tree';
import { FolderSettingsModal } from './FolderSettingsModal';
import { CollectionSettingsModal } from './CollectionSettingsModal';
import { SchemaSyncModal } from './SchemaSyncModal';
import { PushContractModal } from './PushContractModal';
import { RequestRow } from './RequestRow';
import { cloudEnabled } from '../../lib/cloud-push';
import { collectTagged } from '../../../../shared/request-collection';
import { InlineEdit } from '../common/InlineEdit';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { DotsBtn } from '../common/ContextMenu';
import {
  PlayIcon, PlusIcon, FolderIcon, TagIcon, PencilIcon, TrashIcon, TableIcon,
  CopyIcon, KeyIcon, ExpandAllIcon, CollapseAllIcon, SyncIcon, GearIcon, BanIcon,
} from '../common/icons';
import { useT } from '../../i18n';

// ─── Drag-and-drop context ────────────────────────────────────────────────────

export type DragState =
  | { type: 'request'; requestId: string; collectionId: string }
  | { type: 'folder'; folderId: string; collectionId: string }

export const DragCtx = createContext<{
  dragging: DragState | null
  setDragging: ( d: DragState | null ) => void
  onDropRequest: ( destCollectionId: string, destFolderId: string, destIndex?: number ) => void
  onDropFolder: ( destCollectionId: string, destParentFolderId: string, destIndex?: number ) => void
  /** Drop the dragged item at a unified position among a folder's children. */
  onReorderChild: ( destCollectionId: string, destParentFolderId: string, destIndex: number ) => void
}>( { dragging: null, setDragging: () => { }, onDropRequest: () => { }, onDropFolder: () => { }, onReorderChild: () => { } } );

// ─── Drop line (unified child ordering) ─────────────────────────────────────────
// A thin target between rows (and at the very top, under the collection name)
// that drops the dragged item at a specific position among a folder's children.

function DropLine ( { collectionId, parentFolderId, index, indent }: {
  collectionId: string
  parentFolderId: string
  index: number
  indent: number
} ) {
  const dragCtx = useContext( DragCtx );
  const [over, setOver] = useState( false );
  if ( !dragCtx.dragging ) return null;
  return (
    <div
      style={{ paddingLeft: indent }}
      className="relative h-2 -my-1 z-20"
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); setOver( true ); }}
      onDragLeave={() => setOver( false )}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); setOver( false ); dragCtx.onReorderChild( collectionId, parentFolderId, index ); }}
    >
      {over && <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 h-0.5 bg-blue-500 rounded pointer-events-none" />}
    </div>
  );
}

// ─── Multi-select context ─────────────────────────────────────────────────────
// Selection lives at the tree root and is read by RequestRow through context so
// it doesn't have to be threaded through every folder level. Keys pair the
// collection id with the request id (NUL-separated so ids can't collide).

export const SelectionCtx = createContext<{
  active: boolean
  isSelected: ( collectionId: string, requestId: string ) => boolean
  toggle: ( collectionId: string, requestId: string ) => void
  clear: () => void
}>( { active: false, isSelected: () => false, toggle: () => { }, clear: () => { } } );

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
  const t = useT();
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
          placeholder={t( 'tag…' )}
        />
      ) : null}
    </div>
  );
}

// ─── Root tree ────────────────────────────────────────────────────────────────

// ─── Search ──────────────────────────────────────────────────────────────────

function methodColor ( method: string ): string {
  switch ( method ) {
    case 'GET':    return 'text-emerald-400';
    case 'POST':   return 'text-amber-400';
    case 'PUT':    return 'text-sky-400';
    case 'PATCH':  return 'text-violet-400';
    case 'DELETE': return 'text-red-400';
    default:       return 'text-surface-300';
  }
}

type SearchMatch = { collectionId: string; collectionName: string; req: ApiRequest; path: string[] };

/** Walk a collection's folder tree and collect every request whose name, URL,
 *  method, or tags contain the (already lower-cased) query, remembering the
 *  folder path so the flat result can show where each request lives. */
function collectMatches ( col: Collection, q: string ): SearchMatch[] {
  const out: SearchMatch[] = [];
  const walk = ( folder: Folder, path: string[] ) => {
    for ( const reqId of folder.requestIds ) {
      const req = col.requests[reqId];
      if ( !req ) continue;
      const hay = [req.name, req.url, req.method, ...( req.meta?.tags ?? [] )].join( ' ' ).toLowerCase();
      if ( hay.includes( q ) ) out.push( { collectionId: col.id, collectionName: col.name, req, path } );
    }
    for ( const sub of folder.folders ) walk( sub, [...path, sub.name] );
  };
  walk( col.rootFolder, [] );
  return out;
}

export function CollectionTree () {
  const t = useT();
  const collections = useStore( s => s.collections );
  const activeCollectionId = useStore( s => s.activeCollectionId );
  const activeTabId = useStore( s => s.activeTabId );
  const tabs = useStore( s => s.tabs );
  const openInTab = useStore( s => s.openInTab );
  const setActiveCollection = useStore( s => s.setActiveCollection );
  const setCollectionPanelOpen = useStore( s => s.setCollectionPanelOpen );

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
  const toggleCollectionDisabled = useStore( s => s.toggleCollectionDisabled );
  const duplicateFolder = useStore( s => s.duplicateFolder );
  const updateFolderTags = useStore( s => s.updateFolderTags );
  const updateRequestTags = useStore( s => s.updateRequestTags );
  const updateRequest = useStore( s => s.updateRequest );
  const openRunner = useStore( s => s.openRunner );

  const moveRequest = useStore( s => s.moveRequest );
  const moveFolder = useStore( s => s.moveFolder );
  const reorderChild = useStore( s => s.reorderChild );

  const colList = Object.values( collections );
  const [query, setQuery] = useState( '' );
  const q = query.trim().toLowerCase();
  const matches = q ? colList.flatMap( ( { data } ) => collectMatches( data, q ) ) : [];
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; onConfirm: () => void } | null>( null );

  // ── Multi-select ──────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>( () => new Set() );
  const selKey = ( c: string, r: string ) => `${c} ${r}`;
  const selectionCtx = {
    active:     selected.size > 0,
    isSelected: ( c: string, r: string ) => selected.has( selKey( c, r ) ),
    toggle:     ( c: string, r: string ) => setSelected( prev => {
      const next = new Set( prev );
      const k = selKey( c, r );
      if ( next.has( k ) ) next.delete( k ); else next.add( k );
      return next;
    } ),
    clear:      () => setSelected( new Set() ),
  };
  function forEachSelected ( fn: ( collectionId: string, requestId: string ) => void ) {
    selected.forEach( k => { const i = k.indexOf( ' ' ); fn( k.slice( 0, i ), k.slice( i + 1 ) ); } );
  }
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

  // Drop the dragged item at a unified position among destParent's children.
  // Same-collection only; cross-collection drags fall back to appending/nesting.
  function onReorderChild ( destCollectionId: string, destParentFolderId: string, destIndex: number ) {
    if ( !dragging ) return;
    if ( dragging.collectionId === destCollectionId ) {
      const ref = dragging.type === 'folder'
        ? { type: 'folder' as const, id: dragging.folderId }
        : { type: 'request' as const, id: dragging.requestId };
      reorderChild( destCollectionId, ref, destParentFolderId, destIndex );
    } else if ( dragging.type === 'request' ) {
      moveRequest( dragging.collectionId, dragging.requestId, destCollectionId, destParentFolderId );
    }
    setDragging( null );
  }

  return (
    <DragCtx.Provider value={{ dragging, setDragging, onDropRequest, onDropFolder, onReorderChild }}>
     <SelectionCtx.Provider value={selectionCtx}>
      <div className="flex flex-col flex-1 min-h-0 select-none">
        {pendingConfirm && (
          <ConfirmDialog
            message={pendingConfirm.message}
            onConfirm={pendingConfirm.onConfirm}
            onCancel={() => setPendingConfirm( null )}
          />
        )}
        {colList.length > 0 && (
          <div className="px-2 py-1.5 border-b border-surface-800 shrink-0">
            <div className="relative">
              <input
                value={query}
                onChange={e => setQuery( e.target.value )}
                onKeyDown={e => { if ( e.key === 'Escape' ) setQuery( '' ); }}
                placeholder={t( 'Search requests…' )}
                className="w-full text-xs bg-surface-800 border border-surface-700 rounded pl-2 pr-6 py-1 focus:outline-none focus:border-blue-500 placeholder-surface-500"
              />
              {query && (
                <button
                  onClick={() => setQuery( '' )}
                  title={t( 'Clear (Esc)' )}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-surface-500 hover:text-surface-200 leading-none"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {q ? (
            matches.length === 0 ? (
              <p className="px-3 py-3 text-xs text-surface-500">
                {t( 'No requests match “:query”.', { query: query.trim() } )}
              </p>
            ) : (
              <div className="py-1">
                <p className="px-3 pb-1 text-[10px] uppercase tracking-wider text-surface-500">
                  {t( ':count match|:count matches', { count: matches.length } )}
                </p>
                {matches.map( ( { collectionId, collectionName, req, path } ) => (
                  <button
                    key={`${collectionId}:${req.id}`}
                    onClick={() => openInTab( req.id, collectionId )}
                    className={`w-full text-left flex items-baseline gap-2 px-3 py-1 hover:bg-surface-800 transition-colors ${req.id === activeRequestId ? 'bg-surface-800' : ''}`}
                  >
                    <span className={`text-[9px] font-mono font-bold w-10 shrink-0 ${methodColor( req.method )}`}>{req.method}</span>
                    <span className="flex-1 min-w-0">
                      <span className="text-xs text-surface-200 truncate block">{req.name}</span>
                      <span className="text-[10px] text-surface-500 truncate block">{[collectionName, ...path].join( ' › ' )}</span>
                    </span>
                  </button>
                ) )}
              </div>
            )
          ) : (
          <>
          {colList.map( ( { data: col } ) => (
            <CollectionNode
              key={col.id}
              col={col}
              isActive={col.id === activeCollectionId}
              activeRequestId={activeRequestId}
              existingCollectionNames={colList.map( c => c.data.name )}
              onSelectCollection={() => { setActiveCollection( col.id ); setCollectionPanelOpen( true ); }}
              onSelectRequest={( reqId ) => openInTab( reqId, col.id )}
              newRequestId={newRequestId}
              onAddRequest={folderId => setNewRequestId( addRequest( col.id, folderId ) )}
              onAddFolder={( parentId, name ) => addFolder( col.id, parentId, name )}
              onRenameCollection={name => renameCollection( col.id, name )}
              onDeleteCollection={() => confirmThen( t( 'Delete collection ":name"?', { name: col.name } ), () => deleteCollection( col.id ) )}
              onDuplicateCollection={() => duplicateCollection( col.id )}
              onToggleCollectionDisabled={() => toggleCollectionDisabled( col.id )}
              onRenameFolder={( folderId, name ) => renameFolder( col.id, folderId, name )}
              onDeleteFolder={folderId => confirmThen( t( 'Delete this folder and all its requests?' ), () => deleteFolder( col.id, folderId ) )}
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
              <p>{t( 'No collections yet.' )}</p>
              <button onClick={() => addCollection( 'New Collection' )} className="text-blue-400 hover:text-blue-300 transition-colors">
                {t( '+ New collection' )}
              </button>
              <p className="pt-1">{t( 'or import from Postman / OpenAPI above.' )}</p>
            </div>
          )}
          </>
          )}
        </div>

        {selected.size > 0 && (
          <div className="shrink-0 border-t border-surface-700 bg-surface-900 px-2 py-1.5 flex items-center gap-1 text-xs">
            <span className="text-surface-300 mr-auto">{t( ':count selected', { count: selected.size } )}</span>
            <button
              onClick={() => forEachSelected( ( _c, r ) => updateRequest( r, { disabled: false } ) )}
              className="px-2 py-0.5 rounded hover:bg-surface-800 text-surface-300 transition-colors"
              title={t( 'Enable selected requests' )}
            >{t( 'Enable' )}</button>
            <button
              onClick={() => forEachSelected( ( _c, r ) => updateRequest( r, { disabled: true } ) )}
              className="px-2 py-0.5 rounded hover:bg-surface-800 text-surface-300 transition-colors"
              title={t( 'Disable selected requests' )}
            >{t( 'Disable' )}</button>
            <button
              onClick={() => { forEachSelected( ( c, r ) => duplicateRequest( c, r ) ); selectionCtx.clear(); }}
              className="px-2 py-0.5 rounded hover:bg-surface-800 text-surface-300 transition-colors"
            >{t( 'Duplicate' )}</button>
            <button
              onClick={() => confirmThen(
                t( 'Delete :count request?|Delete :count requests?', { count: selected.size } ),
                () => { forEachSelected( ( c, r ) => deleteRequest( c, r ) ); selectionCtx.clear(); },
              )}
              className="px-2 py-0.5 rounded hover:bg-red-900/40 text-red-400 transition-colors"
            >{t( 'Delete' )}</button>
            <button
              onClick={selectionCtx.clear}
              className="px-1.5 py-0.5 rounded hover:bg-surface-800 text-surface-500 transition-colors"
              title={t( 'Clear selection' )}
            >×</button>
          </div>
        )}
      </div>
     </SelectionCtx.Provider>
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
  onRenameCollection, onDeleteCollection, onDuplicateCollection, onToggleCollectionDisabled,
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
  onToggleCollectionDisabled: () => void
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
  const t = useT();
  const [expanded, setExpanded] = useState( true );
  const [renaming, setRenaming] = useState( false );
  const [showSettings, setShowSettings] = useState( false );
  const [showSchemaSync, setShowSchemaSync] = useState( false );
  const [showPushContract, setShowPushContract] = useState( false );
  const [expandCtrl, setExpandCtrl] = useState<ExpandCtrl>( { value: true, seq: 0 } );
  const [dropOver, setDropOver] = useState( false );
  const dragCtx = useContext( DragCtx );

  function expandAll () { setExpandCtrl( c => ( { value: true, seq: c.seq + 1 } ) ); }
  function collapseAll () { setExpandCtrl( c => ( { value: false, seq: c.seq + 1 } ) ); }

  return (
    <div>
      <div
        className={`group flex items-center gap-1 px-2 py-1.5 cursor-pointer hover:bg-surface-800 transition-colors ${isActive ? 'text-[var(--text-primary)]' : 'text-surface-400'
          } ${col.disabled ? 'opacity-50' : ''} ${dropOver ? 'outline outline-1 outline-blue-500 rounded' : ''}`}
        onClick={() => { onSelectCollection(); setExpanded( e => !e ); }}
        onDragOver={dragCtx.dragging ? e => { e.preventDefault(); setDropOver( true ); } : undefined}
        onDragLeave={() => setDropOver( false )}
        onDrop={e => {
          e.preventDefault(); setDropOver( false );
          if ( dragCtx.dragging?.type === 'folder' ) dragCtx.onDropFolder( col.id, col.rootFolder.id );
          else dragCtx.onDropRequest( col.id, col.rootFolder.id );
        }}
      >
        <span className="text-[22px] leading-none w-4 h-4 shrink-0 flex items-center justify-center">{expanded ? '▾' : '▸'}</span>

        <div className="flex-1 min-w-0">
          {renaming ? (
            <InlineEdit
              value={col.name}
              onCommit={v => { onRenameCollection( v ); setRenaming( false ); }}
              onCancel={() => setRenaming( false )}
              className="w-full text-xs"
              validate={v => existingCollectionNames.filter( n => n !== col.name ).includes( v )
                ? t( '":name" already exists', { name: v } ) : null}
            />
          ) : (
            <span className="text-xs font-semibold truncate block">
              {col.name}
              {col.disabled && <span className="ml-1.5 text-[9px] uppercase tracking-wider text-surface-500 border border-surface-700 rounded px-1 py-px">{t( 'Disabled' )}</span>}
            </span>
          )}
        </div>

        <div className="shrink-0">
          <DotsBtn items={[
            { type: 'item', label: t( 'Run collection' ), icon: <PlayIcon />, onClick: onRunCollection },
            { type: 'separator' },
            { type: 'item', label: t( 'Add request' ), icon: <PlusIcon />, onClick: () => onAddRequest( col.rootFolder.id ) },
            { type: 'item', label: t( 'Add folder' ), icon: <FolderIcon />, onClick: () => onAddFolder( col.rootFolder.id, 'New Folder' ) },
            { type: 'separator' },
            { type: 'item', label: t( 'Expand all' ), icon: <ExpandAllIcon />, onClick: expandAll },
            { type: 'item', label: t( 'Collapse all' ), icon: <CollapseAllIcon />, onClick: collapseAll },
            { type: 'separator' },
            { type: 'item', label: t( 'Collection data' ), icon: <TableIcon />, onClick: onSelectCollection },
            { type: 'item', label: t( 'Settings' ), icon: <GearIcon />, onClick: () => setShowSettings( true ) },
            { type: 'item', label: t( 'Sync schemas' ), icon: <SyncIcon />, onClick: () => setShowSchemaSync( true ) },
            ...( cloudEnabled() ? [{ type: 'item' as const, label: t( 'Push contract to cloud' ), icon: <SyncIcon />, onClick: () => setShowPushContract( true ) }] : [] ),
            { type: 'item', label: col.disabled ? t( 'Enable' ) : t( 'Disable' ), icon: <BanIcon />, onClick: onToggleCollectionDisabled },
            { type: 'item', label: t( 'Rename' ), icon: <PencilIcon />, onClick: () => setRenaming( true ) },
            { type: 'item', label: t( 'Duplicate' ), icon: <CopyIcon />, onClick: onDuplicateCollection },
            { type: 'separator' },
            { type: 'item', label: t( 'Delete collection' ), icon: <TrashIcon />, danger: true, onClick: onDeleteCollection },
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
      {showPushContract && (
        <PushContractModal
          requests={collectTagged( col.rootFolder, col.requests, col.collectionVariables ?? {}, [] ).map( c => c.request )}
          defaultConsumer={col.name}
          onClose={() => setShowPushContract( false )}
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
  folder, collectionId, depth,
  expandCtrl,
  onAddRequest, onAddFolder,
  onRename, onDelete, onDuplicate,
  onUpdateTags, onRun,
  children,
}: {
  folder: Folder
  collectionId: string
  parentFolderId: string
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
  const t = useT();
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
  const [showPushContract, setShowPushContract] = useState( false );
  const [addingTag, setAddingTag] = useState( false );
  const folderCollection = useStore( s => s.collections[collectionId]?.data );
  // Dropping onto the folder body nests the dragged item inside it; positioning
  // between siblings is handled by the DropLine elements around each row.
  const [dropInside, setDropInside] = useState( false );
  const dragCtx = useContext( DragCtx );
  const tags = folder.tags ?? [];
  const indent = depth * 12 + 8;
  const hasInheritedConfig = ( folder.auth && folder.auth.type !== 'none' ) || ( folder.headers && folder.headers.length > 0 );

  function handleFolderDragOver ( e: React.DragEvent<HTMLDivElement> ) {
    if ( !dragCtx.dragging ) return;
    // Don't allow dropping a folder onto itself.
    if ( dragCtx.dragging.type === 'folder' && dragCtx.dragging.folderId === folder.id ) return;
    e.preventDefault();
    setDropInside( true );
  }

  function handleFolderDrop ( e: React.DragEvent<HTMLDivElement> ) {
    e.preventDefault();
    e.stopPropagation();
    setDropInside( false );
    if ( !dragCtx.dragging ) return;
    if ( dragCtx.dragging.type === 'folder' ) dragCtx.onDropFolder( collectionId, folder.id );
    else dragCtx.onDropRequest( collectionId, folder.id );
  }

  return (
    <div className="relative">
      <div
        draggable
        className={`group flex items-center gap-1 py-1 hover:bg-surface-800 transition-colors cursor-pointer text-surface-400 ${dropInside ? 'outline outline-1 outline-blue-500 rounded' : ''}`}
        style={{ paddingLeft: indent }}
        onClick={() => setExpanded( e => !e )}
        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); dragCtx.setDragging( { type: 'folder', folderId: folder.id, collectionId } ); }}
        onDragEnd={() => { dragCtx.setDragging( null ); setDropInside( false ); }}
        onDragOver={handleFolderDragOver}
        onDragLeave={() => setDropInside( false )}
        onDrop={handleFolderDrop}
      >
        <span className="text-[22px] leading-none w-4 h-4 shrink-0 flex items-center justify-center">{expanded ? '▾' : '▸'}</span>
        <FolderIcon className={`shrink-0 ${hasInheritedConfig ? 'text-blue-500' : 'text-amber-600'}`} />

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
            { type: 'item', label: t( 'Run folder' ), icon: <PlayIcon />, onClick: onRun },
            { type: 'separator' },
            { type: 'item', label: t( 'Add request' ), icon: <PlusIcon />, onClick: onAddRequest },
            { type: 'item', label: t( 'Add sub-folder' ), icon: <FolderIcon />, onClick: onAddFolder },
            { type: 'separator' },
            { type: 'item', label: t( 'Settings' ), icon: <KeyIcon />, onClick: () => setShowSettings( true ) },
            { type: 'item', label: t( 'Sync schemas' ), icon: <SyncIcon />, onClick: () => setShowSchemaSync( true ) },
            ...( cloudEnabled() ? [{ type: 'item' as const, label: t( 'Push contract to cloud' ), icon: <SyncIcon />, onClick: () => setShowPushContract( true ) }] : [] ),
            { type: 'item', label: t( 'Add tag' ), icon: <TagIcon />, onClick: () => setAddingTag( true ) },
            { type: 'item', label: t( 'Rename' ), icon: <PencilIcon />, onClick: () => setRenaming( true ) },
            { type: 'item', label: t( 'Duplicate' ), icon: <CopyIcon />, onClick: onDuplicate },
            { type: 'separator' },
            { type: 'item', label: t( 'Delete folder' ), icon: <TrashIcon />, danger: true, onClick: onDelete },
          ]} />
        </div>
      </div>

      {expanded && children}

      {showPushContract && folderCollection && (
        <PushContractModal
          requests={collectTagged( folder, folderCollection.requests, {}, [] ).map( c => c.request )}
          defaultConsumer={folder.name}
          onClose={() => setShowPushContract( false )}
        />
      )}
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
  // Example actions + the currently-open example are read here so they don't
  // have to be threaded through the whole folder prop chain.
  const activeExampleId  = useStore( s => { const t = s.tabs.find( x => x.id === s.activeTabId ); return t?.exampleId ?? null; } );
  const addExampleFromRequest = useStore( s => s.addExampleFromRequest );
  const openExample      = useStore( s => s.openExample );
  const renameExample    = useStore( s => s.renameExample );
  const deleteExample    = useStore( s => s.deleteExample );
  const duplicateExample = useStore( s => s.duplicateExample );

  const dropIndent = ( depth + 1 ) * 12 + 8;

  // Requests and sub-folders are rendered in one unified, drag-orderable list
  // (folder.childOrder). A drop line sits before every child and after the last,
  // so an item can be placed at any position — including above the first folder.
  const renderChild = ( child: ChildRef ) => {
    if ( child.type === 'folder' ) {
      const sub = folder.folders.find( f => f.id === child.id );
      if ( !sub ) return null;
      return (
        <FolderRow
          folder={sub}
          collectionId={collectionId}
          parentFolderId={folder.id}
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
      );
    }
    const req = requests[child.id];
    if ( !req ) return null;
    return (
      <RequestRow
        reqId={req.id}
        collectionId={collectionId}
        folderId={folder.id}
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
        examples={req.examples?.map( e => ( { id: e.id, name: e.name } ) )}
        activeExampleId={req.id === activeRequestId ? activeExampleId : null}
        onSelect={() => onSelectRequest( req.id )}
        onRename={name => onRenameRequest( req.id, name )}
        onDelete={() => onDeleteRequest( req.id )}
        onDuplicate={() => onDuplicateRequest( req.id )}
        onUpdateTags={tags => onUpdateRequestTags( req.id, tags )}
        onSetHookType={ht => onSetRequestHookType( req.id, ht )}
        onToggleDisabled={() => onToggleRequestDisabled( req.id )}
        onAddExample={() => { const exId = addExampleFromRequest( req.id ); if ( exId ) openExample( req.id, collectionId, exId ); }}
        onOpenExample={exId => openExample( req.id, collectionId, exId )}
        onRenameExample={( exId, name ) => renameExample( req.id, exId, name )}
        onDeleteExample={exId => deleteExample( req.id, exId )}
        onDuplicateExample={exId => duplicateExample( req.id, exId )}
      />
    );
  };

  const children = orderedChildren( folder );
  return (
    <>
      <DropLine collectionId={collectionId} parentFolderId={folder.id} index={0} indent={dropIndent} />
      {children.map( ( child, k ) => (
        <React.Fragment key={child.type + ':' + child.id}>
          {renderChild( child )}
          <DropLine collectionId={collectionId} parentFolderId={folder.id} index={k + 1} indent={dropIndent} />
        </React.Fragment>
      ) )}
    </>
  );
}

