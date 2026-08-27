// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useState } from 'react';
import { useStore } from '../../store';
import type { ContractResult, ContractViolation } from '../../../../shared/types';
import { getMethodColor } from '../../../../shared/colors';
import { Toast, useToast } from '../common/Toast';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusColor(code: number): string {
  const d = String(code)[0];
  return d === '2' ? 'text-emerald-400' : d === '3' ? 'text-amber-400' : 'text-red-400';
}

// ─── Violation row ────────────────────────────────────────────────────────────

function ViolationRow({ v }: { v: ContractViolation }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-2.5 border-l-2 border-red-600 bg-red-950/20 rounded-r">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-mono font-bold text-red-400 uppercase tracking-wide">
          {v.type.replace(/_/g, ' ')}
        </span>
        {v.path && (
          <span className="text-[10px] font-mono text-surface-500 bg-surface-800 px-1.5 py-0.5 rounded">
            {v.path}
          </span>
        )}
      </div>
      <p className="text-xs text-red-200">{v.message}</p>
      {(v.expected || v.actual) && (
        <div className="flex gap-4 text-[11px] font-mono mt-0.5">
          {v.expected && (
            <span>
              <span className="text-surface-500">expected </span>
              <span className="text-emerald-400">{v.expected}</span>
            </span>
          )}
          {v.actual && (
            <span>
              <span className="text-surface-500">actual </span>
              <span className="text-red-400">{v.actual}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Result card ─────────────────────────────────────────────────────────────

function ResultCard({ result }: { result: ContractResult }) {
  const [open, setOpen] = useState(!result.passed);

  return (
    <div className={`rounded-lg border overflow-hidden ${
      result.passed ? 'border-surface-700' : 'border-red-800/60'
    }`}>
      {/* Header row */}
      <button
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
          result.passed ? 'bg-surface-800 hover:bg-surface-750' : 'bg-red-950/30 hover:bg-red-950/50'
        }`}
      >
        {/* Pass / fail pill */}
        <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded ${
          result.passed
            ? 'bg-emerald-900/50 text-emerald-400'
            : 'bg-red-900/50 text-red-400'
        }`}>
          {result.passed ? 'PASS' : 'FAIL'}
        </span>

        {/* Method */}
        <span className={`shrink-0 text-xs font-bold font-mono w-14 ${getMethodColor(result.method)}`}>
          {result.method}
        </span>

        {/* Request name */}
        <span className="flex-1 text-sm text-white truncate">{result.requestName}</span>

        {/* URL (muted) */}
        <span className="hidden lg:block text-[11px] text-surface-500 font-mono truncate max-w-[260px]">
          {result.url}
        </span>

        {/* Status code */}
        {result.actualStatus !== undefined && (
          <span className={`shrink-0 text-xs font-mono font-bold ${statusColor(result.actualStatus)}`}>
            {result.actualStatus}
          </span>
        )}

        {/* Duration */}
        {result.durationMs !== undefined && (
          <span className="shrink-0 text-[11px] text-surface-500 w-14 text-right">
            {result.durationMs}ms
          </span>
        )}

        {/* Violation count */}
        {result.violations.length > 0 && (
          <span className="shrink-0 text-[10px] bg-red-900/50 text-red-300 rounded px-1.5 py-0.5 font-medium">
            {result.violations.length} {result.violations.length === 1 ? 'issue' : 'issues'}
          </span>
        )}

        <span className="shrink-0 text-surface-600 text-xs ml-1">{open ? '▲' : '▼'}</span>
      </button>

      {/* Expanded violations */}
      {open && (
        <div className="px-4 py-3 bg-surface-900 border-t border-surface-800 flex flex-col gap-2">
          {result.violations.length === 0 ? (
            <p className="text-xs text-emerald-400">All expectations met.</p>
          ) : (
            result.violations.map((v, i) => <ViolationRow key={i} v={v} />)
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ContractResultsPanel() {
  const report      = useStore(s => s.lastContractReport);
  const runMeta     = useStore(s => s.lastContractRunMeta);
  const clearReport = useStore(s => s.setLastContractReport);
  const activeCollId = useStore(s => s.activeCollectionId);
  const collections  = useStore(s => s.collections);

  const [recordOpen, setRecordOpen]   = useState(false);
  const [pacticipant, setPacticipant] = useState('');
  const [version, setVersion]         = useState('');
  const [saving, setSaving]           = useState(false);
  const { toast, show: showToast }    = useToast();

  async function recordRun() {
    if (!report) return;
    if (!pacticipant.trim() || !version.trim()) {
      showToast('Pacticipant and version are required to record.', false);
      return;
    }
    setSaving(true);
    try {
      await window.electron.recordContractResult({
        pacticipant: pacticipant.trim(),
        version: version.trim(),
        report,
      });
      showToast(`Recorded ${pacticipant.trim()}@${version.trim()} for the dashboard and can-i-deploy.`, true);
      setRecordOpen(false);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), false);
    } finally {
      setSaving(false);
    }
  }

  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
        <span className="text-4xl opacity-30">🔬</span>
        <p className="text-sm text-surface-500">No contract run yet.</p>
        <p className="text-xs text-surface-600">Configure a mode in the Contracts panel and click Run.</p>
      </div>
    );
  }

  const modeLabel = report.mode === 'bidirectional' ? 'Bi-directional' : report.mode.charAt(0).toUpperCase() + report.mode.slice(1);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Summary bar ── */}
      <div className={`flex items-center gap-4 px-6 py-3 border-b flex-shrink-0 ${
        report.failed === 0
          ? 'bg-emerald-950/30 border-emerald-800/50'
          : 'bg-red-950/30 border-red-800/50'
      }`}>
        <span className={`text-base font-bold ${report.failed === 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {report.failed === 0 ? '✓ All passed' : `✗ ${report.failed} failed`}
        </span>
        <span className="text-sm text-surface-400">
          {report.passed} / {report.total} passed
        </span>
        <span className="text-[11px] bg-surface-800 text-surface-400 px-2 py-0.5 rounded font-mono">
          {modeLabel}
        </span>
        <span className="text-xs text-surface-500 ml-auto">{report.durationMs}ms</span>
        <button
          onClick={() => {
            if (!recordOpen && !pacticipant) {
              setPacticipant(activeCollId ? collections[activeCollId]?.data.name ?? '' : '');
            }
            setRecordOpen(o => !o);
          }}
          className="text-[11px] text-surface-500 hover:text-surface-200 transition-colors"
          title="Record this run for the contract dashboard and can-i-deploy gate"
        >
          Record
        </button>
        <button
          onClick={() => window.electron.exportContractReportHtml(report, {
            spec: runMeta?.spec, provider: runMeta?.provider,
          })}
          className="text-[11px] text-surface-500 hover:text-surface-200 transition-colors"
          title="Export a self-contained HTML report"
        >
          Export HTML
        </button>
        <button
          onClick={() => clearReport(null)}
          className="text-[11px] text-surface-600 hover:text-surface-300 transition-colors"
          title="Clear results"
        >
          Clear
        </button>
      </div>

      {/* ── Record form ── */}
      {recordOpen && (
        <div className="flex items-center gap-2 px-6 py-2 border-b border-surface-800 bg-surface-900/60 flex-shrink-0">
          <input
            value={pacticipant}
            onChange={e => setPacticipant(e.target.value)}
            placeholder="pacticipant (e.g. web-app)"
            className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs w-48 focus:outline-none focus:border-blue-500"
          />
          <input
            value={version}
            onChange={e => setVersion(e.target.value)}
            placeholder="version (e.g. 1.4.0)"
            className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs w-32 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={recordRun}
            disabled={saving}
            className="text-[11px] px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50 transition-colors"
          >
            {saving ? 'Recording...' : 'Record result'}
          </button>
          <span className="text-[10px] text-surface-500">
            Writes to contracts/results/ in the workspace; the dashboard picks it up on refresh.
          </span>
        </div>
      )}
      <Toast toast={toast} />

      {/* ── Results list ── */}
      <div className="flex-1 overflow-y-auto min-h-0 p-6">
        {/* Failed first, then passed */}
        {(() => {
          const failed = report.results.filter(r => !r.passed);
          const passed = report.results.filter(r => r.passed);
          return (
            <div className="flex flex-col gap-3 max-w-4xl mx-auto">
              {failed.map(r => <ResultCard key={r.requestId} result={r} />)}
              {passed.map(r => <ResultCard key={r.requestId} result={r} />)}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
