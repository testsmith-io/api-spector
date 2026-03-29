// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http';
import { randomUUID } from 'crypto';
import { fetch, Headers } from 'undici';
import type {
  RecorderConfig, RecordedEntry, RecordingSession, MockServer, MockRoute,
} from '../shared/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MASK_HEADERS = new Set([
  'authorization', 'cookie', 'set-cookie', 'x-api-key',
  'x-auth-token', 'x-access-token', 'proxy-authorization',
]);

const HOP_BY_HOP = new Set([
  'host', 'connection', 'keep-alive', 'proxy-connection',
  'transfer-encoding', 'te', 'trailer', 'upgrade',
]);

const STRIP_FROM_MOCK_RESPONSE = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'content-encoding',
  'content-length', 'strict-transport-security', 'alt-svc',
  'cf-ray', 'cf-cache-status',
]);

// ─── State ────────────────────────────────────────────────────────────────────

let activeServer:   Server | null = null;
let activeConfig:   RecorderConfig | null = null;
let activeEntries:  RecordedEntry[] = [];
let activeStarted:  string = '';
let activeMaskSet:  Set<string> = new Set();
let _activeIgnoreSet: Set<string> = new Set();
let hitCallback: ((entry: RecordedEntry) => void) | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

export function isRecorderRunning(): boolean {
  return activeServer !== null;
}

export function getRecorderEntries(): RecordedEntry[] {
  return [...activeEntries];
}

export function setRecorderHitCallback(cb: ((entry: RecordedEntry) => void) | null): void {
  hitCallback = cb;
}

export async function startRecorder(config: RecorderConfig): Promise<void> {
  if (activeServer) throw new Error('Recorder already running');

  const upstream   = config.upstream.replace(/\/$/, '');
  const maskSet    = new Set([
    ...DEFAULT_MASK_HEADERS,
    ...(config.maskHeaders  ?? []).map(h => h.toLowerCase()),
  ]);
  const ignoreSet  = new Set([
    ...HOP_BY_HOP,
    ...(config.ignoreHeaders ?? []).map(h => h.toLowerCase()),
  ]);

  activeConfig    = config;
  activeEntries   = [];
  activeStarted   = new Date().toISOString();
  activeMaskSet   = maskSet;
  _activeIgnoreSet = ignoreSet;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const id        = randomUUID();
    const timestamp = new Date().toISOString();
    const start     = Date.now();

    const rawUrl  = req.url ?? '/';
    const parsed  = new URL(rawUrl, 'http://localhost');
    const path    = parsed.pathname;
    const query   = parseQuery(parsed.search);
    const method  = (req.method ?? 'GET').toUpperCase();

    // Silently ignore browser noise — not part of the API under test
    if (path === '/favicon.ico') {
      res.writeHead(204); res.end(); return;
    }

    let reqBodyBuf: Buffer;
    try {
      reqBodyBuf = await readBody(req);
    } catch {
      res.writeHead(400); res.end('Bad request body'); return;
    }
    const reqBodyStr = reqBodyBuf.length > 0 ? reqBodyBuf.toString('utf8') : null;

    // Build forward headers
    const forwardHeaders = new Headers();
    const recordedReqHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!v) continue;
      const val = Array.isArray(v) ? v.join(', ') : v;
      const lk  = k.toLowerCase();
      if (ignoreSet.has(lk)) continue;
      forwardHeaders.set(k, val);
      recordedReqHeaders[k] = maskSet.has(lk) ? '***' : val;
    }
    const upstreamUrl = new URL(upstream);
    forwardHeaders.set('host', upstreamUrl.host);

    const targetUrl = `${upstream}${rawUrl}`;
    let upstreamResp: Response;
    let respBodyBuf: Buffer;
    let timedOut = false;
    const timeoutMs = 30_000;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => { controller.abort(); timedOut = true; }, timeoutMs);
      upstreamResp = await fetch(targetUrl, {
        method,
        headers: forwardHeaders,
        body:    ['GET', 'HEAD'].includes(method) ? undefined : reqBodyBuf,
        signal:  controller.signal,
      } as Parameters<typeof fetch>[1]);
      clearTimeout(timer);
      respBodyBuf = Buffer.from(await upstreamResp.arrayBuffer());
    } catch (err) {
      const msg = timedOut
        ? `Upstream timed out after ${timeoutMs}ms`
        : `Upstream error: ${err instanceof Error ? err.message : String(err)}`;
      const entry: RecordedEntry = {
        id, timestamp, durationMs: Date.now() - start,
        request:  { method, path, query, headers: recordedReqHeaders, body: reqBodyStr },
        response: { status: 0, statusText: msg, headers: {}, body: null, binary: false, bodySize: 0 },
      };
      activeEntries.push(entry);
      hitCallback?.(entry);
      res.writeHead(504, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: msg }));
      return;
    }

    const durationMs  = Date.now() - start;
    const status      = upstreamResp.status;
    const statusText  = upstreamResp.statusText;
    const contentType = upstreamResp.headers.get('content-type') ?? '';
    const binary      = isBinary(contentType);

    const recordedRespHeaders: Record<string, string> = {};
    upstreamResp.headers.forEach((v, k) => {
      if (!ignoreSet.has(k.toLowerCase())) recordedRespHeaders[k] = v;
    });

    const entry: RecordedEntry = {
      id, timestamp, durationMs,
      request:  { method, path, query, headers: recordedReqHeaders, body: reqBodyStr },
      response: {
        status, statusText,
        headers:  recordedRespHeaders,
        body:     binary
          ? `base64:${respBodyBuf.toString('base64')}`
          : respBodyBuf.toString('utf8'),
        binary,
        bodySize: respBodyBuf.length,
      },
    };
    activeEntries.push(entry);
    hitCallback?.(entry);

    // Relay response unchanged
    const clientHeaders: Record<string, string> = {};
    upstreamResp.headers.forEach((v, k) => {
      const lk = k.toLowerCase();
      if (!HOP_BY_HOP.has(lk) && lk !== 'content-encoding') clientHeaders[k] = v;
    });
    clientHeaders['content-length'] = String(respBodyBuf.length);
    res.writeHead(status, clientHeaders);
    res.end(respBodyBuf);
  });

  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(config.port, '0.0.0.0', ok);
  });

  activeServer = server;
}

export function stopRecorder(): RecordingSession {
  if (!activeServer) throw new Error('Recorder is not running');
  activeServer.close();
  activeServer = null;

  const session: RecordingSession = {
    version:       '1.0',
    upstream:      activeConfig?.upstream ?? '',
    port:          activeConfig?.port ?? 0,
    startedAt:     activeStarted,
    maskedHeaders: [...activeMaskSet],
    entries:       activeEntries,
  };

  activeConfig  = null;
  activeEntries = [];
  return session;
}

export function entriesToMockServer(
  entries:  RecordedEntry[],
  upstream: string,
  name:     string,
  port:     number,
): MockServer {
  // Per method+path: prefer the first 2xx response; fall back to the last entry.
  const seen = new Map<string, RecordedEntry>();
  for (const e of entries) {
    const key = `${e.request.method}:${e.request.path}`;
    const existing = seen.get(key);
    const isSuccess = e.response.status >= 200 && e.response.status < 300;
    const existingIsSuccess = existing && existing.response.status >= 200 && existing.response.status < 300;
    // Keep first 2xx; for non-2xx keep overwriting so the last non-2xx survives.
    if (!existing || (!existingIsSuccess && isSuccess) || (!existingIsSuccess && !isSuccess)) seen.set(key, e);
  }

  const routes: MockRoute[] = [];
  for (const e of seen.values()) {
    const respHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(e.response.headers)) {
      if (!STRIP_FROM_MOCK_RESPONSE.has(k.toLowerCase())) respHeaders[k] = v;
    }
    routes.push({
      id:          randomUUID(),
      method:      e.request.method as MockRoute['method'],
      path:        e.request.path,
      statusCode:  e.response.status,
      headers:     respHeaders,
      body:        e.response.binary
        ? `[binary — recorded from ${upstream}${e.request.path}]`
        : (e.response.body ?? ''),
      description: `Recorded from ${upstream} at ${e.timestamp}`,
    });
  }

  return { version: '1.0', id: randomUUID(), name, port, routes };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end',  () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

function parseQuery(search: string): Record<string, string> {
  const q: Record<string, string> = {};
  new URLSearchParams(search).forEach((v, k) => { q[k] = v; });
  return q;
}

function isBinary(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return (
    ct.startsWith('image/') || ct.startsWith('audio/') || ct.startsWith('video/') ||
    ct.includes('octet-stream') || ct.includes('application/pdf') ||
    ct.includes('application/zip') || ct.includes('application/gzip') ||
    ct.includes('font/')
  );
}
