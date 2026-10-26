// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useContext, useState } from 'react';
import type { ApiRequest } from '../../../../shared/types';
import { MethodBadge } from '../common/MethodBadge';
import { SchemaSyncModal } from './SchemaSyncModal';
import { DragCtx, SelectionCtx, TagChips } from './CollectionTree';
import { InlineEdit } from '../common/InlineEdit';
import { type MenuItem, DotsBtn } from '../common/ContextMenu';
import { onActivateKey } from '../../lib/a11y';
import { PencilIcon, CopyIcon, TagIcon, SyncIcon, TrashIcon, ShieldIcon, BanIcon, SortAzIcon, FileCodeIcon, KeyIcon } from '../common/icons';
import { useStore } from '../../store';
import { useToast, Toast } from '../common/Toast';
import { pushRequestAsMonitor, cloudEnabled } from '../../lib/cloud-push';
import { useT } from '../../i18n';

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

export const HOOK_LABELS: Record<NonNullable<ApiRequest['hookType']>, string> = {
  beforeAll: 'Before All',
  before:    'Before Each',
  after:     'After Each',
  afterAll:  'After All',
};

export const HOOK_COLORS: Record<NonNullable<ApiRequest['hookType']>, string> = {
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
  readonly reqId: string
  readonly collectionId: string
  readonly folderId: string
  readonly name: string
  readonly url: string
  readonly method: string
  readonly protocol?: ApiRequest['protocol']
  readonly authType: string
  readonly hookType?: ApiRequest['hookType']
  readonly disabled?: boolean
  readonly tags: string[]
  readonly isActive: boolean
  readonly indent: number
  readonly autoRename?: boolean
  readonly examples?: { id: string; name: string }[]
  readonly activeExampleId?: string | null
  readonly onSelect: () => void
  readonly onRename: (name: string) => void
  readonly onDelete: () => void
  readonly onDuplicate: () => void
  readonly onUpdateTags: (tags: string[]) => void
  readonly onSetHookType: (ht: ApiRequest['hookType']) => void
  readonly onToggleDisabled: () => void
  readonly onAddExample?: () => void
  readonly onOpenExample?: (exampleId: string) => void
  readonly onRenameExample?: (exampleId: string, name: string) => void
  readonly onDeleteExample?: (exampleId: string) => void
  readonly onDuplicateExample?: (exampleId: string) => void
  readonly onReorderExample?: (fromId: string, toId: string) => void
  readonly onSortExamples?: () => void
}

export function RequestRow({
  reqId, collectionId, name, url, method, protocol, authType, hookType, disabled, tags, isActive, indent, autoRename = false,
  examples = [], activeExampleId,
  onSelect, onRename, onDelete, onDuplicate, onUpdateTags, onSetHookType, onToggleDisabled,
  onAddExample, onOpenExample, onRenameExample, onDeleteExample, onDuplicateExample,
  onReorderExample, onSortExamples,
}: RequestRowProps) {
  // Which example is being dragged (for reorder) — tracked here so every
  // ExampleRow shares one drag source.
  const [dragExampleId, setDragExampleId] = useState<string | null>(null);
  const t = useT();
  // An example is a saved request + single response snapshot, which only fits
  // request/response protocols. Realtime ones (WebSocket, Socket.IO, MQTT) have
  // no single response, so they do not offer "Add Example".
  const canAddExample = !protocol || protocol === 'http' || protocol === 'soap' || protocol === 'grpc';
  const [renaming, setRenaming] = useState(autoRename);
  // Examples start collapsed: the count on the request row already signals they
  // exist, and expanding reveals the grouped "Saved examples" panel.
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [showSchemaSync, setShowSchemaSync] = useState(false);
  const dragCtx = useContext(DragCtx);
  const sel = useContext(SelectionCtx);
  const selected = sel.isSelected(collectionId, reqId);
  // When an example of this request is the open tab, the example row owns the
  // selection highlight — the parent request must not also look selected, but
  // it keeps a subtle cue (the connector line tints blue).
  const exampleActive = activeExampleId != null && examples.some(e => e.id === activeExampleId);
  // The "Saved examples" group is nudged in from the request's left edge so it
  // reads as belonging to the request without consuming a full indent level.
  const groupIndent = indent + 14;
  const { toast, show } = useToast();
  const addSecurityTests = useStore(s => s.addSecurityTests);

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
      show(t('Pushed ":name" as monitor #:id to the cloud', { name: req.name, id: r.id }), true);
    } catch (e) {
      show((e as Error).message, false);
    }
  }

  const hookMenuItems: MenuItem[] = (['beforeAll', 'before', 'after', 'afterAll'] as const).map(ht => ({
    type: 'item' as const,
    label: (hookType === ht ? '✓ ' : '    ') + t(HOOK_LABELS[ht]),
    onClick: () => onSetHookType(hookType === ht ? undefined : ht),
  }));

  return (
    <div className="relative">
      <div
        data-row
        draggable
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRowClick(e as unknown as React.MouseEvent); } }}
        className={`group relative flex items-start gap-1.5 py-1 pr-1 rounded-sm cursor-pointer transition-colors outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-400 ${
          disabled ? 'opacity-40' : ''
        } ${
          selected ? 'bg-blue-950/40 ring-1 ring-inset ring-blue-500' :
          isActive && !exampleActive ? 'bg-surface-800 text-[var(--text-primary)]' : 'text-surface-300 hover:bg-surface-800'
        }`}
        style={{ paddingLeft: indent }}
        onClick={handleRowClick}
        onDoubleClick={() => setRenaming(true)}
        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; dragCtx.setDragging({ type: 'request', requestId: reqId, collectionId }); }}
        onDragEnd={() => { dragCtx.setDragging(null); }}
      >
        {/* Multi-select checkbox — overlaid in the left indentation gutter (just
            left of the chevron) so it reserves no column and causes no layout
            shift. Hidden + non-interactive until the row is hovered; stays
            visible once a selection is in progress. */}
        <input
          type="checkbox"
          checked={selected}
          onClick={e => e.stopPropagation()}
          onChange={() => sel.toggle(collectionId, reqId)}
          title={t('Select request (or Cmd/Ctrl+click the row)')}
          style={{ left: Math.max(indent - 13, 0) }}
          className={`absolute top-1.5 accent-blue-500 cursor-pointer ${sel.active || selected ? 'opacity-100' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'}`}
        />

        {/* Col 1 — compact, fixed-width chevron slot. Empty (but same width)
            when the request has no examples, so method and name never shift. */}
        <span className="shrink-0 w-4 flex items-center justify-center mt-0.5">
          {examples.length > 0 && (
            <button
              onClick={e => { e.stopPropagation(); setExamplesOpen(o => !o); }}
              aria-expanded={examplesOpen}
              className="w-4 h-4 inline-flex items-center justify-center text-surface-500 hover:text-white leading-none text-[22px] outline-none focus-visible:ring-1 focus-visible:ring-blue-400 rounded-sm"
              title={examplesOpen ? t('Hide examples') : t('Show :count example(s)', { count: examples.length })}
            >{examplesOpen ? '▾' : '▸'}</button>
          )}
        </span>

        {/* Col 2 — HTTP method / protocol, in a fixed-width column so request
            names always begin at the same x regardless of the method. */}
        <span className="shrink-0 w-10 flex items-center mt-0.5">
          {protocol === 'soap' ? (
            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-700/80 text-amber-50" title={t('SOAP request')}>SOAP</span>
          ) : protocol === 'websocket' ? (
            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-cyan-700/80 text-cyan-50" title={t('WebSocket')}>WS</span>
          ) : protocol === 'socketio' ? (
            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-fuchsia-700/80 text-fuchsia-50" title={t('Socket.IO')}>IO</span>
          ) : protocol === 'mqtt' ? (
            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-teal-700/80 text-teal-50" title={t('MQTT')}>MQTT</span>
          ) : (
            <MethodBadge method={method} size="xs" />
          )}
        </span>

        {/* Col 3 — request name (priority) + muted URL + tags. */}
        <div className="flex-1 min-w-0">
          {renaming ? (
            <InlineEdit
              value={name}
              onCommit={v => { onRename(v); setRenaming(false); }}
              onCancel={() => setRenaming(false)}
              className="w-full text-xs"
            />
          ) : (
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs truncate" title={name}>{name}</span>
              {/* Col 4 — secondary metadata, compact icons pinned right so the
                  name keeps the width. Each carries a descriptive tooltip. */}
              <span className="shrink-0 ml-auto flex items-center gap-1.5">
                {hookType && (
                  <span className={`shrink-0 text-[9px] font-bold px-1 py-px rounded ${HOOK_COLORS[hookType]}`}>
                    {t(HOOK_LABELS[hookType]).toUpperCase()}
                  </span>
                )}
                {authType !== 'none' && (
                  <span
                    className="inline-flex text-amber-400"
                    title={t('Auth: :name', { name: AUTH_BADGE_LABELS[authType] ?? authType })}
                  >
                    <KeyIcon className="w-3.5 h-3.5" />
                  </span>
                )}
                {/* Example count — small and secondary; shown only while the
                    group is collapsed (expanded, the EXAMPLES header carries it).
                    Derived from props, so it stays correct on add/move/delete. */}
                {examples.length > 0 && !examplesOpen && (
                  <span
                    className={`inline-flex items-center gap-0.5 text-[10px] tabular-nums ${exampleActive ? 'text-blue-400' : 'text-surface-500'}`}
                    title={t(':count example|:count examples', { count: examples.length })}
                  >
                    <FileCodeIcon className="w-2.5 h-2.5" />
                    {examples.length}
                  </span>
                )}
              </span>
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
            ...(onAddExample && canAddExample ? [
              { type: 'item' as const, label: t('Add Example'), icon: <CopyIcon />, onClick: () => { onAddExample(); setExamplesOpen(true); } },
            ] : []),
            ...(onSortExamples && examples.length > 1 ? [
              { type: 'item' as const, label: t('Sort examples A-Z'), icon: <SortAzIcon />, onClick: () => { onSortExamples(); setExamplesOpen(true); } },
            ] : []),
            ...((onAddExample && canAddExample) || (onSortExamples && examples.length > 1)
              ? [{ type: 'separator' as const }] : []),
            { type: 'item', label: t('Rename'),     icon: <PencilIcon />, onClick: () => setRenaming(true) },
            { type: 'item', label: t('Duplicate'),  icon: <CopyIcon />,   onClick: onDuplicate },
            { type: 'item', label: t('Add tag'),    icon: <TagIcon />,    onClick: () => setAddingTag(true) },
            { type: 'separator' },
            { type: 'item', label: t('Sync schema'),icon: <SyncIcon />,   onClick: () => setShowSchemaSync(true) },
            { type: 'item', label: t('Generate security tests'), icon: <ShieldIcon />, onClick: () => {
              const n = addSecurityTests(collectionId, reqId);
              show(n > 0 ? t('Added :count OWASP security tests', { count: n }) : t('No security tests generated for this request'), n > 0);
            } },
            ...(cloudEnabled()
              ? [{ type: 'item' as const, label: t('Push as monitor to cloud'), icon: <SyncIcon />, onClick: pushMonitor }]
              : []),
            { type: 'item', label: disabled ? t('Enable') : t('Disable'), icon: <BanIcon />, onClick: onToggleDisabled },
            { type: 'separator' },
            { type: 'header', label: t('Hook type') },
            ...hookMenuItems,
            { type: 'separator' },
            { type: 'item', label: t('Delete'), icon: <TrashIcon />, danger: true, onClick: onDelete },
          ]} />
        </div>
        {toast && <div className="fixed bottom-4 right-4 z-[100] w-96"><Toast toast={toast} /></div>}
      </div>
      {/* Examples under the request: a plain, compact indented list (no card,
          no header, no connector line). Marked with a neutral icon and their
          own selection state. Hidden when collapsed (the count then shows on
          the request row). */}
      {examplesOpen && examples.length > 0 && (
        <div className="mb-0.5" style={{ paddingLeft: groupIndent }}>
          {examples.map(ex => (
            <ExampleRow
              key={ex.id}
              name={ex.name}
              indent={4}
              isActive={activeExampleId === ex.id}
              reorderable={!!onReorderExample && examples.length > 1}
              dragging={dragExampleId === ex.id}
              dragActive={dragExampleId !== null && dragExampleId !== ex.id}
              onDragStart={() => setDragExampleId(ex.id)}
              onDragEnd={() => setDragExampleId(null)}
              onDropOn={() => { if (dragExampleId && dragExampleId !== ex.id) onReorderExample?.(dragExampleId, ex.id); setDragExampleId(null); }}
              onOpen={() => onOpenExample?.(ex.id)}
              onRename={n => onRenameExample?.(ex.id, n)}
              onDelete={() => onDeleteExample?.(ex.id)}
              onDuplicate={() => onDuplicateExample?.(ex.id)}
            />
          ))}
        </div>
      )}
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
// One saved request/response snapshot, rendered as a compact member of its
// request's "Saved examples" group (no collection-level indentation, no method
// badge, a neutral icon, and its own selection/hover styling).

function ExampleRow({ name, indent, isActive, reorderable, dragging, dragActive, onDragStart, onDragEnd, onDropOn, onOpen, onRename, onDelete, onDuplicate }: {
  readonly name: string
  /** Left padding (px) so the example sits nested under its request. */
  readonly indent: number
  readonly isActive: boolean
  readonly reorderable: boolean
  readonly dragging: boolean
  readonly dragActive: boolean
  readonly onDragStart: () => void
  readonly onDragEnd: () => void
  readonly onDropOn: () => void
  readonly onOpen: () => void
  readonly onRename: (n: string) => void
  readonly onDelete: () => void
  readonly onDuplicate: () => void
}) {
  const t = useT();
  const [renaming, setRenaming] = useState(false);
  const [over, setOver] = useState(false);
  return (
    <div
      data-row
      draggable={reorderable && !renaming}
      className={`group/ex flex items-center gap-2 h-[26px] pr-2 rounded-sm cursor-pointer transition-colors outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-400 ${
        isActive ? 'bg-blue-900/40 text-[var(--text-primary)]' : 'text-surface-400 hover:bg-surface-800'
      } ${dragging ? 'opacity-40' : ''} ${over ? 'ring-1 ring-inset ring-blue-500' : ''}`}
      style={{ paddingLeft: indent }}
      role="button"
      tabIndex={0}
      aria-label={t('Example: :name', { name })}
      onClick={onOpen}
      onKeyDown={onActivateKey(onOpen)}
      onDoubleClick={() => setRenaming(true)}
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', name); onDragStart(); }}
      onDragEnd={() => { setOver(false); onDragEnd(); }}
      onDragOver={e => { if (dragActive) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { if (dragActive) { e.preventDefault(); e.stopPropagation(); } setOver(false); onDropOn(); }}
    >
      <FileCodeIcon className={`shrink-0 ${isActive ? 'text-blue-300' : 'text-surface-500'}`} />
      <div className="flex-1 min-w-0">
        {renaming ? (
          <InlineEdit
            value={name}
            onCommit={v => { onRename(v); setRenaming(false); }}
            onCancel={() => setRenaming(false)}
            className="w-full text-xs"
          />
        ) : (
          <span className="text-xs truncate block" title={name}>{name}</span>
        )}
      </div>
      <div className="shrink-0 opacity-0 group-hover/ex:opacity-100 focus-within:opacity-100 transition-opacity">
        <DotsBtn items={[
          { type: 'item', label: t('Open'), onClick: onOpen },
          { type: 'item', label: t('Rename'), icon: <PencilIcon />, onClick: () => setRenaming(true) },
          { type: 'item', label: t('Duplicate'), icon: <CopyIcon />, onClick: onDuplicate },
          { type: 'separator' },
          { type: 'item', label: t('Delete'), icon: <TrashIcon />, danger: true, onClick: onDelete },
        ]} />
      </div>
    </div>
  );
}
