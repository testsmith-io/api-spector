// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { ScriptExecutionMeta } from '../../../../shared/types';

export function TestsPanel({ scriptResult }: { scriptResult: ScriptExecutionMeta | null }) {
  const sr = scriptResult;

  if (!sr || (sr.testResults.length === 0 && !sr.preScriptError && !sr.postScriptError)) {
    return (
      <div className="flex items-center justify-center h-full text-surface-400 text-xs">
        No tests ran. Add <code className="mx-1 bg-surface-800 px-1 rounded">pm.test()</code> calls to your post-response script.
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-2">
      {sr.preScriptError && (
        <div className="flex items-start gap-2 p-2 rounded bg-red-900/30 border border-red-700">
          <span className="text-red-400 text-xs font-bold shrink-0">PRE-SCRIPT ERROR</span>
          <span className="text-red-300 text-xs font-mono">{sr.preScriptError}</span>
        </div>
      )}
      {sr.postScriptError && (
        <div className="flex items-start gap-2 p-2 rounded bg-red-900/30 border border-red-700">
          <span className="text-red-400 text-xs font-bold shrink-0">POST-SCRIPT ERROR</span>
          <span className="text-red-300 text-xs font-mono">{sr.postScriptError}</span>
        </div>
      )}
      {sr.testResults.map((result, i) => (
        // Pass uses the bright lime-400 border at 50% (was: dark olive-800
        // border on near-invisible 20% bg) so the green test row actually
        // reads as green in dark mode.
        <div
          key={i}
          className={`flex items-start gap-2 p-2 rounded border ${result.passed
            ? 'bg-emerald-800/30 border-emerald-400/50'
            : 'bg-red-900/30 border-red-700'
            }`}
        >
          <span className={`text-xs font-bold shrink-0 ${result.passed ? 'text-emerald-400' : 'text-red-400'}`}>
            {result.passed ? '✓' : '✗'}
          </span>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-white">{result.name}</span>
            {result.error && (
              <span className="text-[11px] text-red-300 font-mono">{result.error}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
