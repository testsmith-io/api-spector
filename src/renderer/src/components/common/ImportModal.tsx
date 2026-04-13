// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Collection, ApiRequest, Folder, Environment, EnvVariable } from '../../../../shared/types';
import { useStore } from '../../store';
import { envRelPath } from '../../../../shared/naming-utils';

const { electron } = window;

interface Props {
  onImport: (col: Collection | null) => void
  onClose: () => void
}

interface ImportOption {
  id: string
  label: string
  description: string
  supportsUrl?: boolean
}

const OPTIONS: ImportOption[] = [
  { id: 'postman',  label: 'Postman',  description: 'Collection v2.1 JSON' },
  { id: 'openapi',  label: 'OpenAPI',  description: 'JSON or YAML (v3.x)', supportsUrl: true },
  { id: 'insomnia', label: 'Insomnia', description: 'Export v4 JSON' },
  { id: 'bruno',    label: 'Bruno',    description: 'bruno.json collection file' },
];

// ── Helpers to walk a parsed collection ─────────────────────────────────────

interface EndpointEntry {
  request: ApiRequest
  /** Folder names from root to (but not including) the request, for grouping. */
  folderPath: string[]
}

function listEndpoints(col: Collection): EndpointEntry[] {
  const result: EndpointEntry[] = [];
  function walk(folder: Folder, path: string[]) {
    for (const id of folder.requestIds) {
      const req = col.requests[id];
      if (req) result.push({ request: req, folderPath: path });
    }
    for (const sub of folder.folders) {
      walk(sub, [...path, sub.name]);
    }
  }
  walk(col.rootFolder, []);
  return result;
}

export function ImportModal({ onImport, onClose }: Props) {
  const collections                 = useStore(s => s.collections);
  const environments                = useStore(s => s.environments);
  const setActiveCollection         = useStore(s => s.setActiveCollection);
  const mergeIntoCollection = useStore(s => s.mergeIntoCollection);
  const markCollectionClean         = useStore(s => s.markCollectionClean);

  const [selected, setSelected]   = useState<string | null>(null);
  const [url, setUrl]             = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const urlInputRef               = useRef<HTMLInputElement>(null);

  // ── OpenAPI preview state ──────────────────────────────────────────────────
  const [previewCol, setPreviewCol]     = useState<Collection | null>(null);
  const [chosenIds, setChosenIds]       = useState<Set<string>>(new Set());
  const [target, setTarget]             = useState<string>('__new__');
  const [newColName, setNewColName]     = useState<string>('');

  // ── Base URL → variable state ──────────────────────────────────────────────
  const [baseUrl, setBaseUrl]           = useState<string>('');
  const [varName, setVarName]           = useState<string>('baseUrl');
  const [envTarget, setEnvTarget]       = useState<string>('__new__');
  const [newEnvName, setNewEnvName]     = useState<string>('');

  const endpoints = useMemo(
    () => previewCol ? listEndpoints(previewCol) : [],
    [previewCol],
  );

  // Group endpoints by folder path for display
  const grouped = useMemo(() => {
    const map = new Map<string, EndpointEntry[]>();
    for (const ep of endpoints) {
      const key = ep.folderPath.join(' / ') || '(root)';
      const arr = map.get(key) ?? [];
      arr.push(ep);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [endpoints]);

  function enterPreview(col: Collection) {
    setPreviewCol(col);
    setNewColName(col.name);
    setChosenIds(new Set(Object.keys(col.requests)));
    // Detect base URL: longest common URL origin/path prefix across all
    // requests. Falls back to the origin of the first request if URLs diverge.
    const urls = Object.values(col.requests).map(r => r.url).filter(Boolean);
    setBaseUrl(detectBaseUrl(urls));
    setVarName('baseUrl');
    // Default env target: active env if it still exists, otherwise create new
    const state = useStore.getState();
    const activeEnvId = state.activeEnvironmentId;
    setEnvTarget(activeEnvId && state.environments[activeEnvId] ? activeEnvId : '__new__');
    setNewEnvName(`${col.name} env`);
  }

  async function runFileImport(opt: ImportOption) {
    setLoading(true);
    setError(null);
    try {
      let col: Collection | null = null;
      if (opt.id === 'postman')  col = await electron.importPostman();
      if (opt.id === 'openapi')  col = await electron.importOpenApi();
      if (opt.id === 'insomnia') col = await electron.importInsomnia();
      if (opt.id === 'bruno')    col = await electron.importBruno();
      if (!col) { setLoading(false); return; }
      if (opt.id === 'openapi') {
        enterPreview(col);
      } else {
        onImport(col);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function importFromUrl() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const col = await electron.importOpenApiFromUrl(trimmed);
      if (col) enterPreview(col);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function toggleId(id: string) {
    setChosenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(ids: string[]) {
    setChosenIds(prev => {
      const next = new Set(prev);
      const allSelected = ids.every(id => next.has(id));
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  }

  function selectAll()   { setChosenIds(new Set(endpoints.map(e => e.request.id))); }
  function selectNone()  { setChosenIds(new Set()); }

  async function confirmImport() {
    if (!previewCol) return;
    const picked = endpoints.filter(e => chosenIds.has(e.request.id));
    if (!picked.length) {
      setError('Pick at least one endpoint');
      return;
    }
    const trimmedVarName = varName.trim();
    const trimmedBaseUrl = baseUrl.trim();
    const useVariable    = Boolean(trimmedVarName && trimmedBaseUrl);
    if (trimmedBaseUrl && !trimmedVarName) {
      setError('Variable name is required when extracting base URL');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Rewrite URLs of selected requests to reference the variable
      const rewriteUrl = (u: string): string => {
        if (!useVariable) return u;
        return u.startsWith(trimmedBaseUrl)
          ? `{{${trimmedVarName}}}${u.slice(trimmedBaseUrl.length)}`
          : u;
      };

      // Apply rewrite in-place on the preview collection's requests so both
      // pruning and merging see the same data.
      for (const ep of picked) {
        ep.request.url = rewriteUrl(ep.request.url);
      }

      // Persist the variable to the chosen environment (if any)
      if (useVariable) {
        await persistBaseUrlVariable(trimmedVarName, trimmedBaseUrl);
      }

      if (target === '__new__') {
        // Build a fresh collection containing only the picked endpoints,
        // preserving their original folder structure.
        const filtered: Collection = {
          ...previewCol,
          name: newColName.trim() || previewCol.name,
          requests: {},
          rootFolder: pruneFolder(previewCol.rootFolder, previewCol, chosenIds, {} as Record<string, ApiRequest>),
        };
        // pruneFolder mutates the third object — re-collect requests:
        filtered.requests = collectRequestsByFolder(filtered.rootFolder, previewCol);
        onImport(filtered);
        onClose();
      } else {
        // Merge selected endpoints into the target existing collection,
        // preserving the folder/tag structure from the spec.
        const targetCol = collections[target]?.data;
        if (!targetCol) throw new Error('Target collection not found');
        const prunedRoot = pruneFolder(previewCol.rootFolder, previewCol, chosenIds, {} as Record<string, ApiRequest>);
        const prunedRequests = collectRequestsByFolder(prunedRoot, previewCol);
        mergeIntoCollection(target, prunedRoot, prunedRequests);
        // Persist the updated collection
        const entry = useStore.getState().collections[target];
        if (entry) {
          await electron.saveCollection(entry.relPath, entry.data);
          markCollectionClean(target);
        }
        setActiveCollection(target);
        onImport(null);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Add (or upsert) the base-URL variable into the chosen environment.
   * Creates a new environment if `envTarget === '__new__'`. Persists to disk
   * and registers it in the workspace.
   */
  async function persistBaseUrlVariable(name: string, value: string) {
    const state = useStore.getState();
    if (envTarget === '__new__') {
      const desiredName = newEnvName.trim() || 'New Environment';
      const existingNames = Object.values(state.environments).map(e => e.data.name);
      const finalName = uniqueEnvName(desiredName, existingNames);
      const envId = uuidv4();
      const env: Environment = {
        version: '1.0',
        id: envId,
        name: finalName,
        variables: [{ key: name, value, enabled: true } as EnvVariable],
      };
      const relPath = envRelPath(finalName, envId);
      // Save to disk first
      await electron.saveEnvironment(relPath, env);
      // Then register in store + workspace
      useStore.setState(s => {
        s.environments[envId] = { relPath, data: env };
        if (!s.activeEnvironmentId) s.activeEnvironmentId = envId;
        if (s.workspace && !s.workspace.environments.includes(relPath)) {
          s.workspace.environments = [...s.workspace.environments, relPath];
        }
        return s;
      });
      const ws = useStore.getState().workspace;
      if (ws) await electron.saveWorkspace(ws);
    } else {
      const entry = state.environments[envTarget];
      if (!entry) throw new Error('Target environment not found');
      const updated: Environment = { ...entry.data };
      const idx = updated.variables.findIndex(v => v.key === name);
      if (idx >= 0) {
        // Don't clobber an existing value the user has already set
        if (!updated.variables[idx].value) {
          updated.variables = updated.variables.map((v, i) =>
            i === idx ? { ...v, value, enabled: true } : v,
          );
        }
      } else {
        updated.variables = [...updated.variables, { key: name, value, enabled: true } as EnvVariable];
      }
      await electron.saveEnvironment(entry.relPath, updated);
      useStore.getState().updateEnvironment(envTarget, updated);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (previewCol) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
        <div
          className="bg-surface-900 border border-surface-700 rounded-xl shadow-2xl w-[640px] max-h-[80vh] p-5 flex flex-col gap-4"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-surface-100">
              Import OpenAPI — {previewCol.name}
            </h2>
            <button
              onClick={onClose}
              className="text-surface-500 hover:text-surface-300 text-lg leading-none"
            >
              ×
            </button>
          </div>

          {/* Destination */}
          <div className="flex flex-col gap-2 border border-surface-800 rounded-lg p-3">
            <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">Destination</p>
            <select
              value={target}
              onChange={e => setTarget(e.target.value)}
              className="text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1.5 focus:outline-none focus:border-blue-500"
            >
              <option value="__new__">Create new collection…</option>
              {Object.values(collections).map(c => (
                <option key={c.data.id} value={c.data.id}>{c.data.name}</option>
              ))}
            </select>
            {target === '__new__' && (
              <input
                value={newColName}
                onChange={e => setNewColName(e.target.value)}
                placeholder="Collection name"
                className="text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1.5 focus:outline-none focus:border-blue-500"
              />
            )}
          </div>

          {/* Base URL → variable */}
          <div className="flex flex-col gap-2 border border-surface-800 rounded-lg p-3">
            <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">Base URL → variable</p>
            <div className="flex gap-2">
              <input
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                className="flex-1 text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1.5 focus:outline-none focus:border-blue-500 placeholder-surface-600 font-mono"
              />
              <span className="text-xs text-surface-500 self-center">→</span>
              <input
                value={varName}
                onChange={e => setVarName(e.target.value)}
                placeholder="baseUrl"
                className="w-32 text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1.5 focus:outline-none focus:border-blue-500 placeholder-surface-600 font-mono"
              />
            </div>
            <p className="text-[10px] text-surface-500">
              Leave the URL field empty to keep absolute URLs in each request.
            </p>
            {baseUrl.trim() && varName.trim() && (
              <>
                <select
                  value={envTarget}
                  onChange={e => setEnvTarget(e.target.value)}
                  className="text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1.5 focus:outline-none focus:border-blue-500"
                >
                  <option value="__new__">Create new environment…</option>
                  {Object.values(environments).map(e => (
                    <option key={e.data.id} value={e.data.id}>{e.data.name}</option>
                  ))}
                </select>
                {envTarget === '__new__' && (
                  <input
                    value={newEnvName}
                    onChange={e => setNewEnvName(e.target.value)}
                    placeholder="Environment name"
                    className="text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1.5 focus:outline-none focus:border-blue-500"
                  />
                )}
              </>
            )}
          </div>

          {/* Endpoint picker */}
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
              Endpoints ({chosenIds.size} / {endpoints.length})
            </p>
            <div className="flex gap-2">
              <button onClick={selectAll}  className="text-[10px] text-blue-400 hover:text-blue-300">Select all</button>
              <button onClick={selectNone} className="text-[10px] text-blue-400 hover:text-blue-300">Select none</button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto border border-surface-800 rounded-lg">
            {grouped.map(([groupName, items]) => {
              const ids = items.map(i => i.request.id);
              const allOn = ids.every(id => chosenIds.has(id));
              const someOn = !allOn && ids.some(id => chosenIds.has(id));
              return (
                <div key={groupName} className="border-b border-surface-800 last:border-b-0">
                  <button
                    onClick={() => toggleGroup(ids)}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-surface-850 hover:bg-surface-800 text-left"
                  >
                    <input
                      type="checkbox"
                      checked={allOn}
                      ref={el => { if (el) el.indeterminate = someOn; }}
                      onChange={() => toggleGroup(ids)}
                      onClick={e => e.stopPropagation()}
                      className="accent-blue-500"
                    />
                    <span className="text-xs font-semibold text-surface-200">{groupName}</span>
                    <span className="text-[10px] text-surface-500">({items.length})</span>
                  </button>
                  <div>
                    {items.map(ep => (
                      <label
                        key={ep.request.id}
                        className="flex items-center gap-2 px-3 py-1.5 pl-8 hover:bg-surface-850 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={chosenIds.has(ep.request.id)}
                          onChange={() => toggleId(ep.request.id)}
                          className="accent-blue-500"
                        />
                        <span className={`text-[10px] font-mono font-bold ${methodColor(ep.request.method)}`}>
                          {ep.request.method}
                        </span>
                        <span className="text-xs text-surface-200 truncate">{ep.request.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
            {!grouped.length && (
              <p className="text-[11px] text-surface-500 p-3">No endpoints found in spec.</p>
            )}
          </div>

          {error && <p className="text-[11px] text-red-400">{error}</p>}

          <div className="flex justify-between pt-1">
            <button
              onClick={() => { setPreviewCol(null); setError(null); }}
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
                disabled={loading || chosenIds.size === 0 || (target === '__new__' && !newColName.trim())}
                onClick={confirmImport}
                className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-surface-800 disabled:text-surface-600 rounded transition-colors"
              >
                {loading ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface-900 border border-surface-700 rounded-xl shadow-2xl w-[420px] p-5 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-surface-100">Import Collection</h2>
          <button
            onClick={onClose}
            className="text-surface-500 hover:text-surface-300 text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Format cards */}
        <div className="grid grid-cols-2 gap-2">
          {OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => setSelected(selected === opt.id ? null : opt.id)}
              className={`p-3 rounded-lg border text-left transition-colors ${
                selected === opt.id
                  ? 'border-blue-500 bg-blue-950/50 text-blue-200'
                  : 'border-surface-700 bg-surface-800 hover:bg-surface-750 text-surface-300'
              }`}
            >
              <div className="text-xs font-semibold">{opt.label}</div>
              <div className="text-[10px] text-surface-500 mt-0.5">{opt.description}</div>
            </button>
          ))}
        </div>

        {/* OpenAPI URL input (shown only when OpenAPI selected) */}
        {selected === 'openapi' && (
          <div className="flex flex-col gap-2">
            <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">Or import from URL</p>
            <div className="flex gap-2">
              <input
                ref={urlInputRef}
                value={url}
                onChange={e => { setUrl(e.target.value); setError(null); }}
                onKeyDown={e => { if (e.key === 'Enter') importFromUrl(); }}
                placeholder="https://api.example.com/openapi.json"
                className="flex-1 text-xs bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 placeholder-surface-600 font-mono"
              />
              <button
                onClick={importFromUrl}
                disabled={!url.trim() || loading}
                className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-surface-800 disabled:text-surface-600 rounded transition-colors whitespace-nowrap"
              >
                {loading ? 'Fetching…' : 'From URL'}
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && <p className="text-[11px] text-red-400">{error}</p>}

        {/* Action row */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs bg-surface-800 hover:bg-surface-700 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!selected || loading}
            onClick={() => {
              const opt = OPTIONS.find(o => o.id === selected);
              if (opt) runFileImport(opt);
            }}
            className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-surface-800 disabled:text-surface-600 rounded transition-colors"
          >
            {loading ? 'Importing…' : 'Choose File'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Find the longest common URL prefix across `urls`, trimmed back to the last
 * `/` so we don't split a path segment in half. Returns '' if no useful
 * prefix is shared.
 */
function detectBaseUrl(urls: string[]): string {
  if (!urls.length) return '';
  let prefix = urls[0];
  for (const u of urls.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < u.length && prefix[i] === u[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  // Don't return a partial path segment — back off to last '/'
  if (!prefix.includes('://')) return '';
  const protoEnd = prefix.indexOf('://') + 3;
  const lastSlash = prefix.lastIndexOf('/');
  if (lastSlash > protoEnd) prefix = prefix.slice(0, lastSlash);
  // Strip trailing slash so `{{baseUrl}}/foo` doesn't become `{{baseUrl}}//foo`
  return prefix.replace(/\/$/, '');
}

function uniqueEnvName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let i = 2;
  while (existing.includes(`${base} (${i})`)) i++;
  return `${base} (${i})`;
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

/**
 * Walk the source folder tree, returning a clone that contains only requests
 * whose IDs are in `keep`. Empty folders (no requests in their subtree) are
 * dropped. Request IDs are preserved (caller will pull them from src.requests).
 */
function pruneFolder(
  src: Folder,
  _col: Collection,
  keep: Set<string>,
  _out: Record<string, ApiRequest>,
): Folder {
  const subFolders = src.folders
    .map(f => pruneFolder(f, _col, keep, _out))
    .filter(f => f.requestIds.length > 0 || f.folders.length > 0);
  const requestIds = src.requestIds.filter(id => keep.has(id));
  return {
    ...src,
    folders:    subFolders,
    requestIds,
  };
}

/** After pruning, collect the requests referenced by the pruned tree. */
function collectRequestsByFolder(folder: Folder, src: Collection): Record<string, ApiRequest> {
  const out: Record<string, ApiRequest> = {};
  function walk(f: Folder) {
    for (const id of f.requestIds) {
      if (src.requests[id]) out[id] = src.requests[id];
    }
    for (const sub of f.folders) walk(sub);
  }
  walk(folder);
  return out;
}
