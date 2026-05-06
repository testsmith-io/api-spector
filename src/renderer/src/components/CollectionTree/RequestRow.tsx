// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useContext, useState } from 'react';
import type { ApiRequest } from '../../../../shared/types';
import { MethodBadge } from '../common/MethodBadge';
import { SchemaSyncModal } from './SchemaSyncModal';
import {
  DragCtx,
  type MenuItem,
  InlineEdit,
  TagChips,
  DotsBtn,
  PencilIcon, CopyIcon, TagIcon, SyncIcon, TrashIcon,
} from './CollectionTree';

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
  method: string
  protocol?: ApiRequest['protocol']
  authType: string
  hookType?: ApiRequest['hookType']
  disabled?: boolean
  tags: string[]
  isActive: boolean
  indent: number
  autoRename?: boolean
  onSelect: () => void
  onRename: (name: string) => void
  onDelete: () => void
  onDuplicate: () => void
  onUpdateTags: (tags: string[]) => void
  onSetHookType: (ht: ApiRequest['hookType']) => void
  onToggleDisabled: () => void
}

export function RequestRow({
  reqId, collectionId, folderId, reqIndex, name, method, protocol, authType, hookType, disabled, tags, isActive, indent, autoRename = false,
  onSelect, onRename, onDelete, onDuplicate, onUpdateTags, onSetHookType, onToggleDisabled,
}: RequestRowProps) {
  const [renaming, setRenaming] = useState(autoRename);
  const [addingTag, setAddingTag] = useState(false);
  const [showSchemaSync, setShowSchemaSync] = useState(false);
  const [dropPos, setDropPos] = useState<'before' | 'after' | null>(null);
  const dragCtx = useContext(DragCtx);

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
          isActive ? 'bg-surface-800 text-[var(--text-primary)]' : 'text-surface-300 hover:bg-surface-800'
        }`}
        style={{ paddingLeft: indent }}
        onClick={onSelect}
        onDoubleClick={() => setRenaming(true)}
        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; dragCtx.setDragging({ type: 'request', requestId: reqId, collectionId }); }}
        onDragEnd={() => { dragCtx.setDragging(null); setDropPos(null); }}
        onDragOver={handleDragOver}
        onDragLeave={() => setDropPos(null)}
        onDrop={handleDrop}
      >
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
            { type: 'item', label: 'Add tag',    icon: <TagIcon />,    onClick: () => setAddingTag(true) },
            { type: 'item', label: 'Sync schema',icon: <SyncIcon />,   onClick: () => setShowSchemaSync(true) },
            { type: 'item', label: disabled ? 'Enable' : 'Disable',    onClick: onToggleDisabled },
            { type: 'separator' },
            { type: 'header', label: 'Hook type' },
            ...hookMenuItems,
            { type: 'separator' },
            { type: 'item', label: 'Delete', icon: <TrashIcon />, danger: true, onClick: onDelete },
          ]} />
        </div>
        {dropPos === 'after' && <div className="absolute bottom-0 inset-x-0 h-0.5 bg-blue-500 z-10 pointer-events-none" />}
      </div>
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
