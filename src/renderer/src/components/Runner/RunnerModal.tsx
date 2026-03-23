import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '../../store'
import type { RunRequestResult, RunSummary, RunnerItem } from '../../../../shared/types'
import { findFolder } from '../../store'
import { buildJsonReport, buildJUnitReport, buildHtmlReport } from '../../../../shared/report'
import { collectTagged, collectAllTags } from '../../../../shared/request-collection'
import { buildCliArgs, generateGitHub, generateAzure, generateGitLab } from '../../../../shared/ci-generators'
import { getMethodColor } from '../../../../shared/colors'
import { EmptyState } from '../common/EmptyState'

const { electron } = window as any

// ─── Helpers ─────────────────────────────────────────────────────────────────

function collectRequests(
  collectionId: string,
  folderId: string | null,
  filterTags: string[],
) {
  const state = useStore.getState()
  const col   = state.collections[collectionId]?.data
  if (!col) return []
  const collectionVars = col.collectionVariables ?? {}
  const rootFolder     = folderId
    ? findFolder(col.rootFolder, folderId) ?? col.rootFolder
    : col.rootFolder
  return collectTagged(rootFolder, col.requests, collectionVars, filterTags)
}

function allTagsIn(collectionId: string, folderId: string | null): string[] {
  const state = useStore.getState()
  const col   = state.collections[collectionId]?.data
  if (!col) return []
  const rootFolder = folderId
    ? findFolder(col.rootFolder, folderId) ?? col.rootFolder
    : col.rootFolder
  return collectAllTags(rootFolder, col.requests)
}

// ─── Status indicator ─────────────────────────────────────────────────────────

function StatusDot({ status }: { status: RunRequestResult['status'] }) {
  const colors: Record<string, string> = {
    pending: 'bg-surface-700',
    running: 'bg-blue-400 animate-pulse',
    passed:  'bg-emerald-500',
    failed:  'bg-red-500',
    error:   'bg-orange-500',
  }
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${colors[status] ?? 'bg-surface-700'}`} />
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RunnerModal() {
  const runnerModal         = useStore(s => s.runnerModal)
  const collections         = useStore(s => s.collections)
  const environments        = useStore(s => s.environments)
  const activeEnvId         = useStore(s => s.activeEnvironmentId)
  const globals             = useStore(s => s.globals)
  const workspaceSettings   = useStore(s => s.workspace?.settings)
  const runnerResults       = useStore(s => s.runnerResults)
  const runnerRunning       = useStore(s => s.runnerRunning)
  const closeRunner         = useStore(s => s.closeRunner)
  const setRunnerResults    = useStore(s => s.setRunnerResults)
  const patchRunnerResult   = useStore(s => s.patchRunnerResult)
  const setRunnerRunning    = useStore(s => s.setRunnerRunning)

  const [selectedEnvId, setSelectedEnvId] = useState<string>(activeEnvId ?? '')
  const [filterTags,    setFilterTags]    = useState<string[]>(runnerModal.filterTags)
  const [summary,       setSummary]       = useState<RunSummary | null>(null)
  const [copiedKey,     setCopiedKey]     = useState<string | null>(null)
  const [exportFormat,  setExportFormat]  = useState<'json' | 'junit' | 'html'>('json')
  const [requestDelay,  setRequestDelay]  = useState<number>(0)

  const { collectionId, folderId } = runnerModal
  const colEntry   = collectionId ? collections[collectionId] : null
  const colName    = colEntry?.data.name ?? 'Collection'
  const folderName = folderId && colEntry
    ? (findFolder(colEntry.data.rootFolder, folderId)?.name ?? 'Folder')
    : null

  const dataSet = colEntry?.data.dataSet ?? { columns: [], rows: [] }
  const iterCount = dataSet.rows.length

  const availableTags = collectionId ? allTagsIn(collectionId, folderId) : []

  const progressIdxRef = useRef(0)

  // Reset when modal opens
  useEffect(() => {
    setFilterTags(runnerModal.filterTags)
    setSelectedEnvId(activeEnvId ?? '')
    setSummary(null)
    progressIdxRef.current = 0
  }, [runnerModal.open])

  const toggleTag = (tag: string) =>
    setFilterTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])

  // ── Run ───────────────────────────────────────────────────────────────────

  const run = useCallback(async () => {
    const baseItems = collectionId ? collectRequests(collectionId, folderId, filterTags) : []
    if (baseItems.length === 0) return

    // Expand with data rows if defined
    let items: RunnerItem[]
    if (dataSet.rows.length > 0) {
      items = dataSet.rows.flatMap((row, ri) => {
        const dataRow: Record<string, string> = {}
        dataSet.columns.forEach((col, ci) => { dataRow[col] = row[ci] ?? '' })
        return baseItems.map(item => ({
          ...item,
          dataRow,
          iterationLabel: `${ri + 1}/${dataSet.rows.length}`,
        }))
      })
    } else {
      items = baseItems
    }

    const env = selectedEnvId ? environments[selectedEnvId]?.data ?? null : null

    setRunnerResults(items.map(item => ({
      requestId:      item.request.id,
      name:           item.request.name,
      method:         item.request.method,
      resolvedUrl:    item.request.url,
      status:         'pending',
      iterationLabel: item.iterationLabel,
    })))
    setSummary(null)
    setRunnerRunning(true)
    progressIdxRef.current = 0

    electron.onRunProgress((result: RunRequestResult) => {
      const idx = progressIdxRef.current
      patchRunnerResult(idx, result)
      if (result.status !== 'running') progressIdxRef.current++
    })

    try {
      const s: RunSummary = await electron.runCollection({
        items,
        environment:     env,
        globals,
        proxy:           workspaceSettings?.proxy,
        tls:             workspaceSettings?.tls,
        piiMaskPatterns: workspaceSettings?.piiMaskPatterns,
        requestDelay,
      })
      setSummary(s)
    } finally {
      electron.offRunProgress()
      setRunnerRunning(false)
    }
  }, [collectionId, folderId, filterTags, selectedEnvId, environments, globals, colEntry, requestDelay])

  if (!runnerModal.open) return null

  const envName = selectedEnvId ? environments[selectedEnvId]?.data.name ?? null : null

  function copyCI(key: string, content: string) {
    navigator.clipboard.writeText(content)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-16"
      onClick={closeRunner}
    >
      <div
        className="bg-surface-900 border border-surface-800 rounded-lg shadow-2xl flex flex-col w-[680px] max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-800 flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold">
              {folderName ? `Run: ${folderName}` : `Run: ${colName}`}
            </h2>
            <p className="text-[10px] text-surface-400 mt-0.5">
              {folderName ? `Folder in ${colName}` : 'Full collection'}
              {iterCount > 0 ? ` · ${iterCount} data iteration${iterCount !== 1 ? 's' : ''}` : ''}
            </p>
          </div>
          <button onClick={closeRunner} className="text-surface-400 hover:text-[var(--text-primary)] text-lg leading-none">×</button>
        </div>

        {/* Config — scrollable to handle tags + data + CI/CD */}
        <div className="px-4 py-3 border-b border-surface-800 flex flex-col gap-3 flex-shrink-0 overflow-y-auto max-h-[45vh]">

          {/* Env + Delay + Run */}
          <div className="flex gap-4 items-end">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[10px] text-surface-400 font-medium uppercase tracking-wider">Environment</label>
              <select
                value={selectedEnvId}
                onChange={e => setSelectedEnvId(e.target.value)}
                className="text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              >
                <option value="">— No environment —</option>
                {Object.values(environments).map(({ data: env }) => (
                  <option key={env.id} value={env.id}>{env.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-surface-400 font-medium uppercase tracking-wider">Delay (ms)</label>
              <input
                type="number"
                min={0}
                step={100}
                value={requestDelay}
                onChange={e => setRequestDelay(Math.max(0, Number(e.target.value)))}
                className="text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 w-24"
              />
            </div>
            <button
              onClick={run}
              disabled={runnerRunning}
              className="px-4 py-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 disabled:bg-surface-800 disabled:text-surface-400 rounded font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"/>
              </svg>
              {runnerRunning ? 'Running…' : 'Run'}
            </button>
          </div>

          {/* Tag filter */}
          {availableTags.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-surface-400 font-medium uppercase tracking-wider">
                Filter by tags {filterTags.length > 0 ? `(${filterTags.length} active)` : '(all)'}
              </label>
              <div className="flex flex-wrap gap-1">
                {availableTags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${
                      filterTags.includes(tag)
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-surface-800 border-surface-700 text-surface-400 hover:border-blue-500'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Data info */}
          {iterCount > 0 && (
            <p className="text-[10px] text-surface-500">
              Data: {iterCount} iteration{iterCount !== 1 ? 's' : ''} · {dataSet.columns.join(', ')}
            </p>
          )}

          {/* CI/CD export */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-surface-400 font-medium uppercase tracking-wider">Export CI/CD</label>
            <div className="flex flex-wrap gap-1.5">
              <button
                className="px-2 py-1 text-[10px] bg-surface-800 hover:bg-surface-700 rounded transition-colors whitespace-nowrap"
                onClick={() => copyCI('cli', buildCliArgs('./workspace.json', envName, filterTags))}
              >
                {copiedKey === 'cli' ? '✓ Copied' : '⊞ CLI command'}
              </button>
              <button
                className="px-2 py-1 text-[10px] bg-surface-800 hover:bg-surface-700 rounded transition-colors whitespace-nowrap"
                onClick={() => copyCI('gh', generateGitHub(envName, filterTags))}
              >
                {copiedKey === 'gh' ? '✓ Copied' : '⊞ GitHub Actions'}
              </button>
              <button
                className="px-2 py-1 text-[10px] bg-surface-800 hover:bg-surface-700 rounded transition-colors whitespace-nowrap"
                onClick={() => copyCI('az', generateAzure(envName, filterTags))}
              >
                {copiedKey === 'az' ? '✓ Copied' : '⊞ Azure Pipelines'}
              </button>
              <button
                className="px-2 py-1 text-[10px] bg-surface-800 hover:bg-surface-700 rounded transition-colors whitespace-nowrap"
                onClick={() => copyCI('gl', generateGitLab(envName, filterTags))}
              >
                {copiedKey === 'gl' ? '✓ Copied' : '⊞ GitLab CI'}
              </button>
            </div>
          </div>

        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {runnerResults.length === 0 ? (
            <EmptyState message="Configure the run above and press Run." />
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {runnerResults.map((r, idx) => (
                  <tr key={idx} className="border-b border-surface-800/50 hover:bg-surface-800/30">
                    <td className="px-4 py-2 w-6">
                      <StatusDot status={r.status} />
                    </td>
                    <td className="py-2 pr-2 w-12">
                      <span className={`text-[10px] font-bold ${getMethodColor(r.method)}`}>{r.method}</span>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="text-[var(--text-primary)] truncate max-w-[260px]">
                        {r.name}
                        {r.iterationLabel && (
                          <span className="ml-1.5 text-[10px] text-surface-500 font-mono">#{r.iterationLabel}</span>
                        )}
                      </div>
                      <div className="text-[10px] text-surface-400 font-mono truncate max-w-[260px]">{r.resolvedUrl}</div>
                    </td>
                    <td className="py-2 pr-2 text-right text-surface-400 w-20">
                      {r.httpStatus ? (
                        <span className={`font-mono ${r.httpStatus < 400 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {r.httpStatus}
                        </span>
                      ) : r.error ? (
                        <span className="text-red-400 text-[10px]">error</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4 text-right w-16 text-surface-400">
                      {r.durationMs !== undefined && <span>{r.durationMs}ms</span>}
                    </td>
                    <td className="py-2 pr-4 w-24">
                      {r.testResults && r.testResults.length > 0 && (
                        <span className={`text-[10px] ${
                          r.testResults.every(t => t.passed) ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {r.testResults.filter(t => t.passed).length}/{r.testResults.length} tests
                        </span>
                      )}
                      {r.error && (
                        <span className="text-[10px] text-orange-400" title={r.error}>⚠ {r.error.slice(0, 30)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Summary bar */}
        {summary && (
          <div className="flex items-center gap-3 px-4 py-2 border-t border-surface-800 bg-surface-950/50 flex-shrink-0 text-xs">
            <span className="text-emerald-400 font-medium">{summary.passed} passed</span>
            {summary.failed > 0 && <span className="text-red-400 font-medium">{summary.failed} failed</span>}
            {summary.errors > 0 && <span className="text-orange-400 font-medium">{summary.errors} errors</span>}
            <span className="text-surface-400">{summary.total} total · {summary.durationMs}ms</span>

            <div className="ml-auto flex items-center gap-1.5">
              <select
                value={exportFormat}
                onChange={e => setExportFormat(e.target.value as 'json' | 'junit' | 'html')}
                className="bg-surface-800 border border-surface-700 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-blue-500"
                style={{ color: 'var(--text-primary)' }}
              >
                <option value="json">JSON</option>
                <option value="junit">JUnit XML</option>
                <option value="html">HTML</option>
              </select>
              <button
                onClick={() => {
                  const meta = {
                    environment: selectedEnvId ? environments[selectedEnvId]?.data.name ?? null : null,
                    collection: colName,
                    timestamp: new Date().toISOString(),
                  }
                  const content = exportFormat === 'junit' ? buildJUnitReport(runnerResults, summary, meta)
                    : exportFormat === 'html'  ? buildHtmlReport(runnerResults, summary, meta)
                    : buildJsonReport(runnerResults, summary, meta)
                  const ext = exportFormat === 'junit' ? 'xml' : exportFormat === 'html' ? 'html' : 'json'
                  electron.saveResults(content, `spector-results.${ext}`)
                }}
                className="px-2.5 py-0.5 bg-surface-800 hover:bg-surface-700 rounded transition-colors text-[11px] whitespace-nowrap"
              >
                Export results
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
