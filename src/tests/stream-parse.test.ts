// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { detectStreamKind, StreamFramer, readStream } from '../main/stream/parse';

// A ReadableStream that emits the given text chunks then closes — lets us drive
// readStream with the exact chunk boundaries a real socket might hand us.
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (i < chunks.length) ctrl.enqueue(enc.encode(chunks[i++]));
      else ctrl.close();
    },
  });
}

describe('detectStreamKind', () => {
  it('recognizes SSE', () => {
    expect(detectStreamKind('text/event-stream')).toBe('sse');
    expect(detectStreamKind('text/event-stream; charset=utf-8')).toBe('sse');
  });
  it('recognizes NDJSON family', () => {
    for (const ct of ['application/x-ndjson', 'application/jsonl', 'application/stream+json', 'application/json-seq']) {
      expect(detectStreamKind(ct)).toBe('ndjson');
    }
  });
  it('buffers unknown types unless forced', () => {
    expect(detectStreamKind('application/json')).toBeNull();
    expect(detectStreamKind(undefined)).toBeNull();
    expect(detectStreamKind('application/octet-stream', true)).toBe('chunk');
  });
});

describe('StreamFramer (SSE)', () => {
  it('parses discrete events', () => {
    const f = new StreamFramer('sse');
    expect(f.push('event: ping\ndata: 1\n\n')).toEqual([{ name: 'ping', id: undefined, data: '1' }]);
  });

  it('buffers a frame split across chunks', () => {
    const f = new StreamFramer('sse');
    expect(f.push('data: hel')).toEqual([]);
    expect(f.push('lo\n\n')).toEqual([{ name: 'message', id: undefined, data: 'hello' }]);
  });

  it('joins multi-line data and ignores comments', () => {
    const f = new StreamFramer('sse');
    const frames = f.push(': keep-alive\n\ndata: a\ndata: b\n\n');
    expect(frames).toEqual([{ name: 'message', id: undefined, data: 'a\nb' }]);
  });

  it('does not dispatch a data-less block', () => {
    const f = new StreamFramer('sse');
    expect(f.push(': just a heartbeat\n\n')).toEqual([]);
  });

  it('normalizes CRLF line endings', () => {
    const f = new StreamFramer('sse');
    expect(f.push('data: x\r\n\r\n')).toEqual([{ name: 'message', id: undefined, data: 'x' }]);
  });
});

describe('StreamFramer (NDJSON)', () => {
  it('splits on newlines and carries a partial line', () => {
    const f = new StreamFramer('ndjson');
    expect(f.push('{"a":1}\n{"b":')).toEqual([{ data: '{"a":1}' }]);
    expect(f.push('2}\n')).toEqual([{ data: '{"b":2}' }]);
  });

  it('strips the json-seq record separator', () => {
    const f = new StreamFramer('ndjson');
    expect(f.push('\x1e{"a":1}\n\x1e{"b":2}\n')).toEqual([{ data: '{"a":1}' }, { data: '{"b":2}' }]);
  });

  it('flush emits a trailing line with no newline', () => {
    const f = new StreamFramer('ndjson');
    expect(f.push('{"a":1}')).toEqual([]);
    expect(f.flush()).toEqual([{ data: '{"a":1}' }]);
  });
});

describe('readStream', () => {
  const now = () => 1000; // constant clock → deterministic tMs of 0

  it('reads an SSE stream split mid-frame', async () => {
    const seen: number[] = [];
    const r = await readStream(
      streamOf(['data: hel', 'lo\n\nda', 'ta: wo', 'rld\n\n']),
      'sse', 1000, { now, onEvent: e => seen.push(e.seq) },
    );
    expect(r.close).toBe('complete');
    expect(r.events.map(e => e.data)).toEqual(['hello', 'world']);
    expect(r.events[0]).toMatchObject({ seq: 0, kind: 'sse', name: 'message', tMs: 0 });
    expect(r.text).toBe('data: hello\n\ndata: world\n\n');
    expect(seen).toEqual([0, 1]); // onEvent fired live, in order
    expect(r.firstEventMs).toBe(0);
  });

  it('parses JSON payloads on NDJSON frames', async () => {
    const r = await readStream(
      streamOf(['{"n":1}\n', '{"n":2}\n']),
      'ndjson', 1000, { now },
    );
    expect(r.events.map(e => e.json)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(r.events[0].kind).toBe('ndjson');
  });

  it('leaves non-JSON data (e.g. the [DONE] sentinel) unparsed', async () => {
    const r = await readStream(streamOf(['data: [DONE]\n\n']), 'sse', 1000, { now });
    expect(r.events[0].data).toBe('[DONE]');
    expect(r.events[0].json).toBeUndefined();
  });

  it('stops at the maxEvents cap', async () => {
    const r = await readStream(streamOf(['a\nb\nc\nd\n']), 'ndjson', 1000, { now, maxEvents: 2 });
    expect(r.events).toHaveLength(2);
    expect(r.close).toBe('stopped');
  });

  it('closes with timeout when a stream goes idle', async () => {
    // Emits one frame then hangs forever; the idle cap should cut it.
    const enc = new TextEncoder();
    let sent = false;
    const hanging = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (sent) return new Promise<void>(() => { /* never resolves */ });
        sent = true;
        ctrl.enqueue(enc.encode('{"a":1}\n'));
      },
    });
    const r = await readStream(hanging, 'ndjson', Date.now(), { idleMs: 80, maxMs: 5000 });
    expect(r.close).toBe('timeout');
    expect(r.events).toHaveLength(1);
  });

  it('honors an already-aborted signal', async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await readStream(streamOf(['a\nb\n']), 'ndjson', 1000, { now, signal: ac.signal });
    expect(r.close).toBe('stopped');
    expect(r.events).toHaveLength(0);
  });

  it('returns cleanly on an empty body', async () => {
    const r = await readStream(null, 'sse', 1000, { now });
    expect(r).toEqual({ events: [], text: '', close: 'complete', firstEventMs: 0 });
  });
});
