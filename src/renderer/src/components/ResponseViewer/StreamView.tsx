// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useState, useRef, useEffect } from 'react';
import type { StreamEvent, StreamClose } from '../../../../shared/types';

const { electron } = window;

// Only render the tail of very long streams — the buffer can hold thousands of
// frames and mounting them all would jank the UI.
const RENDER_TAIL = 500;

const CLOSE_LABEL: Record<StreamClose, string> = {
  complete: 'closed',
  stopped:  'stopped',
  error:    'error',
  timeout:  'timed out',
};

const CLOSE_COLOR: Record<StreamClose, string> = {
  complete: 'text-emerald-400',
  stopped:  'text-surface-400',
  error:    'text-red-400',
  timeout:  'text-amber-400',
};

function eventName(ev: StreamEvent): string | null {
  if (ev.kind === 'sse') return ev.name ?? 'message';
  if (ev.kind === 'ndjson') return 'json';
  return null;
}

function preview(ev: StreamEvent): string {
  if (ev.json !== undefined) {
    try { return JSON.stringify(ev.json); } catch { /* fall through */ }
  }
  return ev.data;
}

interface Props {
  events: StreamEvent[]
  streaming: boolean
  /** Present only while live — enables the Stop button. */
  streamId?: string
  streamClose?: StreamClose
  firstEventMs?: number
}

export function StreamView({ events, streaming, streamId, streamClose, firstEventMs }: Props) {
  const [mode, setMode] = useState<'events' | 'merged'>('events');
  const [stopping, setStopping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Follow the tail while frames are still arriving.
  useEffect(() => {
    if (streaming && mode === 'events') bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [events.length, streaming, mode]);

  const shown = events.length > RENDER_TAIL ? events.slice(-RENDER_TAIL) : events;
  const firstMs = firstEventMs ?? events[0]?.tMs;

  async function stop() {
    if (!streamId) return;
    setStopping(true);
    try { await electron.stopStream(streamId); } catch { /* already gone */ }
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Status bar */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-surface-800 text-[11px] shrink-0">
        <span className="flex items-center gap-1.5">
          {streaming ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-400 font-medium">streaming</span>
            </>
          ) : (
            <>
              <span className={`w-2 h-2 rounded-full ${streamClose === 'error' ? 'bg-red-400' : streamClose === 'timeout' ? 'bg-amber-400' : 'bg-surface-500'}`} />
              <span className={streamClose ? CLOSE_COLOR[streamClose] : 'text-surface-400'}>
                {streamClose ? CLOSE_LABEL[streamClose] : 'closed'}
              </span>
            </>
          )}
        </span>
        <span className="text-surface-400 font-mono">{events.length} {events.length === 1 ? 'event' : 'events'}</span>
        {firstMs !== undefined && (
          <span className="text-surface-500 font-mono" title="Time to first event">first +{firstMs}ms</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded border border-surface-700 overflow-hidden">
            <button
              onClick={() => setMode('events')}
              className={`px-2 py-0.5 text-[10px] transition-colors ${mode === 'events' ? 'bg-surface-700 text-white' : 'text-surface-500 hover:text-white'}`}
            >Events</button>
            <button
              onClick={() => setMode('merged')}
              className={`px-2 py-0.5 text-[10px] transition-colors ${mode === 'merged' ? 'bg-surface-700 text-white' : 'text-surface-500 hover:text-white'}`}
            >Merged</button>
          </div>
          {streaming && streamId && (
            <button
              onClick={stop}
              disabled={stopping}
              className="px-2 py-0.5 text-[10px] rounded bg-red-900/40 text-red-300 hover:bg-red-900/60 disabled:opacity-50 transition-colors"
            >{stopping ? 'Stopping…' : 'Stop'}</button>
          )}
        </div>
      </div>

      {/* Body */}
      {events.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-surface-500 text-xs">
          {streaming ? 'Waiting for the first event…' : 'No events received.'}
        </div>
      ) : mode === 'merged' ? (
        <pre className="flex-1 overflow-auto m-0 px-3 py-2 text-[11px] font-mono text-surface-300 whitespace-pre-wrap break-words">
          {shown.map(e => e.data).join('\n')}
        </pre>
      ) : (
        <div className="flex-1 overflow-auto min-h-0">
          {events.length > RENDER_TAIL && (
            <p className="px-3 py-1 text-[10px] text-surface-500 bg-surface-900/50 sticky top-0">
              showing the last {RENDER_TAIL} of {events.length} events
            </p>
          )}
          {shown.map(ev => {
            const name = eventName(ev);
            return (
              <div key={ev.seq} className="flex items-baseline gap-2 px-3 py-1 border-b border-surface-800/60 hover:bg-surface-800/40">
                <span className="text-[10px] font-mono text-surface-600 w-10 shrink-0 text-right tabular-nums">#{ev.seq}</span>
                {name && (
                  <span className="text-[9px] font-mono px-1 py-px rounded bg-surface-700/60 text-surface-300 shrink-0">{name}</span>
                )}
                <span className="text-[9px] font-mono text-surface-600 shrink-0 tabular-nums" title="Time since request start">+{ev.tMs}ms</span>
                <span className="text-[11px] font-mono text-surface-200 truncate" title={ev.data}>{preview(ev)}</span>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
