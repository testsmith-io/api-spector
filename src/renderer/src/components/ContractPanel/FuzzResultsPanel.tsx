// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useState } from 'react';
import type { FuzzReport, FuzzTargetResult, FuzzFinding, FuzzOracle, FuzzCaseTrace } from '../../../../shared/types';
import { getMethodColor } from '../../../../shared/colors';
import { Toast, useToast } from '../common/Toast';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusColor(code: number): string {
  const d = String(code)[0];
  return d === '2' ? 'text-emerald-400' : d === '3' ? 'text-amber-400' : 'text-red-400';
}

/** Per-oracle label, badge classes, and left border. Chosen to read in light and dark. */
const ORACLE_META: Record<FuzzOracle, { label: string; badge: string; border: string }> = {
  'never-5xx':           { label: 'Server crash',        badge: 'bg-red-900/50 text-red-400',       border: 'border-red-600' },
  'accepted-invalid':    { label: 'Accepted invalid',    badge: 'bg-amber-900/50 text-amber-400',   border: 'border-amber-500' },
  'undocumented-status': { label: 'Undocumented status', badge: 'bg-blue-900/50 text-blue-400',     border: 'border-blue-500' },
  'response-schema':     { label: 'Response schema',     badge: 'bg-orange-900/50 text-orange-400', border: 'border-orange-500' },
};

// ─── Finding row ──────────────────────────────────────────────────────────────

function FindingRow({ finding, onCopy }: { finding: FuzzFinding; onCopy: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const meta = ORACLE_META[finding.oracle];
  const req = finding.request;
  const sentText =
    `${req.method} ${req.url}\n` +
    Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\n') +
    (req.body ? `\n\n${req.body}` : '');

  return (
    <div className={`flex flex-col gap-1.5 px-4 py-2.5 border-l-2 ${meta.border} bg-red-950/20 rounded-r`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${meta.badge}`}>
          {meta.label}
        </span>
        <span className={`text-xs font-mono font-bold ${statusColor(finding.status)}`}>
          {finding.status === 0 ? 'ERR' : finding.status}
        </span>
        <span className="text-[10px] font-mono text-surface-500 bg-surface-800 px-1.5 py-0.5 rounded">
          {finding.mutation.target}
        </span>
        <span className="text-[10px] font-mono text-surface-400 bg-surface-800 px-1.5 py-0.5 rounded">
          {finding.mutation.kind}
        </span>
      </div>

      <p className="text-xs text-red-200">{finding.message}</p>
      <p className="text-[11px] text-surface-400">{finding.mutation.description}</p>

      <button
        onClick={() => setOpen(v => !v)}
        className="text-[10px] text-surface-500 hover:text-surface-300 transition-colors self-start"
      >
        {open ? '▲ Hide sent request' : '▼ Show sent request'}
      </button>

      {open && (
        <div className="flex flex-col gap-2 mt-0.5">
          <div className="rounded border border-surface-800 bg-surface-900 overflow-hidden">
            <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-surface-800">
              <span className={`text-[11px] font-bold font-mono ${getMethodColor(req.method)}`}>
                {req.method}
              </span>
              <span className="text-[11px] font-mono text-surface-400 truncate flex-1">{req.url}</span>
              <button
                onClick={() => onCopy(sentText)}
                className="text-[10px] text-surface-500 hover:text-surface-200 transition-colors shrink-0"
                title="Copy the sent request"
              >
                Copy
              </button>
            </div>
            {req.body && (
              <pre className="text-[11px] font-mono text-surface-300 px-2.5 py-2 overflow-x-auto whitespace-pre-wrap break-words">
                {req.body}
              </pre>
            )}
          </div>

          {finding.responseSample && (
            <div className="rounded border border-surface-800 bg-surface-900 overflow-hidden">
              <div className="px-2.5 py-1.5 border-b border-surface-800 text-[10px] uppercase tracking-wider text-surface-500 font-medium">
                Response sample
              </div>
              <pre className="text-[11px] font-mono text-surface-300 px-2.5 py-2 overflow-x-auto whitespace-pre-wrap break-words">
                {finding.responseSample}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Operation card ───────────────────────────────────────────────────────────

function OperationCard({ result, onCopy }: { result: FuzzTargetResult; onCopy: (text: string) => void }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-lg border border-red-800/60 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left bg-red-950/30 hover:bg-red-950/50 transition-colors"
      >
        <span className={`shrink-0 text-xs font-bold font-mono w-14 ${getMethodColor(result.method)}`}>
          {result.method}
        </span>
        <span className="flex-1 text-sm text-white truncate">{result.requestName}</span>
        <span className="hidden lg:block text-[11px] text-surface-500 font-mono truncate max-w-[260px]">
          {result.url}
        </span>
        <span className="shrink-0 text-[10px] bg-red-900/50 text-red-300 rounded px-1.5 py-0.5 font-medium">
          {result.findings.length} {result.findings.length === 1 ? 'finding' : 'findings'}
        </span>
        <span className="shrink-0 text-[11px] text-surface-500">{result.cases} cases</span>
        <span className="shrink-0 text-surface-600 text-xs ml-1">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 py-3 bg-surface-900 border-t border-surface-800 flex flex-col gap-2">
          {result.findings.map((f, i) => <FindingRow key={i} finding={f} onCopy={onCopy} />)}
        </div>
      )}
    </div>
  );
}

// ─── Trace: every case sent (trace mode) ──────────────────────────────────────

function statusTone(status: number, finding: boolean): string {
  if (finding) return 'text-red-400';
  if (status === 0) return 'text-surface-500';
  if (status >= 200 && status < 300) return 'text-emerald-400';
  if (status >= 400) return 'text-amber-400';
  return 'text-surface-300';
}

/** One case in the trace: a compact clickable summary that expands to the full
 *  request body and response. */
function TraceRow({ trace, onCopy }: { trace: FuzzCaseTrace; onCopy: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-surface-800 first:border-t-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-3 py-1.5 text-left hover:bg-surface-800/60 transition-colors font-mono text-[11px]"
      >
        <span className="shrink-0 text-surface-600 w-3">{open ? '▾' : '▸'}</span>
        <span className={`shrink-0 font-bold w-9 ${statusTone(trace.status, trace.finding)}`}>
          {trace.status || 'ERR'}
        </span>
        <span className="shrink-0 text-surface-300">{trace.mutation.target}</span>
        <span className="text-surface-500 truncate">{trace.mutation.kind}</span>
        {trace.finding && <span className="ml-auto shrink-0 text-[10px] bg-red-900/50 text-red-300 rounded px-1.5 py-0.5">finding</span>}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 flex flex-col gap-2 bg-surface-950/40">
          <p className="text-[11px] text-surface-400">{trace.mutation.description}</p>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-surface-600 font-medium">Request</span>
              <button
                onClick={() => onCopy(`${trace.request.method} ${trace.request.url}\n\n${trace.request.body ?? ''}`)}
                className="text-[10px] text-surface-500 hover:text-surface-200 transition-colors"
              >
                copy
              </button>
            </div>
            <p className="text-[10px] font-mono text-surface-500 break-all">{trace.request.method} {trace.request.url}</p>
            {trace.request.body && (
              <pre className="text-[11px] font-mono text-surface-300 bg-surface-900 border border-surface-800 rounded px-2.5 py-2 overflow-x-auto whitespace-pre-wrap break-words">{trace.request.body}</pre>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-surface-600 font-medium">Response ({trace.status || 'no response'})</span>
            <pre className="text-[11px] font-mono text-surface-300 bg-surface-900 border border-surface-800 rounded px-2.5 py-2 overflow-x-auto whitespace-pre-wrap break-words">{trace.responseSample || '(empty)'}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function TraceCard({ result, onCopy }: { result: FuzzTargetResult; onCopy: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!result.trace?.length) return null;
  const findingCount = result.trace.filter(t => t.finding).length;
  return (
    <div className="rounded-lg border border-surface-700 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left bg-surface-800 hover:bg-surface-700/60 transition-colors"
      >
        <span className={`shrink-0 text-xs font-bold font-mono w-14 ${getMethodColor(result.method)}`}>{result.method}</span>
        <span className="flex-1 text-xs text-surface-200 truncate">{result.requestName}</span>
        {findingCount > 0 && <span className="shrink-0 text-[10px] bg-red-900/50 text-red-300 rounded px-1.5 py-0.5">{findingCount}</span>}
        <span className="shrink-0 text-[11px] text-surface-500">{result.trace.length} cases sent</span>
        <span className="shrink-0 text-surface-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="bg-surface-900 border-t border-surface-800">
          {result.trace.map((t, i) => <TraceRow key={i} trace={t} onCopy={onCopy} />)}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function FuzzResultsPanel({ report, onClear }: { report: FuzzReport; onClear: () => void }) {
  const { toast, show: showToast } = useToast();

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Sent request copied to clipboard.', true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Copy failed.', false);
    }
  }

  const withFindings = report.results.filter(r => r.findings.length > 0);
  const clean        = report.results.filter(r => r.findings.length === 0);
  const clean5xx     = report.totalFindings === 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Summary bar ── */}
      <div className={`flex items-center gap-4 px-6 py-3 border-b flex-shrink-0 ${
        clean5xx ? 'bg-emerald-950/30 border-emerald-800/50' : 'bg-red-950/30 border-red-800/50'
      }`}>
        <span className={`text-base font-bold ${clean5xx ? 'text-emerald-400' : 'text-red-400'}`}>
          {clean5xx
            ? '✓ No findings'
            : `✗ ${report.totalFindings} finding${report.totalFindings !== 1 ? 's' : ''}`}
        </span>
        <span className="text-sm text-surface-400">
          {report.totalCases} case{report.totalCases !== 1 ? 's' : ''} across {report.results.length} operation{report.results.length !== 1 ? 's' : ''}
        </span>
        <span className="text-[11px] bg-surface-800 text-surface-400 px-2 py-0.5 rounded font-mono">
          {report.inputSource === 'spec' ? 'spec' : 'request body'}
        </span>
        <span className="text-[11px] bg-surface-800 text-surface-400 px-2 py-0.5 rounded font-mono">
          seed {report.seed}
        </span>
        <span className="text-xs text-surface-500 ml-auto">{report.durationMs}ms</span>
        <button
          onClick={onClear}
          className="text-[11px] text-surface-600 hover:text-surface-300 transition-colors"
          title="Clear results"
        >
          Clear
        </button>
      </div>

      {/* ── Skipped notes ── */}
      {(report.skippedWrites > 0 || report.skippedNoBody > 0) && (
        <div className="flex flex-col gap-1 px-6 py-2 border-b border-surface-800 bg-surface-900/60 flex-shrink-0">
          {report.skippedWrites > 0 && (
            <p className="text-[11px] text-amber-400">
              {report.skippedWrites} write-method request{report.skippedWrites !== 1 ? 's' : ''} skipped (enable Include write methods).
            </p>
          )}
          {report.skippedNoBody > 0 && (
            <p className="text-[11px] text-surface-500">
              {report.skippedNoBody} request{report.skippedNoBody !== 1 ? 's' : ''} had no body to fuzz.
            </p>
          )}
        </div>
      )}
      <Toast toast={toast} />

      {/* ── Results list ── */}
      <div className="flex-1 overflow-y-auto min-h-0 p-6">
        <div className="flex flex-col gap-3 max-w-4xl mx-auto">
          {withFindings.map(r => <OperationCard key={r.requestId} result={r} onCopy={copy} />)}

          {clean.length > 0 && (
            <div className="rounded-lg border border-surface-700 bg-surface-800 px-4 py-3">
              <p className="text-xs text-emerald-400 font-medium mb-1.5">
                {clean.length} operation{clean.length !== 1 ? 's' : ''} clean
              </p>
              <div className="flex flex-col gap-0.5">
                {clean.map(r => (
                  <div key={r.requestId} className="flex items-center gap-2 text-[11px]">
                    <span className={`font-bold font-mono w-12 shrink-0 ${getMethodColor(r.method)}`}>
                      {r.method}
                    </span>
                    <span className="text-surface-300 truncate">{r.requestName}</span>
                    <span className="text-surface-600 ml-auto shrink-0">{r.cases} cases</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.results.some(r => r.trace?.length) && (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] uppercase tracking-wider text-surface-600 font-medium mt-2">All cases sent</p>
              {report.results.filter(r => r.trace?.length).map(r => <TraceCard key={r.requestId} result={r} onCopy={copy} />)}
            </div>
          )}

          {report.results.length === 0 && (
            <p className="text-xs text-surface-500 text-center mt-4">
              No operations were fuzzed. Check that requests have a body or a matching spec operation.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
