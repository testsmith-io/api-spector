// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Shared "collect a window, then assert" test UI for the realtime panels
// (WebSocket, Socket.IO, GraphQL subscription). Mirrors the MQTT panel's Test
// section: a collect-seconds field, an optional protocol-specific control
// (passed as children), an sp.* assertion script, a Run button with a live
// countdown, and the pass/fail results. The connection + script run in the main
// process; this component only drives the config and renders the outcome.

import React, { useState } from 'react';
import { useT } from '../../i18n';

/** Result shape returned by electron.wsTest / socketIoTest / graphqlWsTest. */
export interface RealtimeTestResult {
  testResults: { name: string; passed: boolean; error?: string }[]
  consoleOutput: string[]
  error?: string
  messages: ({ payload: string; timestamp: number } & Record<string, unknown>)[]
}

/** Drives a realtime test: a live countdown while it collects, then the result.
 *  `runner` receives the collect window (ms) and resolves with the outcome. */
export function useRealtimeTest(runner: (collectMs: number) => Promise<RealtimeTestResult>) {
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [result, setResult] = useState<RealtimeTestResult | null>(null);

  async function run(collectMs: number) {
    setRunning(true);
    setResult(null);
    setRemaining(Math.ceil(collectMs / 1000));
    const countdown = setInterval(() => setRemaining(r => (r && r > 1 ? r - 1 : 0)), 1000);
    try {
      setResult(await runner(collectMs));
    } catch (err) {
      setResult({ testResults: [], consoleOutput: [], error: err instanceof Error ? err.message : String(err), messages: [] });
    } finally {
      clearInterval(countdown);
      setRemaining(null);
      setRunning(false);
    }
  }

  return { running, remaining, result, run };
}

const inputCls = 'bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-500 placeholder-surface-700 disabled:opacity-50';

export function RealtimeTestSection({
  buttonClass, dotClass, hint, children, scriptPlaceholder,
  testScript, collectMs, onChangeScript, onChangeCollectMs,
  running, remaining, result, onRun, runDisabled, defaultOpen,
}: {
  /** Full literal Tailwind classes for the Run button bg/hover (so they are not
   *  purged): e.g. "bg-cyan-700 hover:bg-cyan-600". */
  readonly buttonClass: string
  /** Full literal class for the "has script" dot, e.g. "text-cyan-500/70". */
  readonly dotClass: string
  readonly hint?: React.ReactNode
  /** Protocol-specific controls shown above the script (e.g. send/emit field). */
  readonly children?: React.ReactNode
  readonly scriptPlaceholder?: string
  readonly testScript: string
  readonly collectMs: number
  readonly onChangeScript: (s: string) => void
  readonly onChangeCollectMs: (ms: number) => void
  readonly running: boolean
  readonly remaining: number | null
  readonly result: RealtimeTestResult | null
  readonly onRun: () => void
  readonly runDisabled?: boolean
  /** Expand the Test section on first render (defaults to: open if a script
   *  already exists). */
  readonly defaultOpen?: boolean
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen ?? Boolean(testScript.trim()));

  return (
    <div className="border-t border-surface-800 pt-2 flex flex-col gap-2">
      <button
        onClick={() => setOpen(v => !v)}
        className="text-[10px] uppercase tracking-wider text-surface-500 hover:text-surface-300 transition-colors self-start"
      >
        <span className="text-[14px] leading-none">{open ? '▾' : '▸'}</span> {t('Test')}
        {testScript.trim() && <span className={`ml-1.5 normal-case ${dotClass}`}>●</span>}
      </button>

      {open && (
        <div className="flex flex-col gap-2">
          {hint && <p className="text-[10px] text-surface-600">{hint}</p>}

          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase tracking-wider text-surface-500 shrink-0">{t('Collect (seconds)')}</label>
            <input
              type="number"
              min={1}
              max={60}
              step={1}
              value={Math.round(collectMs / 1000)}
              onChange={e => onChangeCollectMs(Math.max(1, Math.min(60, Math.floor(Number(e.target.value) || 1))) * 1000)}
              className={`w-20 ${inputCls}`}
            />
          </div>

          {children}

          <textarea
            value={testScript}
            onChange={e => onChangeScript(e.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={scriptPlaceholder}
            className="w-full resize-y bg-surface-800 border border-surface-700 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-500 placeholder-surface-700"
          />

          <div className="flex items-center gap-2">
            <button
              onClick={onRun}
              disabled={running || runDisabled || !testScript.trim()}
              className={`px-3 py-1.5 ${buttonClass} disabled:bg-surface-800 disabled:text-surface-600 rounded text-xs font-medium transition-colors`}
            >
              {running ? (remaining && remaining > 0 ? t('Collecting… :n s', { n: remaining }) : t('Running…')) : t('Run test')}
            </button>
            {result && !running && (() => {
              const passed = result.testResults.filter(r => r.passed).length;
              const total = result.testResults.length;
              const ok = !result.error && total > 0 && passed === total;
              return (
                <span className={`text-xs font-medium ${result.error ? 'text-red-400' : ok ? 'text-emerald-400' : total === 0 ? 'text-surface-500' : 'text-red-400'}`}>
                  {result.error ? t('error') : total === 0 ? t('no assertions') : `${passed}/${total} ${t('passed')}`}
                  <span className="text-surface-600 font-normal"> · {t(':count message|:count messages', { count: result.messages.length })} {t('collected')}</span>
                </span>
              );
            })()}
          </div>

          {result && !running && (
            <div className="flex flex-col gap-1">
              {result.error && (
                <div className="px-2 py-1 bg-red-900/40 border border-red-700/50 rounded text-[11px] text-red-400 font-mono break-all">{result.error}</div>
              )}
              {result.testResults.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px]">
                  <span className={r.passed ? 'text-emerald-400' : 'text-red-400'}>{r.passed ? '✓' : '✗'}</span>
                  <span className="text-surface-300">{r.name}</span>
                  {!r.passed && r.error && <span className="text-red-400/80 font-mono break-all">{r.error}</span>}
                </div>
              ))}
              {result.consoleOutput.length > 0 && (
                <pre className="mt-1 text-[10px] text-surface-500 font-mono whitespace-pre-wrap break-all">{result.consoleOutput.join('\n')}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
