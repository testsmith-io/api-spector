// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { useState } from 'react';
import type { RunRequestResult } from '../../../../shared/types';

const HOOK_BADGE: Record<string, { label: string; cls: string }> = {
  beforeAll: { label: 'BEFORE ALL', cls: 'bg-violet-700 text-white' },
  before:    { label: 'BEFORE',     cls: 'bg-violet-600 text-white' },
  after:     { label: 'AFTER',      cls: 'bg-cyan-700 text-white' },
  afterAll:  { label: 'AFTER ALL',  cls: 'bg-cyan-800 text-white' },
};

export function HookResultsPanel({ results }: { results: RunRequestResult[] }) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const failed = results.filter(r => r.status === 'failed' || r.status === 'error').length;

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  return (
    <div className="border-b border-surface-800 flex-shrink-0">
      {/* Header row */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-1.5 text-xs hover:bg-surface-800/30 transition-colors"
      >
        <span className="text-surface-400">{open ? '▾' : '▸'}</span>
        <span className="font-medium text-surface-400">Hooks</span>
        <span className="text-surface-500">{results.length} ran</span>
        {failed > 0 && (
          <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-red-800/60 text-red-300">{failed} failed</span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-2 flex flex-col gap-0.5">
          {results.map((r, i) => {
            const badge = HOOK_BADGE[r.hookType ?? ''];
            const hasDetail = (r.consoleOutput?.length ?? 0) > 0 || (r.testResults?.length ?? 0) > 0 || r.error || r.preScriptError || r.postScriptError;
            const isExpanded = expanded.has(r.requestId + i);
            return (
              <div key={r.requestId + i} className="text-xs">
                <div
                  className={`flex items-center gap-2 py-0.5 ${hasDetail ? 'cursor-pointer hover:bg-surface-800/20 rounded px-1 -mx-1' : ''}`}
                  onClick={() => hasDetail && toggle(r.requestId + i)}
                >
                  {/* status dot */}
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    r.status === 'passed' ? 'bg-emerald-500' :
                    r.status === 'failed' ? 'bg-red-500' : 'bg-orange-500'
                  }`} />
                  {badge && (
                    <span className={`text-[9px] font-bold px-1 py-0.5 rounded uppercase tracking-wide shrink-0 ${badge.cls}`}>
                      {badge.label}
                    </span>
                  )}
                  <span className="text-surface-300 truncate">{r.name}</span>
                  {r.httpStatus !== undefined && (
                    <span className={`ml-auto shrink-0 font-mono ${r.httpStatus < 400 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {r.httpStatus}
                    </span>
                  )}
                  {r.durationMs !== undefined && (
                    <span className="text-surface-500 shrink-0">{r.durationMs}ms</span>
                  )}
                  {hasDetail && <span className="text-surface-500 shrink-0">{isExpanded ? '▾' : '▸'}</span>}
                </div>

                {isExpanded && (
                  <div className="ml-5 mt-0.5 mb-1 flex flex-col gap-1">
                    {r.error && (
                      <div className="text-red-400 font-mono text-[10px] whitespace-pre-wrap">{r.error}</div>
                    )}
                    {(r.preScriptError || r.postScriptError) && (
                      <div className="text-orange-400 font-mono text-[10px] whitespace-pre-wrap">
                        {r.preScriptError ?? r.postScriptError}
                      </div>
                    )}
                    {r.testResults?.map((t, ti) => (
                      <div key={ti} className={`flex items-center gap-1.5 ${t.passed ? 'text-emerald-400' : 'text-red-400'}`}>
                        <span>{t.passed ? '✓' : '✗'}</span>
                        <span>{t.name}</span>
                        {t.error && <span className="text-surface-500 text-[10px]">— {t.error}</span>}
                      </div>
                    ))}
                    {r.consoleOutput?.map((line, li) => (
                      <div key={li} className="font-mono text-[10px] text-surface-400">{line}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
