// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { useState, useMemo } from 'react';
import { useStore } from '../../store';
import type { ApiRequest } from '../../../../shared/types';

const { electron } = window;

interface SpecEntry {
  method: string
  pathTemplate: string
  pathRewritten: string
  schema: string
  operationId?: string
  summary?: string
}

interface MatchedEntry {
  specEntry: SpecEntry
  request: ApiRequest
  oldSchema: string
  newSchema: string
  changed: boolean
}

export type SchemaSyncScope =
  | { type: 'collection' }
  | { type: 'folder'; folderId: string }
  | { type: 'request'; requestId: string }

/**
 * Normalise a URL so we can compare it against an OpenAPI path template.
 * Strips any leading `{{baseUrl}}` or `https://host:port` prefix, and
 * replaces `{{name}}` variable tokens back to `{name}` so they match the
 * OpenAPI `{name}` format.
 */
function normalisePath(url: string): string {
  let path = url
    // Strip variable-based prefix: {{baseUrl}}/foo → /foo
    .replace(/^\{\{[^}]+\}\}/, '')
    // Strip absolute URL prefix: https://host:port/foo → /foo
    .replace(/^https?:\/\/[^/]+/, '');
  // Ensure leading slash
  if (!path.startsWith('/')) path = '/' + path;
  // Drop query string
  path = path.split('?')[0];
  // Rewrite {{x}} back to {x}
  path = path.replace(/\{\{([^}]+)\}\}/g, '{$1}');
  return path;
}

/** Collect all request IDs under a folder recursively. */
function collectRequestIds(folder: { requestIds: string[]; folders: { requestIds: string[]; folders: any[] }[] }): Set<string> {
  const ids = new Set<string>(folder.requestIds);
  for (const sub of folder.folders) {
    for (const id of collectRequestIds(sub)) ids.add(id);
  }
  return ids;
}

function findFolder(root: { id: string; folders: any[]; requestIds: string[] }, id: string): any | null {
  if (root.id === id) return root;
  for (const sub of root.folders) {
    const found = findFolder(sub, id);
    if (found) return found;
  }
  return null;
}

export function SchemaSyncModal({
  collectionId,
  scope = { type: 'collection' },
  onClose,
}: {
  collectionId: string
  scope?: SchemaSyncScope
  onClose: () => void
}) {
  const collections = useStore(s => s.collections);
  const updateRequest = useStore(s => s.updateRequest);
  const markCollectionClean = useStore(s => s.markCollectionClean);
  const col = collections[collectionId]?.data;

  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [specEntries, setSpecEntries] = useState<SpecEntry[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Determine which requests are in scope
  const scopeRequestIds = useMemo<Set<string> | null>(() => {
    if (!col) return null;
    if (scope.type === 'request') return new Set([scope.requestId]);
    if (scope.type === 'folder') {
      const folder = findFolder(col.rootFolder, scope.folderId);
      return folder ? collectRequestIds(folder) : new Set<string>();
    }
    return null;  // null = all requests (collection scope)
  }, [col, scope]);

  // Match spec entries to existing requests by method + normalised path
  const matches = useMemo<MatchedEntry[]>(() => {
    if (!specEntries || !col) return [];
    const allRequests = Object.values(col.requests) as ApiRequest[];
    const requests = scopeRequestIds
      ? allRequests.filter(r => scopeRequestIds.has(r.id))
      : allRequests;
    const result: MatchedEntry[] = [];

    for (const spec of specEntries) {
      const specPath = spec.pathTemplate.toLowerCase();
      const match = requests.find(r => {
        if (r.method !== spec.method) return false;
        return normalisePath(r.url).toLowerCase() === specPath;
      });
      if (match) {
        result.push({
          specEntry: spec,
          request: match,
          oldSchema: match.schema ?? '',
          newSchema: spec.schema,
          changed: (match.schema ?? '').trim() !== spec.schema.trim(),
        });
      }
    }
    return result;
  }, [specEntries, col, scopeRequestIds]);

  const changedCount = matches.filter(m => m.changed).length;
  const unchangedCount = matches.length - changedCount;

  /** Auto-select entries whose schema differs from the existing request. */
  function autoSelectChanged(entries: SpecEntry[]) {
    const allRequests = Object.values(col!.requests) as ApiRequest[];
    const requests = scopeRequestIds
      ? allRequests.filter(r => scopeRequestIds.has(r.id))
      : allRequests;
    setSelected(new Set(
      entries
        .filter((e: SpecEntry) => {
          const specPath = e.pathTemplate.toLowerCase();
          const match = requests.find(r => r.method === e.method && normalisePath(r.url).toLowerCase() === specPath);
          return match && (match.schema ?? '').trim() !== e.schema.trim();
        })
        .map((e: SpecEntry) => `${e.method}:${e.pathTemplate}`)
    ));
  }

  const scopeLabel = scope.type === 'request'
    ? (col ? Object.values(col.requests).find(r => r.id === scope.requestId)?.name : '') ?? 'request'
    : scope.type === 'folder'
      ? findFolder(col?.rootFolder, scope.folderId)?.name ?? 'folder'
      : col?.name ?? 'collection';

  async function loadFromFile() {
    setLoading(true);
    setError(null);
    try {
      const entries = await electron.extractOpenApiSchemas();
      if (!entries) { setLoading(false); return; }
      setSpecEntries(entries);
      autoSelectChanged(entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadFromUrl() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const entries = await electron.extractOpenApiSchemasFromUrl(trimmed);
      setSpecEntries(entries);
      autoSelectChanged(entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function toggleEntry(key: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllChanged() {
    setSelected(new Set(matches.filter(m => m.changed).map(m => `${m.specEntry.method}:${m.specEntry.pathTemplate}`)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  async function applySync() {
    setLoading(true);
    try {
      for (const m of matches) {
        const key = `${m.specEntry.method}:${m.specEntry.pathTemplate}`;
        if (!selected.has(key)) continue;
        updateRequest(m.request.id, { schema: m.newSchema });
      }
      // Persist the collection
      const entry = useStore.getState().collections[collectionId];
      if (entry) {
        await electron.saveCollection(entry.relPath, entry.data);
        markCollectionClean(collectionId);
      }
      onClose();
    } finally {
      setLoading(false);
    }
  }

  if (!col) return null;

  // Preview screen (after spec is loaded)
  if (specEntries) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
        <div
          className="bg-surface-900 border border-surface-700 rounded-xl shadow-2xl w-[640px] max-h-[80vh] p-5 flex flex-col gap-4"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-surface-100">
              Sync schemas — {scopeLabel}
            </h2>
            <button onClick={onClose} className="text-surface-500 hover:text-surface-300 text-lg leading-none">×</button>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-3 text-xs">
            <span className="text-surface-400">{specEntries.length} operations in spec</span>
            <span className="text-surface-400">·</span>
            <span className="text-surface-400">{matches.length} matched to existing requests</span>
            {changedCount > 0 && (
              <>
                <span className="text-surface-400">·</span>
                <span className="text-amber-400 font-medium">{changedCount} changed</span>
              </>
            )}
            {unchangedCount > 0 && (
              <>
                <span className="text-surface-400">·</span>
                <span className="text-emerald-400">{unchangedCount} unchanged</span>
              </>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
              Select schemas to update ({selected.size})
            </p>
            <div className="flex gap-2">
              <button onClick={selectAllChanged} className="text-[10px] text-blue-400 hover:text-blue-300">Select changed</button>
              <button onClick={selectNone} className="text-[10px] text-blue-400 hover:text-blue-300">Select none</button>
            </div>
          </div>

          {/* Match list */}
          <div className="flex-1 min-h-0 overflow-y-auto border border-surface-800 rounded-lg">
            {matches.length === 0 ? (
              <p className="p-4 text-xs text-surface-500">
                No operations from the spec matched any request in this collection.
                Matching uses HTTP method + URL path.
              </p>
            ) : (
              matches.map(m => {
                const key = `${m.specEntry.method}:${m.specEntry.pathTemplate}`;
                return (
                  <label
                    key={key}
                    className={`flex items-center gap-2 px-3 py-2 hover:bg-surface-850 cursor-pointer border-b border-surface-800 last:border-b-0 ${
                      !m.changed ? 'opacity-50' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggleEntry(key)}
                      className="accent-blue-500"
                    />
                    <span className={`text-[10px] font-mono font-bold w-14 shrink-0 ${methodColor(m.specEntry.method)}`}>
                      {m.specEntry.method}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-surface-200 truncate">{m.request.name}</div>
                      <div className="text-[10px] text-surface-500 font-mono truncate">{m.specEntry.pathTemplate}</div>
                    </div>
                    <span className={`text-[10px] shrink-0 ${m.changed ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {m.changed ? 'changed' : 'up to date'}
                    </span>
                  </label>
                );
              })
            )}
            {/* Unmatched spec entries */}
            {specEntries.length > matches.length && (
              <div className="px-3 py-2 border-t border-surface-700">
                <p className="text-[10px] text-surface-500">
                  {specEntries.length - matches.length} operations not matched (no request with matching method + path)
                </p>
              </div>
            )}
          </div>

          {error && <p className="text-[11px] text-red-400">{error}</p>}

          <div className="flex justify-between pt-1">
            <button
              onClick={() => setSpecEntries(null)}
              className="px-3 py-1.5 text-xs bg-surface-800 hover:bg-surface-700 rounded transition-colors"
            >
              Back
            </button>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs bg-surface-800 hover:bg-surface-700 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={loading || selected.size === 0}
                onClick={applySync}
                className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-surface-800 disabled:text-surface-600 rounded transition-colors"
              >
                {loading ? 'Updating…' : `Update ${selected.size} schema${selected.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Source selection screen
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface-900 border border-surface-700 rounded-xl shadow-2xl w-[420px] p-5 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-surface-100">Sync schemas from OpenAPI</h2>
          <button onClick={onClose} className="text-surface-500 hover:text-surface-300 text-lg leading-none">×</button>
        </div>

        <p className="text-xs text-surface-400">
          Load an OpenAPI spec to update response schemas on existing requests.
          Matching uses HTTP method + URL path. Only schemas are touched — URLs,
          params, headers, auth, and scripts are preserved.
        </p>

        <button
          onClick={loadFromFile}
          disabled={loading}
          className="px-3 py-2 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-surface-800 disabled:text-surface-600 rounded transition-colors font-medium"
        >
          {loading ? 'Loading…' : 'Choose file…'}
        </button>

        <div className="flex flex-col gap-2">
          <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">Or load from URL</p>
          <div className="flex gap-2">
            <input
              value={url}
              onChange={e => { setUrl(e.target.value); setError(null); }}
              onKeyDown={e => { if (e.key === 'Enter') loadFromUrl(); }}
              placeholder="https://api.example.com/openapi.json"
              className="flex-1 text-xs bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 placeholder-surface-600 font-mono"
            />
            <button
              onClick={loadFromUrl}
              disabled={!url.trim() || loading}
              className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-surface-800 disabled:text-surface-600 rounded transition-colors whitespace-nowrap"
            >
              {loading ? 'Loading…' : 'From URL'}
            </button>
          </div>
        </div>

        {error && <p className="text-[11px] text-red-400">{error}</p>}

        <div className="flex justify-end pt-1">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs bg-surface-800 hover:bg-surface-700 rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function methodColor(method: string): string {
  switch (method) {
    case 'GET':    return 'text-emerald-400';
    case 'POST':   return 'text-amber-400';
    case 'PUT':    return 'text-sky-400';
    case 'PATCH':  return 'text-violet-400';
    case 'DELETE': return 'text-red-400';
    default:       return 'text-surface-300';
  }
}
