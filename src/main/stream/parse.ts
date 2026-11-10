// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Streaming response support (Phase 0): streamed when the Content-Type is a known event/line format
// or the request opts in. The framer is pure; feed it text chunks and it emits frames, buffering partials.

import type { StreamEvent, StreamClose } from '../../shared/types';

export type StreamKind = 'sse' | 'ndjson' | 'chunk'

/** A frame before the reader stamps it with seq/tMs/kind. */
export interface RawFrame {
  name?: string
  id?: string
  data: string
}

/** Pick a stream kind from the Content-Type. `forceStream` reads unknown types as
 *  raw chunks; null means buffer as a normal response. */
export function detectStreamKind(contentType: string | undefined, forceStream = false): StreamKind | null {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('text/event-stream')) return 'sse';
  if (
    ct.includes('application/x-ndjson') || ct.includes('application/ndjson') ||
    ct.includes('application/jsonl')    || ct.includes('application/x-jsonlines') ||
    ct.includes('application/stream+json') || ct.includes('application/json-seq')
  ) return 'ndjson';
  return forceStream ? 'chunk' : null;
}

/** Incremental framer for SSE and NDJSON (json-seq is NDJSON with a leading
 *  record-separator, stripped). Carries a buffer across chunks. */
export class StreamFramer {
  private carry = '';
  constructor(private readonly mode: 'sse' | 'ndjson') {}

  /** Feed a decoded text chunk; returns the frames that completed. */
  push(text: string): RawFrame[] {
    // Normalize CR / CRLF to LF so delimiter scanning is uniform.
    this.carry += text.replaceAll(/\r\n?/g, '\n');
    return this.mode === 'sse' ? this.drainSse() : this.drainNdjson();
  }

  /** Emit a last line/block that had no trailing delimiter when the stream closed. */
  flush(): RawFrame[] {
    const rest = this.carry;
    this.carry = '';
    if (this.mode === 'ndjson') { const f = this.ndjsonLine(rest); return f ? [f] : []; }
    const f = this.parseSseBlock(rest); return f ? [f] : [];
  }

  private drainSse(): RawFrame[] {
    const out: RawFrame[] = [];
    let idx: number;
    while ((idx = this.carry.indexOf('\n\n')) !== -1) {
      const block = this.carry.slice(0, idx);
      this.carry = this.carry.slice(idx + 2);
      const f = this.parseSseBlock(block);
      if (f) out.push(f);
    }
    return out;
  }

  private parseSseBlock(block: string): RawFrame | null {
    let name: string | undefined;
    let id: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line === '' || line.startsWith(':')) continue; // blank or comment (keep-alive)
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value   = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1); // one optional leading space
      if (field === 'data')      dataLines.push(value);
      else if (field === 'event') name = value;
      else if (field === 'id')    id = value;
      // "retry:" and unknown fields are ignored.
    }
    // Per the SSE spec, a block with no data is not dispatched.
    if (dataLines.length === 0) return null;
    return { name: name ?? 'message', id, data: dataLines.join('\n') };
  }

  private drainNdjson(): RawFrame[] {
    const out: RawFrame[] = [];
    let idx: number;
    while ((idx = this.carry.indexOf('\n')) !== -1) {
      const line = this.carry.slice(0, idx);
      this.carry = this.carry.slice(idx + 1);
      const f = this.ndjsonLine(line);
      if (f) out.push(f);
    }
    return out;
  }

  private ndjsonLine(line: string): RawFrame | null {
    // Strip a leading RS (0x1e) so json-seq records parse like NDJSON lines.
    const body = line.charCodeAt(0) === 0x1e ? line.slice(1) : line;
    const s = body.trim();
    return s ? { data: s } : null;
  }
}

function toEvent(frame: RawFrame, kind: StreamKind, seq: number, tMs: number): StreamEvent {
  let json: unknown;
  const trimmed = frame.data.trim();
  if (trimmed && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
    try { json = JSON.parse(trimmed); } catch { /* non-JSON like "[DONE]": leave undefined */ }
  }
  const ev: StreamEvent = { seq, tMs, kind, data: frame.data };
  if (frame.name !== undefined) ev.name = frame.name;
  if (frame.id !== undefined)   ev.id = frame.id;
  if (json !== undefined)       ev.json = json;
  return ev;
}

export interface ReadStreamOptions {
  /** Stop after this many events (default 5000). */
  maxEvents?: number
  /** Total wall-clock cap in ms (default 300000; <=0 disables). */
  maxMs?: number
  /** Idle cap in ms: close if no frame arrives for this long (default 60000; <=0
   *  disables). Catches a stream that connects then hangs. */
  idleMs?: number
  signal?: AbortSignal
  /** Called for each event as it is parsed, for the live UI. */
  onEvent?: (ev: StreamEvent) => void
  /** Injectable clock for tests. */
  now?: () => number
}

export interface ReadStreamResult {
  events: StreamEvent[]
  /** Full concatenated body text - the back-compat responseBody. */
  text: string
  close: StreamClose
  firstEventMs: number
}

/** Drive the framer over undici's `response.body`, emitting events live and
 *  returning the aggregate. Never rejects: on a stream error it closes with `'error'`. */
export async function readStream(
  body: ReadableStream<Uint8Array> | null,
  kind: StreamKind,
  startMs: number,
  opts: ReadStreamOptions = {},
): Promise<ReadStreamResult> {
  const now = opts.now ?? Date.now;
  const maxEvents = opts.maxEvents ?? 5000;
  const maxMs     = opts.maxMs ?? 300_000;
  const idleMs    = opts.idleMs ?? 60_000;
  let lastActivity = now();
  const framer = kind === 'chunk' ? null : new StreamFramer(kind === 'sse' ? 'sse' : 'ndjson');
  const decoder = new TextDecoder('utf-8', { fatal: false });

  const events: StreamEvent[] = [];
  let text = '';
  let firstEventMs = -1;
  let close: StreamClose = 'complete';

  if (!body) return { events, text, close, firstEventMs: 0 };

  const emit = (frames: RawFrame[]): boolean => {
    for (const frame of frames) {
      const tMs = now() - startMs;
      const ev = toEvent(frame, kind, events.length, tMs);
      if (firstEventMs < 0) firstEventMs = tMs;
      events.push(ev);
      opts.onEvent?.(ev);
      if (events.length >= maxEvents) return false; // hit the cap
    }
    return true;
  };

  const reader = body.getReader();
  try {
    for (;;) {
      if (opts.signal?.aborted) { close = 'stopped'; break; }
      // Whichever budget runs out first cuts the read; <=0 disables that budget.
      const totalRem = maxMs  > 0 ? maxMs  - (now() - startMs)      : Infinity;
      const idleRem  = idleMs > 0 ? idleMs - (now() - lastActivity) : Infinity;
      if (totalRem <= 0 || idleRem <= 0) { close = 'timeout'; break; }
      const wait = Math.min(totalRem, idleRem);

      // Race the read against the tighter budget so a silent stream is cut off;
      // with both budgets disabled, just await the next frame.
      let step: ReadableStreamReadResult<Uint8Array> | 'timeout';
      if (wait === Infinity) {
        step = await reader.read();
      } else {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<'timeout'>(res => { timer = setTimeout(() => res('timeout'), wait); });
        step = await Promise.race([reader.read(), timeout]);
        if (timer) clearTimeout(timer);
      }

      if (step === 'timeout') { close = 'timeout'; break; }
      const { value, done } = step;
      if (done) break;
      if (!value) continue;
      lastActivity = now(); // a frame arrived - reset the idle clock

      const chunkText = decoder.decode(value, { stream: true });
      text += chunkText;

      const keepGoing = framer
        ? emit(framer.push(chunkText))
        : emit([{ data: chunkText }]);
      if (!keepGoing) { close = 'stopped'; break; }
    }
    // Flush trailing decoder + framer state on a clean close.
    if (close === 'complete') {
      const tail = decoder.decode();
      if (tail) { text += tail; if (framer) emit(framer.push(tail)); else emit([{ data: tail }]); }
      if (framer) emit(framer.flush());
    }
  } catch {
    close = 'error';
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }

  return { events, text, close, firstEventMs: Math.max(firstEventMs, 0) };
}
