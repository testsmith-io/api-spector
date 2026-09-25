// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { Fragment, useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../../store';
import type { RunRequestResult, RunSummary, RunnerItem } from '../../../../shared/types';
import { findFolder } from '../../store';
import { buildJsonReport, buildJUnitReport, buildHtmlReport } from '../../../../shared/report';
import { collectAllTags, buildRunPlan, expandRunPlanWithData, expandFolderDataSets, resolveInheritedAuthAndHeaders, authIsConfigured } from '../../../../shared/request-collection';
import { buildCliArgs, generateGitHub, generateAzure, generateGitLab } from '../../../../shared/ci-generators';
import { getMethodColor } from '../../../../shared/colors';
import { resolveEnvironmentById } from '../../hooks/useActiveEnvironment';
import { EmptyState } from '../common/EmptyState';
import { Modal } from '../common/Modal';
import { useT } from '../../i18n';

const { electron } = window;

// ─── Hook badge ──────────────────────────────────────────────────────────────

const HOOK_BADGE: Record<string, { label: string; cls: string }> = {
  beforeAll: { label: 'BEFORE ALL', cls: 'bg-violet-700 text-white' },
  before:    { label: 'BEFORE',     cls: 'bg-violet-600 text-white' },
  after:     { label: 'AFTER',      cls: 'bg-cyan-700   text-white' },
  afterAll:  { label: 'AFTER ALL',  cls: 'bg-cyan-800   text-white' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function collectRequests(
  collectionId: string,
  folderId: string | null,
  filterTags: string[],
) {
  const state = useStore.getState();
  const col   = state.collections[collectionId]?.data;
  if (!col) return [];
  return buildRunPlan(col, folderId, filterTags);
}

function allTagsIn(collectionId: string, folderId: string | null): string[] {
  const state = useStore.getState();
  const col   = state.collections[collectionId]?.data;
  if (!col) return [];
  const rootFolder = folderId
    ? findFolder(col.rootFolder, folderId) ?? col.rootFolder
    : col.rootFolder;
  return collectAllTags(rootFolder, col.requests);
}

// ─── Status indicator ─────────────────────────────────────────────────────────

function StatusDot({ status }: { status: RunRequestResult['status'] }) {
  const colors: Record<string, string> = {
    pending: 'bg-surface-700',
    running: 'bg-blue-400 animate-pulse',
    passed:  'bg-emerald-500',
    failed:  'bg-red-500',
    error:   'bg-orange-500',
    skipped: 'bg-surface-500',
  };
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${colors[status] ?? 'bg-surface-700'}`} />;
}

// ─── Per-request detail (same data the exported report carries) ───────────────

/** True when a result has anything worth expanding to show. */
function hasDetail(r: RunRequestResult): boolean {
  return !!(
    r.testResults?.length || r.consoleOutput?.length ||
    r.preScriptError || r.postScriptError || r.sentRequest || r.receivedResponse ||
    (r.error && !r.error.startsWith('Skipped'))
  );
}

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] uppercase tracking-wider text-surface-600 font-semibold">{label}</span>
      {children}
    </div>
  );
}

function KVRows({ rows }: { rows: [string, string][] }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2 font-mono text-[10px]">
          <span className="text-surface-500 shrink-0">{k}:</span>
          <span className="text-surface-300 break-all">{v}</span>
        </div>
      ))}
    </div>
  );
}

const PRE_CLS = 'text-[10px] font-mono text-surface-300 bg-surface-900 border border-surface-800 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-words max-h-56 overflow-y-auto';

function ResultDetail({ r }: { r: RunRequestResult }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3 text-xs">
      {r.testResults && r.testResults.length > 0 && (
        <DetailSection label={t('Tests')}>
          {r.testResults.map((tr, i) => (
            <div key={i} className="flex items-baseline gap-2">
              <span className={tr.passed ? 'text-emerald-400' : 'text-red-400'}>{tr.passed ? '✓' : '✗'}</span>
              <span className="text-surface-300">{tr.name}</span>
              {tr.error && <span className="text-red-400 font-mono text-[10px] break-all">{tr.error}</span>}
            </div>
          ))}
        </DetailSection>
      )}

      {(r.preScriptError || r.postScriptError) && (
        <DetailSection label={t('Script errors')}>
          {r.preScriptError && <p className="text-[10px] text-red-300 font-mono break-all">{t('Pre-script:')} {r.preScriptError}</p>}
          {r.postScriptError && <p className="text-[10px] text-red-300 font-mono break-all">{t('Post-script:')} {r.postScriptError}</p>}
        </DetailSection>
      )}

      {r.error && !r.error.startsWith('Skipped') && (
        <DetailSection label={t('Error')}>
          <p className="text-[10px] text-red-300 font-mono break-all">{r.error}</p>
        </DetailSection>
      )}

      {r.consoleOutput && r.consoleOutput.length > 0 && (
        <DetailSection label={t('Console')}>
          <pre className={PRE_CLS}>{r.consoleOutput.join('\n')}</pre>
        </DetailSection>
      )}

      <DetailSection label={t('Request')}>
        <p className="font-mono text-[10px] text-surface-300 break-all">{r.method} {r.resolvedUrl}</p>
        {r.sentRequest && <KVRows rows={Object.entries(r.sentRequest.headers ?? {})} />}
        {r.sentRequest?.body && <pre className={PRE_CLS}>{r.sentRequest.body}</pre>}
      </DetailSection>

      {r.receivedResponse && (
        <DetailSection label={t('Response')}>
          <p className="font-mono text-[10px]">
            <span className={r.receivedResponse.status < 400 ? 'text-emerald-400' : 'text-red-400'}>
              {r.receivedResponse.status} {r.receivedResponse.statusText}
            </span>
          </p>
          <KVRows rows={Object.entries(r.receivedResponse.headers ?? {})} />
          {r.receivedResponse.body && <pre className={PRE_CLS}>{r.receivedResponse.body}</pre>}
        </DetailSection>
      )}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RunnerModal() {
  const t = useT();
  const runnerModal         = useStore(s => s.runnerModal);
  const collections         = useStore(s => s.collections);
  const environments        = useStore(s => s.environments);
  const activeEnvId         = useStore(s => s.activeEnvironmentId);
  const globals             = useStore(s => s.globals);
  const workspaceSettings   = useStore(s => s.workspace?.settings);
  const runnerResults       = useStore(s => s.runnerResults);
  const runnerRunning       = useStore(s => s.runnerRunning);
  const closeRunner         = useStore(s => s.closeRunner);
  const setRunnerResults    = useStore(s => s.setRunnerResults);
  const patchRunnerResult   = useStore(s => s.patchRunnerResult);
  const setRunnerRunning    = useStore(s => s.setRunnerRunning);

  const [selectedEnvId, setSelectedEnvId] = useState<string>(activeEnvId ?? '');
  const [filterTags,    setFilterTags]    = useState<string[]>(runnerModal.filterTags);
  const [summary,       setSummary]       = useState<RunSummary | null>(null);
  const [copiedKey,     setCopiedKey]     = useState<string | null>(null);
  const [exportFormat,  setExportFormat]  = useState<'json' | 'junit' | 'html'>('json');
  const [requestDelay,  setRequestDelay]  = useState<number>(0);
  const [expandedRows,  setExpandedRows]  = useState<Set<number>>(new Set());

  const toggleRow = (idx: number) =>
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });

  const { collectionId, folderId } = runnerModal;
  const colEntry   = collectionId ? collections[collectionId] : null;
  const colName    = colEntry?.data.name ?? t('Collection');
  const folderName = folderId && colEntry
    ? (findFolder(colEntry.data.rootFolder, folderId)?.name ?? t('Folder'))
    : null;

  // When running a folder, its own dataset wins; otherwise use the collection's.
  const dataSet =
    ((folderId && colEntry ? findFolder(colEntry.data.rootFolder, folderId)?.dataSet : null)
      ?? colEntry?.data.dataSet) ?? { columns: [], rows: [] };
  const iterCount = dataSet.rows.length;

  const availableTags = collectionId ? allTagsIn(collectionId, folderId) : [];

  const progressIdxRef = useRef(0);
  const initFilterTagsRef = useRef(runnerModal.filterTags);
  initFilterTagsRef.current = runnerModal.filterTags;
  const initEnvIdRef = useRef(activeEnvId);
  initEnvIdRef.current = activeEnvId;

  // Reset when modal opens — reads refs so we snapshot values at open time
  // without re-running when filterTags or activeEnvId change mid-session
  useEffect(() => {
    setFilterTags(initFilterTagsRef.current);
    setSelectedEnvId(initEnvIdRef.current ?? '');
    setSummary(null);
    setExpandedRows(new Set());
    progressIdxRef.current = 0;
  }, [runnerModal.open]);

  const toggleTag = (tag: string) =>
    setFilterTags(prev => prev.includes(tag) ? prev.filter(tg => tg !== tag) : [...prev, tag]);

  // ── Run ───────────────────────────────────────────────────────────────────

  const run = useCallback(async () => {
    const ds =
      ((folderId && colEntry ? findFolder(colEntry.data.rootFolder, folderId)?.dataSet : null)
        ?? colEntry?.data.dataSet) ?? { columns: [], rows: [] };
    const baseItems = collectionId ? collectRequests(collectionId, folderId, filterTags) : [];
    if (baseItems.length === 0) return;

    // Data-table expansion:
    //  - Collection run: each folder's own data table iterates its requests.
    //  - Then the whole-scope table (the folder's for a folder run, else the
    //    collection's) repeats the plan once per row. No rows → a single pass.
    let items: RunnerItem[] = baseItems;
    if (!folderId && colEntry) items = expandFolderDataSets(items, colEntry.data);
    items = expandRunPlanWithData(items, ds);

    // Merge inherited auth/headers from collection/folder into each request
    // so the runner sees the effective auth, not just request-level overrides.
    // Deep-clone via JSON round-trip — store objects are frozen by Immer.
    const col = colEntry?.data;
    if (col) {
      items = items.map(item => {
        const inherited = resolveInheritedAuthAndHeaders(item.request.id, col);
        const req = JSON.parse(JSON.stringify(item.request));
        if (!authIsConfigured(req.auth) && inherited.auth && inherited.auth.type !== 'none') {
          req.auth = inherited.auth;
        }
        const inheritedHeaders = inherited.headers.filter(h => h.enabled && h.key);
        if (inheritedHeaders.length) {
          req.headers = [...inheritedHeaders, ...(req.headers ?? [])];
        }
        return { ...item, request: req };
      });
    }

    const env = resolveEnvironmentById(environments, selectedEnvId || null);

    setExpandedRows(new Set());
    setRunnerResults(items.map(item => ({
      requestId:      item.request.id,
      name:           item.request.name,
      method:         item.request.method,
      resolvedUrl:    item.request.url,
      status:         'pending',
      iterationLabel: item.iterationLabel,
      isHook:         item.isHook,
      hookType:       item.hookType,
      scopeId:        item.scopeId,
      scopePath:      item.scopePath,
    })));
    setSummary(null);
    setRunnerRunning(true);
    progressIdxRef.current = 0;

    electron.onRunProgress((result: RunRequestResult) => {
      const idx = progressIdxRef.current;
      patchRunnerResult(idx, result);
      if (result.status !== 'running') progressIdxRef.current++;
    });

    try {
      const s: RunSummary = await electron.runCollection({
        items,
        environment:     env,
        globals,
        proxy:           workspaceSettings?.proxy,
        tls:             workspaceSettings?.tls,
        piiMaskPatterns: workspaceSettings?.piiMaskPatterns,
        requestDelay,
      });
      setSummary(s);
    } finally {
      electron.offRunProgress();
      setRunnerRunning(false);
    }
   
  }, [collectionId, folderId, filterTags, selectedEnvId, environments, globals, colEntry, requestDelay, workspaceSettings, setRunnerResults, patchRunnerResult, setRunnerRunning]);

  if (!runnerModal.open) return null;

  const envName = selectedEnvId ? environments[selectedEnvId]?.data.name ?? null : null;

  function copyCI(key: string, content: string) {
    navigator.clipboard.writeText(content);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  return (
    <Modal
      onClose={closeRunner}
      overlayClassName="bg-black/50 z-50 flex items-start justify-center pt-16"
      panelClassName="bg-surface-900 border border-surface-800 rounded-lg shadow-2xl flex flex-col w-[680px] max-h-[80vh]"
      title={folderName ? t('Run: :name', { name: folderName }) : t('Run: :name', { name: colName })}
      subtitle={
        <>
          {folderName ? t('Folder in :name', { name: colName }) : t('Full collection')}
          {iterCount > 0 ? t(' · :count data iteration| · :count data iterations', { count: iterCount }) : ''}
        </>
      }
    >
        {/* Config — scrollable to handle tags + data + CI/CD */}
        <div className="px-4 py-3 border-b border-surface-800 flex flex-col gap-3 flex-shrink-0 overflow-y-auto max-h-[45vh]">

          {/* Env + Delay + Run */}
          <div className="flex gap-4 items-end">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[10px] text-surface-400 font-medium uppercase tracking-wider">{t('Environment')}</label>
              <select
                value={selectedEnvId}
                onChange={e => setSelectedEnvId(e.target.value)}
                className="text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              >
                <option value="">{t('(no environment)')}</option>
                {Object.values(environments).map(({ data: env }) => (
                  <option key={env.id} value={env.id}>{env.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-surface-400 font-medium uppercase tracking-wider">{t('Delay (ms)')}</label>
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
              className="px-4 py-1.5 text-xs text-white bg-emerald-700 hover:bg-emerald-600 disabled:bg-surface-800 disabled:text-surface-400 rounded font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"/>
              </svg>
              {runnerRunning ? t('Running…') : t('Run')}
            </button>
          </div>

          {/* Tag filter */}
          {availableTags.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-surface-400 font-medium uppercase tracking-wider">
                {t('Filter by tags')} {filterTags.length > 0 ? t('(:count active)', { count: filterTags.length }) : t('(all)')}
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
              {t('Data: :count iteration · :columns|Data: :count iterations · :columns', { count: iterCount, columns: dataSet.columns.join(', ') })}
            </p>
          )}

          {/* CI/CD export */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-surface-400 font-medium uppercase tracking-wider">{t('Export CI/CD')}</label>
            <div className="flex flex-wrap gap-1.5">
              <button
                className="px-2 py-1 text-[10px] bg-surface-800 hover:bg-surface-700 rounded transition-colors whitespace-nowrap"
                onClick={() => copyCI('cli', buildCliArgs('./workspace.json', envName, filterTags))}
              >
                {copiedKey === 'cli' ? t('✓ Copied') : t('⊞ CLI command')}
              </button>
              <button
                className="px-2 py-1 text-[10px] bg-surface-800 hover:bg-surface-700 rounded transition-colors whitespace-nowrap"
                onClick={() => copyCI('gh', generateGitHub(envName, filterTags))}
              >
                {copiedKey === 'gh' ? t('✓ Copied') : t('⊞ GitHub Actions')}
              </button>
              <button
                className="px-2 py-1 text-[10px] bg-surface-800 hover:bg-surface-700 rounded transition-colors whitespace-nowrap"
                onClick={() => copyCI('az', generateAzure(envName, filterTags))}
              >
                {copiedKey === 'az' ? t('✓ Copied') : t('⊞ Azure Pipelines')}
              </button>
              <button
                className="px-2 py-1 text-[10px] bg-surface-800 hover:bg-surface-700 rounded transition-colors whitespace-nowrap"
                onClick={() => copyCI('gl', generateGitLab(envName, filterTags))}
              >
                {copiedKey === 'gl' ? t('✓ Copied') : t('⊞ GitLab CI')}
              </button>
            </div>
          </div>

        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {runnerResults.length === 0 ? (
            <EmptyState message={t('Configure the run above and press Run.')} />
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {runnerResults.map((r, idx) => {
                  const scopeKey  = (r.scopePath ?? []).join(' / ');
                  const prevScope = idx > 0 ? (runnerResults[idx - 1].scopePath ?? []).join(' / ') : null;
                  const showHeading = scopeKey !== '' && scopeKey !== prevScope;
                  return (
                    <Fragment key={idx}>
                      {showHeading && (
                        <tr className="bg-surface-800/40">
                          <td colSpan={6} className="px-4 py-1.5 text-[10px] uppercase tracking-wider font-semibold text-surface-400">
                            <span className="text-surface-600">▸ </span>{scopeKey}
                          </td>
                        </tr>
                      )}
                  <tr
                    onClick={() => hasDetail(r) && toggleRow(idx)}
                    className={`border-b border-surface-800/50 hover:bg-surface-800/30 ${r.isHook ? 'opacity-80' : ''} ${hasDetail(r) ? 'cursor-pointer' : ''}`}
                  >
                    <td className="px-4 py-2 w-6">
                      <div className="flex items-center gap-1">
                        <span className="w-3 text-surface-600 text-[22px] leading-none">{hasDetail(r) ? (expandedRows.has(idx) ? '▾' : '▸') : ''}</span>
                        <StatusDot status={r.status} />
                      </div>
                    </td>
                    <td className="py-2 pr-2 w-20">
                      {r.isHook && r.hookType ? (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide whitespace-nowrap ${HOOK_BADGE[r.hookType]?.cls ?? ''}`}>
                          {t(HOOK_BADGE[r.hookType]?.label ?? '')}
                        </span>
                      ) : (
                        <span className={`text-[10px] font-bold ${getMethodColor(r.method)}`}>{r.method}</span>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      <div className={`truncate max-w-[260px] ${r.isHook ? 'text-surface-400 italic' : 'text-[var(--text-primary)]'}`}>
                        {r.name}
                        {r.iterationLabel && (
                          <span className="ml-1.5 text-[10px] text-surface-500 font-mono">#{r.iterationLabel}</span>
                        )}
                      </div>
                      <div className="text-[10px] text-surface-500 font-mono truncate max-w-[260px]">{r.resolvedUrl}</div>
                    </td>
                    <td className="py-2 pr-2 text-right text-surface-400 w-20">
                      {r.httpStatus ? (
                        <span className={`font-mono ${r.httpStatus < 400 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {r.httpStatus}
                        </span>
                      ) : r.error ? (
                        <span className="text-red-400 text-[10px]">{t('error')}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4 text-right w-16 text-surface-400">
                      {r.durationMs !== undefined && <span>{r.durationMs}ms</span>}
                    </td>
                    <td className="py-2 pr-4 w-24">
                      {r.testResults && r.testResults.length > 0 && (
                        <span className={`text-[10px] ${
                          r.testResults.every(tr => tr.passed) ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {t(':passed/:total tests', { passed: r.testResults.filter(tr => tr.passed).length, total: r.testResults.length })}
                        </span>
                      )}
                      {r.error && !r.error.startsWith('Skipped') && (
                        <span className="text-[10px] text-orange-400" title={r.error}>{t('⚠ :error', { error: r.error.slice(0, 30) })}</span>
                      )}
                      {r.error?.startsWith('Skipped') && (
                        <span className="text-[10px] text-surface-500 italic">{t('skipped')}</span>
                      )}
                    </td>
                  </tr>
                  {expandedRows.has(idx) && hasDetail(r) && (
                    <tr className="border-b border-surface-800/50 bg-surface-950/40">
                      <td colSpan={6} className="px-6 py-3">
                        <ResultDetail r={r} />
                      </td>
                    </tr>
                  )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Summary bar */}
        {summary && (
          <div className="flex items-center gap-3 px-4 py-2 border-t border-surface-800 bg-surface-800/30 flex-shrink-0 text-xs">
            <span className="text-emerald-400 font-medium">{t(':count passed', { count: summary.passed })}</span>
            {summary.failed > 0 && <span className="text-red-400 font-medium">{t(':count failed', { count: summary.failed })}</span>}
            {summary.errors > 0 && <span className="text-orange-400 font-medium">{t(':count errors', { count: summary.errors })}</span>}
            {summary.skipped > 0 && (
              <span className="text-surface-400 font-medium" title={t('Requests with no assertions to verify')}>
                {t(':count no tests', { count: summary.skipped })}
              </span>
            )}
            <span className="text-surface-400">{t(':count total', { count: summary.total })} · {summary.durationMs}ms</span>

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
                  };
                  const content = exportFormat === 'junit' ? buildJUnitReport(runnerResults, summary, meta)
                    : exportFormat === 'html'  ? buildHtmlReport(runnerResults, summary, meta)
                    : buildJsonReport(runnerResults, summary, meta);
                  const ext = exportFormat === 'junit' ? 'xml' : exportFormat === 'html' ? 'html' : 'json';
                  electron.saveResults(content, `spector-results.${ext}`);
                }}
                className="px-2.5 py-0.5 bg-surface-800 hover:bg-surface-700 rounded transition-colors text-[11px] whitespace-nowrap"
              >
                {t('Export results')}
              </button>
            </div>
          </div>
        )}
    </Modal>
  );
}
