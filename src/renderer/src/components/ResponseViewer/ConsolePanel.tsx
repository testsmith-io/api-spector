// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { ScriptExecutionMeta } from '../../../../shared/types';

export function ConsolePanel({ scriptResult }: { scriptResult: ScriptExecutionMeta | null }) {
  const sr = scriptResult;
  const hasErrors = !!(sr?.preScriptError || sr?.postScriptError);
  const hasOutput = !!(sr && sr.consoleOutput.length > 0);

  if (!sr || (!hasErrors && !hasOutput)) {
    return (
      <div className="flex items-center justify-center h-full text-surface-400 text-xs">
        No console output. Use <code className="mx-1 bg-surface-800 px-1 rounded">console.log()</code> in your scripts.
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
      {hasOutput && (
        <div className="flex flex-col gap-0">
          {sr.consoleOutput.map((line, i) => (
            <div
              key={i}
              className={`text-xs font-mono py-0.5 border-b border-surface-800/50 last:border-0 ${
                line.startsWith('[error]') ? 'text-red-300' :
                line.startsWith('[warn]')  ? 'text-amber-300' :
                line.startsWith('[set]')   ? 'text-cyan-400' :
                'text-surface-400'
              }`}
            >
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
