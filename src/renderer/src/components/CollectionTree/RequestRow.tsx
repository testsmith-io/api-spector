// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useContext, useState } from 'react';
import type { ApiRequest } from '../../../../shared/types';
import { MethodBadge } from '../common/MethodBadge';
import { SchemaSyncModal } from './SchemaSyncModal';
import { DragCtx, SelectionCtx, TagChips } from './CollectionTree';
import { InlineEdit } from '../common/InlineEdit';
import { type MenuItem, DotsBtn } from '../common/ContextMenu';
import { PencilIcon, CopyIcon, TagIcon, SyncIcon, TrashIcon } from '../common/icons';
import { useStore } from '../../store';
import { useToast, Toast } from '../common/Toast';
import { pushRequestAsMonitor, cloudEnabled } from '../../lib/cloud-push';

/** The path portion of a request URL, for showing under the name in the tree.
 *  Strips a leading {{baseUrl}} token and the scheme+host so an imported
 *  request reads as "/pets/{id}" rather than its vendor description. */
function requestPath(url: string): string {
  const trimmed = url.trim()
    .replace(/^\{\{[^}]+\}\}/, '')     // leading {{baseUrl}} variable
    .replace(/^https?:\/\/[^/]+/i, ''); // scheme + host
  return trimmed || url.trim();
}

// ─── Constants ───────────────────────────────────────────────────────────────

const HOOK_LABELS: Record<NonNullable<ApiRequest['hookType']>, string> = {
  beforeAll: 'Before All',
  before:    'Before',
  after:     'After',
  afterAll:  'After All',
};

const HOOK_COLORS: Record<NonNullable<ApiRequest['hookType']>, string> = {
  beforeAll: 'bg-violet-700 text-white',
  before:    'bg-violet-600 text-white',
  after:     'bg-cyan-700 text-white',
  afterAll:  'bg-cyan-800 text-white',
};

const AUTH_BADGE_LABELS: Record<string, string> = {
  basic:   'Basic',
  bearer:  'Bearer',
  apikey:  'Key',
  digest:  'Digest',
  ntlm:    'NTLM',
  oauth2:  'OAuth2',
};

// ─── RequestRow ──────────────────────────────────────────────────────────────

export interface RequestRowProps {
  reqId: string
  collectionId: string
  folderId: string
  reqIndex: number
  name: string
  url: string
  method: string
  protocol?: ApiRequest['protocol']
  authType: string
  hookType?: ApiRequest['hookType']
  disabled?: boolean
  tags: string[]
  isActive: boolean
  indent: number
  autoRename?: boolean
  examples?: { id: string; name: string }[]
  activeExampleId?: string | null
  onSelect: () => void
  onRename: (name: string) => void
  onDelete: () => void
  onDuplicate: () => void
  onUpdateTags: (tags: string[]) => void
  onSetHookType: (ht: ApiRequest['hookType']) => void
  onToggleDisabled: () => void
  onAddExample?: () => void
  onOpenExample?: (exampleId: string) => void
  onRenameExample?: (exampleId: string, name: string) => void
  onDeleteExample?: (exampleId: string) => void
  onDuplicateExample?: (exampleId: string) => void
}

export function RequestRow({
  reqId, collectionId, folderId, reqIndex, name, url, method, protocol, authType, hookType, disabled, tags, isActive, indent, autoRename = false,
  examples = [], activeExampleId,
  onSelect, onRename, onDelete, onDuplicate, onUpdateTags, onSetHookType, onToggleDisabled,
  onAddExample, onOpenExample, onRenameExample, onDeleteExample, onDuplicateExample,
}: RequestRowProps) {
  const [renaming, setRenaming] = useState(autoRename);
  const [examplesOpen, setExamplesOpen] = useState(true);
  const [addingTag, setAddingTag] = useState(false);
  const [showSchemaSync, setShowSchemaSync] = useState(false);
  const [dropPos, setDropPos] = useState<'before' | 'after' | null>(null);
  const dragCtx = useContext(DragCtx);
  const sel = useContext(SelectionCtx);
  const selected = sel.isSelected(collectionId, reqId);
  const { toast, show } = useToast();

  // Cmd/Ctrl+click toggles this request into the multi-selection instead of
  // opening it; a plain click clears any selection and opens as before.
  function handleRowClick(e: React.MouseEvent) {
    if (e.metaKey || e.ctrlKey) { e.preventDefault(); sel.toggle(collectionId, reqId); return; }
    if (sel.active) sel.clear();
    onSelect();
  }

  async function pushMonitor() {
    const req = useStore.getState().collections[collectionId]?.data.requests[reqId];
    if (!req) return;
    try {
      const r = await pushRequestAsMonitor(req);
      show(`Pushed "${req.name}" as monitor #${r.id} to the cloud`, true);
    } catch (e) {
      show((e as Error).message, false);
    }
  }

  const hookMenuItems: MenuItem[] = (['beforeAll', 'before', 'after', 'afterAll'] as const).map(ht => ({
    type: 'item' as const,
    label: (hookType === ht ? '✓ ' : '    ') + HOOK_LABELS[ht],
    onClick: () => onSetHookType(hookType === ht ? undefined : ht),
  }));

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!dragCtx.dragging || dragCtx.dragging.type !== 'request' || dragCtx.dragging.requestId === reqId) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setDropPos(e.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const insertIndex = dropPos === 'before' ? reqIndex : reqIndex + 1;
    dragCtx.onDropRequest(collectionId, folderId, insertIndex);
    setDropPos(null);
  }

  return (
    <div className="relative">
      {dropPos === 'before' && <div className="absolute top-0 inset-x-0 h-0.5 bg-blue-500 z-10 pointer-events-none" />}
      <div
        draggable
        className={`group flex items-start gap-1.5 py-1 pr-1 rounded-sm cursor-pointer transition-colors ${
          disabled ? 'opacity-40' : ''
        } ${
          selected ? 'bg-blue-950/40 ring-1 ring-inset ring-blue-500' :
          isActive ? 'bg-surface-800 text-[var(--text-primary)]' : 'text-surface-300 hover:bg-surface-800'
        }`}
        style={{ paddingLeft: indent }}
        onClick={handleRowClick}
        onDoubleClick={() => setRenaming(true)}
        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; dragCtx.setDragging({ type: 'request', requestId: reqId, collectionId }); }}
        onDragEnd={() => { dragCtx.setDragging(null); setDropPos(null); }}
        onDragOver={handleDragOver}
        onDragLeave={() => setDropPos(null)}
        onDrop={handleDrop}
      >
        {/* Multi-select checkbox — hidden until row hover, always shown once a
            selection is in progress so every row can be toggled without the
            Cmd/Ctrl modifier. */}
        <input
          type="checkbox"
          checked={selected}
          onClick={e => e.stopPropagation()}
          onChange={() => sel.toggle(collectionId, reqId)}
          title="Select request (or Cmd/Ctrl+click the row)"
          className={`shrink-0 mt-0.5 accent-blue-500 cursor-pointer ${sel.active || selected ? '' : 'opacity-0 group-hover:opacity-100'}`}
        />

        {/* Expand caret for nested examples (spacer keeps alignment when none). */}
        {examples.length > 0 ? (
          <button
            onClick={e => { e.stopPropagation(); setExamplesOpen(o => !o); }}
            className="shrink-0 w-3 text-surface-500 hover:text-white leading-none"
            title={examplesOpen ? 'Hide examples' : `Show ${examples.length} example(s)`}
          >{examplesOpen ? '▾' : '▸'}</button>
        ) : (
          <span className="shrink-0 w-3" />
        )}

        {/* Protocol badge — SOAP/WS get distinct colors so they don't blend
            with REST POSTs. Falls back to the standard method badge for HTTP. */}
        {protocol === 'soap' ? (
          <span
            className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-700/80 text-amber-50"
            title="SOAP request"
          >
            SOAP
          </span>
        ) : protocol === 'websocket' ? (
          <span
            className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-cyan-700/80 text-cyan-50"
            title="WebSocket"
          >
            WS
          </span>
        ) : (
          <MethodBadge method={method} size="xs" />
        )}

        <div className="flex-1 min-w-0">
          {renaming ? (
            <InlineEdit
              value={name}
              onCommit={v => { onRename(v); setRenaming(false); }}
              onCancel={() => setRenaming(false)}
              className="w-full text-xs"
            />
          ) : (
            <div className="flex items-center gap-1 min-w-0">
              <span className="text-xs truncate">{name}</span>
              {hookType && (
                <span className={`shrink-0 text-[9px] font-bold px-1 py-px rounded ${HOOK_COLORS[hookType]}`}>
                  {HOOK_LABELS[hookType].toUpperCase()}
                </span>
              )}
              {authType !== 'none' && (
                <span
                  className="shrink-0 text-[9px] px-1 py-px rounded bg-amber-800/40 text-amber-400"
                  title={`Auth: ${AUTH_BADGE_LABELS[authType] ?? authType}`}
                >
                  {AUTH_BADGE_LABELS[authType] ?? authType}
                </span>
              )}
            </div>
          )}
          {(() => {
            const path = requestPath(url);
            return path && path !== name ? (
              <span className="block text-[10px] text-surface-500 font-mono truncate leading-tight" title={url}>{path}</span>
            ) : null;
          })()}
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
            { type: 'item', label: 'Rename',     icon: <PencilIcon />, onClick: () => setRenaming(true) },
            { type: 'item', label: 'Duplicate',  icon: <CopyIcon />,   onClick: onDuplicate },
            ...(onAddExample ? [{ type: 'item' as const, label: 'Add Example', icon: <CopyIcon />, onClick: () => { onAddExample(); setExamplesOpen(true); } }] : []),
            { type: 'item', label: 'Add tag',    icon: <TagIcon />,    onClick: () => setAddingTag(true) },
            { type: 'item', label: 'Sync schema',icon: <SyncIcon />,   onClick: () => setShowSchemaSync(true) },
            { type: 'item', label: disabled ? 'Enable' : 'Disable',    onClick: onToggleDisabled },
            ...(cloudEnabled()
              ? [{ type: 'item' as const, label: 'Push as monitor to cloud', icon: <SyncIcon />, onClick: pushMonitor }]
              : []),
            { type: 'separator' },
            { type: 'header', label: 'Hook type' },
            ...hookMenuItems,
            { type: 'separator' },
            { type: 'item', label: 'Delete', icon: <TrashIcon />, danger: true, onClick: onDelete },
          ]} />
        </div>
        {toast && <div className="fixed bottom-4 right-4 z-[100] w-96"><Toast toast={toast} /></div>}
        {dropPos === 'after' && <div className="absolute bottom-0 inset-x-0 h-0.5 bg-blue-500 z-10 pointer-events-none" />}
      </div>
      {examplesOpen && examples.map(ex => (
        <ExampleRow
          key={ex.id}
          name={ex.name}
          indent={indent + 18}
          isActive={activeExampleId === ex.id}
          onOpen={() => onOpenExample?.(ex.id)}
          onRename={n => onRenameExample?.(ex.id, n)}
          onDelete={() => onDeleteExample?.(ex.id)}
          onDuplicate={() => onDuplicateExample?.(ex.id)}
        />
      ))}
      {showSchemaSync && (
        <SchemaSyncModal
          collectionId={collectionId}
          scope={{ type: 'request', requestId: reqId }}
          onClose={() => setShowSchemaSync(false)}
        />
      )}
    </div>
  );
}

// ─── ExampleRow ──────────────────────────────────────────────────────────────
// A saved request/response snapshot nested under its request in the tree.

function ExampleRow({ name, indent, isActive, onOpen, onRename, onDelete, onDuplicate }: {
  name: string
  indent: number
  isActive: boolean
  onOpen: () => void
  onRename: (n: string) => void
  onDelete: () => void
  onDuplicate: () => void
}) {
  const [renaming, setRenaming] = useState(false);
  return (
    <div
      className={`group flex items-center gap-1.5 py-1 pr-1 rounded-sm cursor-pointer transition-colors ${
        isActive ? 'bg-surface-800 text-[var(--text-primary)]' : 'text-surface-400 hover:bg-surface-800'
      }`}
      style={{ paddingLeft: indent }}
      onClick={onOpen}
      onDoubleClick={() => setRenaming(true)}
    >
      <span className="shrink-0 text-[8px] font-bold px-1 py-px rounded bg-surface-700 text-surface-300" title="Example">EX</span>
      <div className="flex-1 min-w-0">
        {renaming ? (
          <InlineEdit
            value={name}
            onCommit={v => { onRename(v); setRenaming(false); }}
            onCancel={() => setRenaming(false)}
            className="w-full text-xs"
          />
        ) : (
          <span className="text-xs truncate">{name}</span>
        )}
      </div>
      <div className="shrink-0">
        <DotsBtn items={[
          { type: 'item', label: 'Open', onClick: onOpen },
          { type: 'item', label: 'Rename', icon: <PencilIcon />, onClick: () => setRenaming(true) },
          { type: 'item', label: 'Duplicate', icon: <CopyIcon />, onClick: onDuplicate },
          { type: 'separator' },
          { type: 'item', label: 'Delete', icon: <TrashIcon />, danger: true, onClick: onDelete },
        ]} />
      </div>
    </div>
  );
}
