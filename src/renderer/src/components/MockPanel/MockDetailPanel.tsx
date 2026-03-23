import React, { useState } from 'react'
import { useStore } from '../../store'
import type { MockRoute, MockServer } from '../../../../shared/types'
import { v4 as uuidv4 } from 'uuid'
import { getMethodColor } from '../../../../shared/colors'

const { electron } = window as any

const METHODS_PLUS_ANY = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

// ─── Route row ────────────────────────────────────────────────────────────────

function RouteRow({
  route,
  onSave,
  onDelete,
  initialEditing = false,
}: {
  route: MockRoute
  onSave: (r: MockRoute) => void
  onDelete: () => void
  initialEditing?: boolean
}) {
  const [editing, setEditing] = useState(initialEditing)
  const [draft,   setDraft]   = useState(route)

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
        <span className={`text-xs font-mono w-10 text-right shrink-0 ${
          draft.statusCode < 300 ? 'text-emerald-400' :
          draft.statusCode < 400 ? 'text-amber-400' : 'text-red-400'
        }`}>{draft.statusCode}</span>
        {draft.delay ? (
          <span className="text-[11px] text-surface-600 shrink-0">{draft.delay}ms</span>
        ) : null}
        <button
          onClick={() => { setDraft(route); setEditing(true) }}
          className="opacity-0 group-hover:opacity-100 text-xs text-surface-600 hover:text-surface-200 transition-opacity px-1"
        >
          Edit
        </button>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-xs text-surface-600 hover:text-red-400 transition-opacity"
        >
          ✕
        </button>
      </div>
    )
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
        <label className="text-[11px] text-surface-400 uppercase tracking-wider block mb-1">Response body</label>
        <textarea
          value={draft.body}
          onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
          placeholder='{"message": "ok"}'
          rows={6}
          className="w-full bg-surface-800 border border-surface-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500 resize-y placeholder-surface-700"
        />
      </div>

      {/* Response headers */}
      <div>
        <p className="text-[11px] text-surface-400 uppercase tracking-wider mb-2">Response headers</p>
        {Object.entries(draft.headers).map(([k, v]) => (
          <div key={k} className="flex gap-2 mb-2">
            <input
              value={k}
              onChange={e => {
                const h = { ...draft.headers }; delete h[k]; h[e.target.value] = v
                setDraft(d => ({ ...d, headers: h }))
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
              onClick={() => { const h = { ...draft.headers }; delete h[k]; setDraft(d => ({ ...d, headers: h })) }}
              className="text-surface-600 hover:text-red-400 px-1 text-sm"
            >✕</button>
          </div>
        ))}
        <button
          onClick={() => setDraft(d => ({ ...d, headers: { ...d.headers, '': '' } }))}
          className="text-xs text-blue-400 hover:text-blue-300"
        >+ Add header</button>
      </div>

      <div className="flex gap-2 pt-1 border-t border-surface-800">
        <button
          onClick={() => { onSave(draft); setEditing(false) }}
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
  )
}

// ─── Request log ──────────────────────────────────────────────────────────────


function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function RequestLog({ serverId, routes }: { serverId: string; routes: MockRoute[] }) {
  const hits      = useStore(s => s.mockLogs[serverId] ?? [])
  const clearLogs = useStore(s => s.clearMockLogs)
  const routeMap  = new Map(routes.map(r => [r.id, r]))

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
          <p className="text-sm text-surface-400 text-center">
            No requests yet.<br />
            <span className="text-xs">Start the server and send a request.</span>
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Column headers */}
          <div className="flex items-center gap-3 px-4 py-1.5 border-b border-surface-800 text-[10px] uppercase tracking-wider text-surface-400 sticky top-0 bg-surface-950">
            <span className="w-16 shrink-0">Method</span>
            <span className="flex-1">Path</span>
            <span className="w-32 shrink-0">Matched route</span>
            <span className="w-12 text-right shrink-0">Status</span>
            <span className="w-14 text-right shrink-0">Duration</span>
            <span className="w-20 text-right shrink-0">Time</span>
          </div>

          {hits.map(hit => {
            const matched   = hit.matchedRouteId ? routeMap.get(hit.matchedRouteId) : null
            const unmatched = !hit.matchedRouteId
            return (
              <div
                key={hit.id}
                className={`flex items-center gap-3 px-4 py-2 border-b border-surface-800/40 text-sm font-mono ${
                  unmatched ? 'bg-red-950/30' : 'hover:bg-surface-800/20'
                }`}
              >
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
                <span className="w-20 text-right shrink-0 text-surface-400 text-xs" title={String(hit.timestamp)}>
                  {timeAgo(hit.timestamp)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── MockDetailPanel ──────────────────────────────────────────────────────────

export function MockDetailPanel({ mockId }: { mockId: string }) {
  const entry      = useStore(s => s.mocks[mockId])
  const updateMock = useStore(s => s.updateMock)
  const deleteMock = useStore(s => s.deleteMock)
  const setRunning = useStore(s => s.setMockRunning)
  const setActive  = useStore(s => s.setActiveMockId)
  const workspace  = useStore(s => s.workspace)

  const [editMeta,   setEditMeta]   = useState(false)
  const [nameDraft,  setNameDraft]  = useState(entry?.data.name ?? '')
  const [portDraft,  setPortDraft]  = useState(String(entry?.data.port ?? ''))
  const [error,      setError]      = useState<string | null>(null)
  const [newRouteId, setNewRouteId] = useState<string | null>(null)
  const [activeTab,  setActiveTab]  = useState<'routes' | 'requests'>('routes')

  if (!entry) return null
  const { data: mock, running } = entry

  async function save(updated: MockServer) {
    updateMock(mock.id, updated)
    await electron.saveMock(entry.relPath, updated)
    if (running) await electron.mockUpdateRoutes(mock.id, updated.routes)
    if (workspace) await electron.saveWorkspace(workspace)
  }

  async function toggleRunning() {
    setError(null)
    try {
      if (running) {
        await electron.mockStop(mock.id)
        setRunning(mock.id, false)
      } else {
        const latest = useStore.getState().mocks[mock.id].data
        await electron.saveMock(entry.relPath, latest)
        await electron.mockStart(latest)
        setRunning(mock.id, true)
      }
    } catch (e: any) {
      setError(e.message ?? String(e))
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
    }
    setNewRouteId(route.id)
    setActiveTab('routes')
    save({ ...mock, routes: [...mock.routes, route] })
  }

  function saveMeta() {
    const port = Number(portDraft)
    if (!port || port < 1 || port > 65535) return
    save({ ...mock, name: nameDraft, port })
    setEditMeta(false)
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
              onKeyDown={e => { if (e.key === 'Enter') saveMeta(); if (e.key === 'Escape') setEditMeta(false) }}
              className="flex-1 max-w-xs bg-surface-800 border border-surface-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
            />
            <span className="text-surface-400">:</span>
            <input
              value={portDraft}
              onChange={e => setPortDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveMeta(); if (e.key === 'Escape') setEditMeta(false) }}
              className="w-20 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:border-blue-500"
            />
            <button onClick={saveMeta} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm transition-colors">Save</button>
            <button onClick={() => setEditMeta(false)} className="px-3 py-1 bg-surface-800 hover:bg-surface-700 rounded text-sm transition-colors">Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => { setNameDraft(mock.name); setPortDraft(String(mock.port)); setEditMeta(true) }}
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
          <button
            onClick={() => {
              if (running) electron.mockStop(mock.id)
              deleteMock(mock.id)
              setActive(null)
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
            {tab === 'routes' && mock.routes.length > 0 && (
              <span className="ml-1.5 bg-surface-700 text-surface-300 rounded px-1.5 py-0.5 text-[10px]">
                {mock.routes.length}
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
              {mock.routes.length === 0 ? (
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
                mock.routes.map(route => (
                  <RouteRow
                    key={route.id}
                    route={route}
                    onSave={updated => {
                      save({ ...mock, routes: mock.routes.map(r => r.id === route.id ? updated : r) })
                      setNewRouteId(null)
                    }}
                    onDelete={() => save({ ...mock, routes: mock.routes.filter(r => r.id !== route.id) })}
                    initialEditing={route.id === newRouteId}
                  />
                ))
              )}
            </div>
            {mock.routes.length > 0 && (
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
          <RequestLog serverId={mock.id} routes={mock.routes} />
        )}
      </div>
    </div>
  )
}
