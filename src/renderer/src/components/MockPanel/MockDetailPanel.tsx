// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

import React, { useState, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { useStore } from '../../store';
import type { MockRoute, MockServer, MockHit } from '../../../../shared/types';
import { v4 as uuidv4 } from 'uuid';
import { getMethodColor } from '../../../../shared/colors';
import {
  mockBodyCompletionExtension,
  mockScriptCompletionExtension,
} from '../RequestBuilder/atCompletions';

const { electron } = window;

const METHODS_PLUS_ANY = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

// ─── Route row ────────────────────────────────────────────────────────────────

function RouteRow({
  route,
  onSave,
  onDelete,
  onDuplicate,
  initialEditing = false,
}: {
  route: MockRoute
  onSave: (r: MockRoute) => void
  onDelete: () => void
  onDuplicate: () => void
  initialEditing?: boolean
}) {
  const [editing,      setEditing]      = useState(initialEditing);
  const [draft,        setDraft]        = useState(route);
  const [scriptOpen,   setScriptOpen]   = useState(!!(route.script?.trim()));

  // Derive path param names (e.g. /users/:id → ['id'])
  const pathParamNames = useMemo(
    () => draft.path.split('/').filter(p => p.startsWith(':')).map(p => p.slice(1)),
    [draft.path],
  );

  const bodyExt = useMemo(
    () => [json(), mockBodyCompletionExtension(pathParamNames)],
    [pathParamNames],
  );

  const scriptExt = useMemo(
    () => [javascript(), mockScriptCompletionExtension()],
    [],
  );

  if (!editing) {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-surface-800 hover:bg-surface-800/40 group text-sm">
        <span className={`font-bold w-16 shrink-0 text-xs ${getMethodColor(draft.method)}`}>
          {draft.method}
        </span>
        <span className="font-mono text-surface-200 flex-1 truncate">{draft.path}</span>
        {draft.description && (
          <span className="text-surface-600 text-xs truncate max-w-[200px]">{draft.description}</span>
        )}
        {draft.script?.trim() && (
          <span className="text-[10px] text-purple-400/70 shrink-0">⚡ script</span>
        )}
        <span className={`text-xs font-mono w-10 text-right shrink-0 ${
          draft.statusCode < 300 ? 'text-emerald-400' :
          draft.statusCode < 400 ? 'text-amber-400' : 'text-red-400'
        }`}>{draft.statusCode}</span>
        {draft.delay ? (
          <span className="text-[11px] text-surface-600 shrink-0">{draft.delay}ms</span>
        ) : null}
        <button
          onClick={() => { setDraft(route); setEditing(true); }}
          className="opacity-0 group-hover:opacity-100 text-xs text-surface-600 hover:text-surface-200 transition-opacity px-1"
        >
          Edit
        </button>
        <button
          onClick={onDuplicate}
          className="opacity-0 group-hover:opacity-100 text-xs text-surface-600 hover:text-blue-400 transition-opacity"
          title="Duplicate route"
        >
          ⧉
        </button>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-xs text-surface-600 hover:text-red-400 transition-opacity"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-surface-700 bg-surface-900/60 px-4 py-4 flex flex-col gap-3">
      {/* Method + Path + Status */}
      <div className="flex gap-3 items-center">
        <select
          value={draft.method}
          onChange={e => setDraft(d => ({ ...d, method: e.target.value as MockRoute['method'] }))}
          className={`bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-xs font-bold focus:outline-none focus:border-blue-500 ${getMethodColor(draft.method)}`}
        >
          {METHODS_PLUS_ANY.map(m => <option key={m} value={m} className="text-white">{m}</option>)}
        </select>
        <input
          value={draft.path}
          onChange={e => setDraft(d => ({ ...d, path: e.target.value }))}
          placeholder="/path/:param"
          className="flex-1 bg-surface-800 border border-surface-700 rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-500 placeholder-surface-700"
        />
        <input
          type="number"
          value={draft.statusCode}
          onChange={e => setDraft(d => ({ ...d, statusCode: Number(e.target.value) }))}
          className="w-20 bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-sm font-mono text-center focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Description + Delay */}
      <div className="flex gap-3">
        <input
          value={draft.description ?? ''}
          onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
          placeholder="Description (optional)"
          className="flex-1 bg-surface-800 border border-surface-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 placeholder-surface-700"
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-surface-400 shrink-0">Delay ms</label>
          <input
            type="number"
            value={draft.delay ?? ''}
            onChange={e => setDraft(d => ({ ...d, delay: e.target.value ? Number(e.target.value) : undefined }))}
            placeholder="0"
            className="w-24 bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-500 placeholder-surface-700"
          />
        </div>
      </div>

      {/* Response body */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[11px] text-surface-400 uppercase tracking-wider">Response body</label>
          <span className="text-[10px] text-surface-600">
            Use <code className="text-surface-400">{'{{faker.person.firstName()}}'}</code>
            {pathParamNames.map(p => (
              <span key={p}>, <code className="text-blue-400/80">{`{{request.params.${p}}}`}</code></span>
            ))}
            {pathParamNames.length === 0 && (
              <span>, <code className="text-surface-400">{'{{request.params.id}}'}</code> <span className="text-surface-700">(add :id to path)</span></span>
            )}
            , <code className="text-surface-400">{'{{request.query.search}}'}</code>
          </span>
        </div>
        <div className="rounded overflow-hidden border border-surface-700">
          <CodeMirror
            value={draft.body}
            height="140px"
            theme={oneDark}
            extensions={bodyExt}
            onChange={v => setDraft(d => ({ ...d, body: v }))}
            basicSetup={{ lineNumbers: true, foldGutter: false, autocompletion: false }}
          />
        </div>
      </div>

      {/* Response headers */}
      <div>
        <p className="text-[11px] text-surface-400 uppercase tracking-wider mb-2">Response headers</p>
        {Object.entries(draft.headers).map(([k, v]) => (
          <div key={k} className="flex gap-2 mb-2">
            <input
              value={k}
              onChange={e => {
                const h = { ...draft.headers }; delete h[k]; h[e.target.value] = v;
                setDraft(d => ({ ...d, headers: h }));
              }}
              placeholder="Header-Name"
              className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:border-blue-500 placeholder-surface-700"
            />
            <input
              value={v}
              onChange={e => setDraft(d => ({ ...d, headers: { ...d.headers, [k]: e.target.value } }))}
              placeholder="value"
              className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:border-blue-500 placeholder-surface-700"
            />
            <button
              onClick={() => { const h = { ...draft.headers }; delete h[k]; setDraft(d => ({ ...d, headers: h })); }}
              className="text-surface-600 hover:text-red-400 px-1 text-sm"
            >✕</button>
          </div>
        ))}
        <button
          onClick={() => setDraft(d => ({ ...d, headers: { ...d.headers, '': '' } }))}
          className="text-xs text-blue-400 hover:text-blue-300"
        >+ Add header</button>
      </div>

      {/* Pre-response script */}
      <div>
        <button
          onClick={() => setScriptOpen(o => !o)}
          className="flex items-center gap-1.5 text-[11px] text-surface-400 uppercase tracking-wider hover:text-white transition-colors"
        >
          <span>{scriptOpen ? '▾' : '▸'}</span>
          <span>Pre-response script</span>
          {draft.script?.trim() && <span className="text-purple-400 normal-case font-normal tracking-normal ml-1">⚡ active</span>}
        </button>

        {scriptOpen && (
          <div className="mt-2 flex flex-col gap-1.5">
            <p className="text-[10px] text-surface-600">
              Runs before the response is sent.
              Mutate <code className="text-surface-400">response.statusCode</code>,{' '}
              <code className="text-surface-400">response.body</code>,{' '}
              <code className="text-surface-400">response.headers</code>.
              Access <code className="text-surface-400">request.params</code>,{' '}
              <code className="text-surface-400">request.query</code>,{' '}
              <code className="text-surface-400">request.body</code>,{' '}
              <code className="text-surface-400">faker</code>, <code className="text-surface-400">dayjs</code>.
            </p>
            <div className="rounded overflow-hidden border border-surface-700">
              <CodeMirror
                value={draft.script ?? ''}
                height="140px"
                theme={oneDark}
                extensions={scriptExt}
                onChange={v => setDraft(d => ({ ...d, script: v }))}
                basicSetup={{ lineNumbers: true, foldGutter: false, autocompletion: false }}
                placeholder={`// Example:\n// if (request.params.id === '0') {\n//   response.statusCode = 404;\n//   response.body = JSON.stringify({ error: 'Not found' });\n// }`}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-1 border-t border-surface-800">
        <button
          onClick={() => { onSave(draft); setEditing(false); }}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors"
        >
          Save route
        </button>
        <button
          onClick={() => setEditing(false)}
          className="px-4 py-1.5 bg-surface-800 hover:bg-surface-700 rounded text-sm transition-colors"
        >
          Cancel
        </button>
        <button onClick={onDelete} className="ml-auto px-4 py-1.5 text-red-400 hover:text-red-300 text-sm">
          Delete route
        </button>
      </div>
    </div>
  );
}

// ─── Request log ──────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function HitRow({ hit, matched }: { hit: MockHit; matched: MockRoute | undefined | null }) {
  const [open, setOpen] = useState(false);
  const unmatched = !hit.matchedRouteId;

  // Pretty-print JSON response body if possible
  const prettyBody = useMemo(() => {
    if (!hit.responseBody) return null;
    try { return JSON.stringify(JSON.parse(hit.responseBody), null, 2); }
    catch { return hit.responseBody; }
  }, [hit.responseBody]);

  return (
    <div className={`border-b border-surface-800/40 ${unmatched ? 'bg-red-950/20' : ''}`}>
      {/* Summary row */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-3 px-4 py-2 text-sm font-mono text-left ${
          unmatched ? '' : 'hover:bg-surface-800/20'
        } transition-colors`}
      >
        <span className="text-surface-600 text-[10px] w-3 shrink-0">{open ? '▾' : '▸'}</span>
        <span className={`font-bold w-16 shrink-0 text-xs ${getMethodColor(hit.method)}`}>
          {hit.method}
        </span>
        <span className="flex-1 truncate text-surface-200" title={hit.path}>
          {hit.path}
        </span>
        <span className="w-32 shrink-0 truncate text-surface-600 text-xs font-sans" title={matched?.description ?? matched?.path ?? ''}>
          {unmatched
            ? <span className="text-red-400">no match</span>
            : (matched?.description || matched?.path || '—')}
        </span>
        <span className={`w-12 text-right shrink-0 text-xs ${
          hit.status < 300 ? 'text-emerald-400' :
          hit.status < 400 ? 'text-amber-400' : 'text-red-400'
        }`}>{hit.status}</span>
        <span className="w-14 text-right shrink-0 text-surface-600 text-xs">{hit.durationMs}ms</span>
        <span className="w-20 text-right shrink-0 text-surface-400 text-xs">
          {timeAgo(hit.timestamp)}
        </span>
      </button>

      {/* Expanded response detail */}
      {open && (
        <div className="px-4 pb-3 bg-surface-900/60 border-t border-surface-800/40">
          {/* Response headers */}
          {hit.responseHeaders && Object.keys(hit.responseHeaders).length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-wider text-surface-600 mb-1">Response headers</p>
              <div className="font-mono text-xs space-y-0.5">
                {Object.entries(hit.responseHeaders).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="text-surface-400 shrink-0">{k}:</span>
                    <span className="text-surface-300 break-all">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Response body */}
          <div className="mt-2">
            <p className="text-[10px] uppercase tracking-wider text-surface-600 mb-1">Response body</p>
            {prettyBody
              ? <pre className="font-mono text-xs text-surface-300 bg-surface-950 rounded p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-all">{prettyBody}</pre>
              : <span className="text-xs text-surface-600 italic">empty</span>
            }
          </div>
        </div>
      )}
    </div>
  );
}

function RequestLog({ serverId, routes, running }: { serverId: string; routes: MockRoute[]; running: boolean }) {
  const hits      = useStore(s => s.mockLogs[serverId]) ?? [];
  const clearLogs = useStore(s => s.clearMockLogs);
  const routeMap  = useMemo(() => new Map((routes ?? []).map(r => [r.id, r])), [routes]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-4 py-2 border-b border-surface-800 flex-shrink-0">
        <span className="text-xs text-surface-600 font-semibold uppercase tracking-wider">
          Requests {hits.length > 0 && <span className="text-surface-400 normal-case font-normal tracking-normal">({hits.length})</span>}
        </span>
        {hits.length > 0 && (
          <button
            onClick={() => clearLogs(serverId)}
            className="text-xs text-surface-400 hover:text-red-400 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {hits.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          {!running ? (
            <div className="text-center">
              <p className="text-sm text-surface-400">Server is not running.</p>
              <p className="text-xs text-surface-600 mt-1">Start the server to begin capturing requests.</p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-sm text-surface-400">No requests yet.</p>
              <p className="text-xs text-surface-600 mt-1">Waiting for incoming requests…</p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Column headers */}
          <div className="flex items-center gap-3 px-4 py-1.5 border-b border-surface-800 text-[10px] uppercase tracking-wider text-surface-400 sticky top-0 bg-surface-950">
            <span className="w-3 shrink-0" />
            <span className="w-16 shrink-0">Method</span>
            <span className="flex-1">Path</span>
            <span className="w-32 shrink-0">Matched route</span>
            <span className="w-12 text-right shrink-0">Status</span>
            <span className="w-14 text-right shrink-0">Duration</span>
            <span className="w-20 text-right shrink-0">Time</span>
          </div>

          {hits.map(hit => (
            <HitRow
              key={hit.id}
              hit={hit}
              matched={hit.matchedRouteId ? routeMap.get(hit.matchedRouteId) : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── MockDetailPanel ──────────────────────────────────────────────────────────

export function MockDetailPanel({ mockId }: { mockId: string }) {
  const entry      = useStore(s => s.mocks[mockId]);
  const updateMock = useStore(s => s.updateMock);
  const deleteMock = useStore(s => s.deleteMock);
  const setRunning = useStore(s => s.setMockRunning);
  const setActive  = useStore(s => s.setActiveMockId);
  const workspace  = useStore(s => s.workspace);

  const [editMeta,   setEditMeta]   = useState(false);
  const [nameDraft,  setNameDraft]  = useState(entry?.data.name ?? '');
  const [portDraft,  setPortDraft]  = useState(String(entry?.data.port ?? ''));
  const [error,      setError]      = useState<string | null>(null);
  const [newRouteId, setNewRouteId] = useState<string | null>(null);
  const [activeTab,  setActiveTab]  = useState<'routes' | 'requests'>('routes');

  if (!entry) return null;
  const { data: mock, running } = entry;
  const routes = mock.routes ?? [];

  async function save(updated: MockServer) {
    updateMock(mock.id, updated);
    await electron.saveMock(entry.relPath, updated);
    if (running) await electron.mockUpdateRoutes(mock.id, updated.routes ?? []);
    if (workspace) await electron.saveWorkspace(workspace);
  }

  async function toggleRunning() {
    setError(null);
    try {
      if (running) {
        await electron.mockStop(mock.id);
        setRunning(mock.id, false);
      } else {
        const latest = useStore.getState().mocks[mock.id].data;
        await electron.saveMock(entry.relPath, latest);
        await electron.mockStart(latest);
        setRunning(mock.id, true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function addRoute() {
    const route: MockRoute = {
      id: uuidv4(),
      method: 'GET',
      path: '/endpoint',
      statusCode: 200,
      headers: {},
      body: '{\n  "message": "ok"\n}',
    };
    setNewRouteId(route.id);
    setActiveTab('routes');
    save({ ...mock, routes: [...routes, route] });
  }

  function saveMeta() {
    const port = Number(portDraft);
    if (!port || port < 1 || port > 65535) return;
    save({ ...mock, name: nameDraft, port });
    setEditMeta(false);
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-surface-800 flex-shrink-0 bg-surface-950">
        {editMeta ? (
          <div className="flex items-center gap-2 flex-1">
            <input
              autoFocus
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveMeta(); if (e.key === 'Escape') setEditMeta(false); }}
              className="flex-1 max-w-xs bg-surface-800 border border-surface-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
            />
            <span className="text-surface-400">:</span>
            <input
              value={portDraft}
              onChange={e => setPortDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveMeta(); if (e.key === 'Escape') setEditMeta(false); }}
              className="w-20 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:border-blue-500"
            />
            <button onClick={saveMeta} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm transition-colors">Save</button>
            <button onClick={() => setEditMeta(false)} className="px-3 py-1 bg-surface-800 hover:bg-surface-700 rounded text-sm transition-colors">Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => { setNameDraft(mock.name); setPortDraft(String(mock.port)); setEditMeta(true); }}
            className="flex items-center gap-2 hover:text-blue-400 transition-colors group"
            title="Click to edit name and port"
          >
            <span className="text-sm font-semibold">{mock.name}</span>
            <span className="text-surface-600 text-sm font-mono">:{mock.port}</span>
            <span className="text-[10px] text-surface-400 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
          </button>
        )}

        {running && (
          <a
            href={`http://127.0.0.1:${mock.port}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-mono text-emerald-400/80 hover:text-emerald-400 transition-colors"
          >
            http://127.0.0.1:{mock.port}
          </a>
        )}

        <div className="ml-auto flex items-center gap-2">
          {error && (
            <span className="text-xs text-red-400 max-w-xs truncate" title={error}>⚠ {error}</span>
          )}
          <div className="relative group/cli flex items-center">
            <button
              onClick={toggleRunning}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                running
                  ? 'bg-emerald-900/40 text-emerald-400 hover:bg-red-900/40 hover:text-red-400 border border-emerald-800/50'
                  : 'bg-surface-800 hover:bg-surface-700 text-surface-300 border border-surface-700'
              }`}
            >
              {running ? '● Running' : '▶ Start'}
            </button>
            {!running && (
              <div className="pointer-events-none absolute bottom-full right-0 mb-2 hidden group-hover/cli:block z-50">
                <div className="bg-[#1e1b2e] border border-white/10 rounded px-2.5 py-1.5 shadow-xl text-[11px] text-surface-300 whitespace-nowrap">
                  <span className="text-surface-500 mr-1">or run from CLI:</span>
                  <code className="text-blue-300">npx api-spector mock --workspace &lt;path&gt;</code>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => {
              if (running) electron.mockStop(mock.id);
              deleteMock(mock.id);
              setActive(null);
            }}
            className="px-2 py-1.5 text-sm text-surface-600 hover:text-red-400 transition-colors"
            title="Delete server"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-surface-800 px-5 gap-0 flex-shrink-0 bg-surface-950">
        {(['routes', 'requests'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs border-b-2 -mb-px capitalize transition-colors ${
              activeTab === tab
                ? 'border-blue-500 text-white'
                : 'border-transparent text-surface-400 hover:text-white'
            }`}
          >
            {tab}
            {tab === 'routes' && routes.length > 0 && (
              <span className="ml-1.5 bg-surface-700 text-surface-300 rounded px-1.5 py-0.5 text-[10px]">
                {routes.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'routes' && (
          <div className="flex flex-col h-full min-h-0">
            <div className="flex-1 overflow-y-auto">
              {routes.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <p className="text-surface-400 text-sm">No routes defined.</p>
                  <button
                    onClick={addRoute}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors"
                  >
                    + Add first route
                  </button>
                </div>
              ) : (
                routes.map(route => (
                  <RouteRow
                    key={route.id}
                    route={route}
                    onSave={updated => {
                      save({ ...mock, routes: routes.map(r => r.id === route.id ? updated : r) });
                      setNewRouteId(null);
                    }}
                    onDelete={() => save({ ...mock, routes: routes.filter(r => r.id !== route.id) })}
                    onDuplicate={() => {
                      const copy = { ...route, id: uuidv4() };
                      const idx = routes.indexOf(route);
                      const next = [...routes.slice(0, idx + 1), copy, ...routes.slice(idx + 1)];
                      save({ ...mock, routes: next });
                    }}
                    initialEditing={route.id === newRouteId}
                  />
                ))
              )}
            </div>
            {routes.length > 0 && (
              <div className="px-4 py-3 border-t border-surface-800 flex-shrink-0">
                <button
                  onClick={addRoute}
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  + Add route
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'requests' && (
          <RequestLog serverId={mock.id} routes={routes} running={running} />
        )}
      </div>
    </div>
  );
}
