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

import React, { useState, useEffect, useRef } from 'react';
import type { RecordedEntry, RecordingSession } from '../../../../shared/types';
import { useStore } from '../../store';

const { electron } = window;

interface Props {
  onImportMock:        (session: RecordingSession, targetMockId: string | null) => Promise<void>;
  onClose:             () => void;
  defaultTargetMockId: string;   // '' = new server
}

function statusColor(status: number): string {
  if (status === 0)    return 'text-yellow-400';
  if (status < 300)    return 'text-emerald-400';
  if (status < 400)    return 'text-blue-400';
  return 'text-red-400';
}

function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':    return 'text-emerald-400';
    case 'POST':   return 'text-blue-400';
    case 'PUT':
    case 'PATCH':  return 'text-yellow-400';
    case 'DELETE': return 'text-red-400';
    default:       return 'text-surface-300';
  }
}

export function RecorderPanel({ onImportMock, onClose, defaultTargetMockId }: Props) {
  const [entries,      setEntries]      = useState<RecordedEntry[]>([]);
  const [selected,     setSelected]     = useState<RecordedEntry | null>(null);
  const [stopped,      setStopped]      = useState(false);
  const [session,      setSession]      = useState<RecordingSession | null>(null);
  const [importing,    setImporting]    = useState(false);
  const [importTarget, setImportTarget] = useState<string>(defaultTargetMockId || 'new');
  const listRef = useRef<HTMLDivElement>(null);

  const upstream  = useStore(s => s.recorderUpstream);
  const mockList  = Object.values(useStore(s => s.mocks));

  useEffect(() => {
    electron.onRecordHit(entry => {
      setEntries(prev => {
        const next = [...prev, entry];
        // Auto-scroll list
        setTimeout(() => {
          if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
        }, 0);
        return next;
      });
    });
    return () => { electron.offRecordHit(); };
  }, []);

  async function handleStop() {
    try {
      const s = await electron.recordStop();
      setSession(s);
      setStopped(true);
    } catch { /* already stopped */ }
  }

  async function handleImport() {
    if (!session) return;
    setImporting(true);
    try {
      await onImportMock(session, importTarget === 'new' ? null : importTarget);
    } finally {
      setImporting(false);
    }
  }

  const total   = entries.length;
  const errors  = entries.filter(e => e.response.status === 0 || e.response.status >= 400).length;
  const avgMs   = total > 0
    ? Math.round(entries.reduce((s, e) => s + e.durationMs, 0) / total)
    : 0;

  return (
    <div className="flex flex-col h-full bg-surface-950 text-surface-200 min-h-0">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          {!stopped && (
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          )}
          <span className="text-sm font-semibold text-surface-100">
            {stopped ? 'Recording stopped' : 'Recording…'}
          </span>
          <span className="text-[10px] font-mono text-surface-400 truncate max-w-[260px]">
            → {upstream}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!stopped ? (
            <button
              onClick={handleStop}
              className="px-2.5 py-1 rounded text-[11px] bg-red-900/40 text-red-400 hover:bg-red-800/50 transition-colors"
            >
              ■ Stop
            </button>
          ) : (
            <>
              {session && session.entries.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <select
                    value={importTarget}
                    onChange={e => setImportTarget(e.target.value)}
                    className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-[11px] text-surface-200 focus:outline-none focus:border-blue-500"
                  >
                    <option value="new">— New mock server —</option>
                    {mockList.map(entry => (
                      <option key={entry.data.id} value={entry.data.id}>
                        {entry.data.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleImport}
                    disabled={importing}
                    className="px-2.5 py-1 rounded text-[11px] bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {importing ? 'Importing…' : '⧉ Import'}
                  </button>
                </div>
              )}
              <button
                onClick={onClose}
                className="px-2.5 py-1 rounded text-[11px] text-surface-500 hover:text-surface-300 transition-colors"
              >
                ✕ Close
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div className="flex gap-4 px-4 py-1.5 border-b border-surface-800/50 flex-shrink-0 text-[11px]">
        <span className="text-surface-400">Requests: <span className="text-surface-200 font-medium">{total}</span></span>
        <span className="text-surface-400">Errors: <span className={errors > 0 ? 'text-red-400 font-medium' : 'text-surface-200 font-medium'}>{errors}</span></span>
        {total > 0 && <span className="text-surface-400">Avg: <span className="text-surface-200 font-medium">{avgMs}ms</span></span>}
      </div>

      {/* ── Content: entry list + detail ── */}
      <div className="flex flex-1 min-h-0">

        {/* Entry list */}
        <div
          ref={listRef}
          className="w-72 flex-shrink-0 overflow-y-auto border-r border-surface-800"
        >
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-surface-500 text-xs gap-2 p-4 text-center">
              <span className="text-2xl opacity-30">⏺</span>
              <p>Waiting for requests…</p>
              <p className="text-[10px]">Point your app at http://localhost:{useStore.getState().recorderPort}</p>
            </div>
          ) : (
            entries.map(entry => {
              const active = selected?.id === entry.id;
              const sc = statusColor(entry.response.status);
              const mc = methodColor(entry.request.method);
              return (
                <button
                  key={entry.id}
                  onClick={() => setSelected(entry)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left border-b border-surface-800/40 transition-colors text-[11px] ${
                    active ? 'bg-surface-800' : 'hover:bg-surface-800/50'
                  }`}
                >
                  <span className={`font-mono font-bold w-12 shrink-0 ${mc}`}>
                    {entry.request.method}
                  </span>
                  <span className="flex-1 truncate text-surface-200 font-mono">
                    {entry.request.path}
                  </span>
                  <span className={`font-mono font-semibold shrink-0 ${sc}`}>
                    {entry.response.status || 'ERR'}
                  </span>
                  <span className="text-surface-500 shrink-0 w-10 text-right">
                    {entry.durationMs}ms
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Detail pane */}
        <div className="flex-1 overflow-y-auto p-4 min-w-0">
          {!selected ? (
            <div className="flex items-center justify-center h-full text-surface-500 text-xs">
              Select a request to inspect
            </div>
          ) : (
            <EntryDetail entry={selected} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Entry detail ─────────────────────────────────────────────────────────────

function EntryDetail({ entry }: { entry: RecordedEntry }) {
  const [tab, setTab] = useState<'request' | 'response'>('request');
  const mc = methodColor(entry.request.method);
  const sc = statusColor(entry.response.status);

  const prettyBody = (raw: string | null): string => {
    if (!raw) return '';
    if (raw.startsWith('base64:')) return '[binary content — base64 encoded]';
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
  };

  return (
    <div className="flex flex-col gap-3 text-[12px]">
      {/* URL line */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`font-mono font-bold ${mc}`}>{entry.request.method}</span>
        <span className="font-mono text-surface-100 break-all">{entry.request.path}</span>
        {Object.keys(entry.request.query).length > 0 && (
          <span className="font-mono text-surface-400 break-all">
            ?{new URLSearchParams(entry.request.query).toString()}
          </span>
        )}
        <span className={`font-mono font-semibold ml-auto ${sc}`}>
          {entry.response.status || 'ERR'} {entry.response.statusText}
        </span>
        <span className="text-surface-500">{entry.durationMs}ms</span>
      </div>
      <div className="text-[10px] text-surface-500">{entry.timestamp}</div>

      {/* Tabs */}
      <div className="flex border-b border-surface-800">
        {(['request', 'response'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-[11px] capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-blue-500 text-blue-300'
                : 'border-transparent text-surface-400 hover:text-surface-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'request' && (
        <div className="flex flex-col gap-3">
          <Section label="Headers">
            <HeadersTable headers={entry.request.headers} />
          </Section>
          {entry.request.body && (
            <Section label="Body">
              <pre className="font-mono text-[11px] whitespace-pre-wrap break-all text-surface-200 bg-surface-900 border border-surface-700 rounded p-3 max-h-72 overflow-y-auto">
                {prettyBody(entry.request.body)}
              </pre>
            </Section>
          )}
        </div>
      )}

      {tab === 'response' && (
        <div className="flex flex-col gap-3">
          <Section label="Headers">
            <HeadersTable headers={entry.response.headers} />
          </Section>
          {entry.response.body && (
            <Section label="Body">
              <pre className="font-mono text-[11px] whitespace-pre-wrap break-all text-surface-200 bg-surface-900 border border-surface-700 rounded p-3 max-h-72 overflow-y-auto">
                {prettyBody(entry.response.body)}
              </pre>
            </Section>
          )}
          {entry.response.binary && (
            <p className="text-[10px] text-yellow-400">
              Binary response — body stored as base64
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">{label}</div>
      {children}
    </div>
  );
}

function HeadersTable({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  if (entries.length === 0) return <span className="text-surface-500 text-[11px]">none</span>;
  return (
    <div className="font-mono text-[11px] flex flex-col gap-0.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2 min-w-0">
          <span className="text-blue-300 shrink-0">{k}:</span>
          <span className="text-surface-300 break-all">{v}</span>
        </div>
      ))}
    </div>
  );
}
