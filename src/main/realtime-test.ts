// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Run a realtime request (WebSocket, Socket.IO or a GraphQL subscription) as a
// test: open a one-shot connection, optionally send something, collect what
// arrives for a window, then run an sp.* assertion script over the collected
// items (exposed as sp.messages). The same model as the MQTT test (mqtt-test.ts)
// and used by the panels' "Run test" buttons and the collection runner.
//
// Each collected item becomes an sp.messages entry with .json()/.text() plus
// protocol-specific fields:
//   WebSocket  → .data (the frame text)
//   Socket.IO  → .event (name), .args (array); .json() is the first argument
//   GraphQL    → .data (the subscription payload's data object)

import WebSocket from 'ws';
import { io, type Socket } from 'socket.io-client';
import { runScript } from './script-runner';
import type { TestResult } from '../shared/types';

// ─── Shared types ───────────────────────────────────────────────────────────

/** One collected item. `payload` is the serialized form behind .json()/.text();
 *  any other fields are passed through onto the sp.messages entry. */
export type CollectedRealtimeMessage = { payload: string; timestamp: number } & Record<string, unknown>;

export interface RealtimeTestResult {
  testResults: TestResult[]
  consoleOutput: string[]
  error?: string
  messages: CollectedRealtimeMessage[]
}

interface ScriptScopes {
  script: string
  envVars?: Record<string, string>
  collectionVars?: Record<string, string>
  globals?: Record<string, string>
  localVars?: Record<string, string>
}

function clampWindow(ms: number | undefined): number {
  return Math.max(0, Math.min(60_000, Math.floor(ms ?? 3000)));
}

// Run the assertion script over the collected messages and shape the result.
async function assertOver(cfg: ScriptScopes, messages: CollectedRealtimeMessage[]): Promise<RealtimeTestResult> {
  const out = await runScript(cfg.script ?? '', {
    envVars: cfg.envVars ?? {},
    collectionVars: cfg.collectionVars ?? {},
    globals: cfg.globals ?? {},
    localVars: cfg.localVars ?? {},
    messages,
  });
  return { testResults: out.testResults, consoleOutput: out.consoleOutput, error: out.error, messages };
}

function errorResult(error: string, messages: CollectedRealtimeMessage[]): RealtimeTestResult {
  return { testResults: [], consoleOutput: [], error, messages };
}

function parseJsonObject(text: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!text || !text.trim()) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error(`${label} is not valid JSON`); }
  return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
}

// ─── WebSocket ──────────────────────────────────────────────────────────────

export interface WsTestConfig extends ScriptScopes {
  url: string
  headers?: Record<string, string>
  /** Optional message sent once, shortly after the connection opens. */
  sendMessage?: string
  collectMs: number
}

export async function runWsTest(cfg: WsTestConfig): Promise<RealtimeTestResult> {
  const messages: CollectedRealtimeMessage[] = [];
  const collectMs = clampWindow(cfg.collectMs);

  return new Promise<RealtimeTestResult>((resolve) => {
    let settled = false;
    let connected = false;
    let lastError = '';
    let ws: WebSocket;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = async (connectError?: string): Promise<void> => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { ws?.close(); } catch { /* ignore */ }
      if (connectError && messages.length === 0) { resolve(errorResult(connectError, messages)); return; }
      resolve(await assertOver(cfg, messages));
    };

    try {
      ws = new WebSocket(cfg.url, { headers: cfg.headers });
    } catch (err) {
      resolve(errorResult(err instanceof Error ? err.message : String(err), messages));
      return;
    }

    ws.on('open', () => {
      connected = true;
      if (cfg.sendMessage) { try { ws.send(cfg.sendMessage); } catch { /* ignore */ } }
      timer = setTimeout(() => void finish(), collectMs);
    });
    ws.on('message', (data: WebSocket.RawData) => {
      const text = data.toString();
      messages.push({ payload: text, data: text, timestamp: Date.now() });
    });
    ws.on('error', (err: Error) => { lastError = err.message; void finish(err.message || 'Could not connect to the server'); });
    ws.on('close', () => {
      if (settled) return;
      void finish(connected
        ? `The WebSocket was closed before the window finished${lastError ? ` [${lastError}]` : ''}.`
        : `Could not connect to the server${lastError ? ` [${lastError}]` : ''}`);
    });
  });
}

// ─── Socket.IO ──────────────────────────────────────────────────────────────

export interface SocketIoTestConfig extends ScriptScopes {
  url: string
  namespace?: string
  auth?: string
  headers?: Record<string, string>
  path?: string
  /** Optional event emitted once after the connection opens. */
  emitEvent?: string
  /** Emit arguments as JSON text; an array is spread, anything else is one arg. */
  emitArgs?: string
  collectMs: number
}

function targetUrl(url: string, namespace?: string): string {
  const ns = (namespace ?? '').trim();
  if (!ns || ns === '/') return url;
  return url.replace(/\/+$/, '') + (ns.startsWith('/') ? ns : `/${ns}`);
}

export async function runSocketIoTest(cfg: SocketIoTestConfig): Promise<RealtimeTestResult> {
  const messages: CollectedRealtimeMessage[] = [];
  const collectMs = clampWindow(cfg.collectMs);

  let auth: Record<string, unknown> | undefined;
  try { auth = parseJsonObject(cfg.auth, 'Auth'); }
  catch (e) { return errorResult(e instanceof Error ? e.message : String(e), messages); }

  let emitArgs: unknown[] = [];
  if (cfg.emitArgs && cfg.emitArgs.trim()) {
    try { const parsed = JSON.parse(cfg.emitArgs); emitArgs = Array.isArray(parsed) ? parsed : [parsed]; }
    catch { return errorResult('Emit arguments are not valid JSON', messages); }
  }

  return new Promise<RealtimeTestResult>((resolve) => {
    let settled = false;
    let socket: Socket;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = async (connectError?: string): Promise<void> => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { socket?.disconnect(); } catch { /* ignore */ }
      if (connectError && messages.length === 0) { resolve(errorResult(connectError, messages)); return; }
      resolve(await assertOver(cfg, messages));
    };

    try {
      socket = io(targetUrl(cfg.url, cfg.namespace), {
        path: cfg.path?.trim() || '/socket.io',
        transports: ['websocket', 'polling'],
        extraHeaders: cfg.headers,
        auth,
        forceNew: true,
        reconnection: false,
      });
    } catch (err) {
      resolve(errorResult(err instanceof Error ? err.message : String(err), messages));
      return;
    }

    socket.on('connect', () => {
      const ev = cfg.emitEvent?.trim();
      if (ev) setTimeout(() => { try { socket.emit(ev, ...emitArgs); } catch { /* ignore */ } }, 100);
      timer = setTimeout(() => void finish(), collectMs);
    });
    socket.on('connect_error', (err: Error) => { void finish(`Could not connect to the server${err.message ? ` [${err.message}]` : ''}`); });
    socket.onAny((event: string, ...args: unknown[]) => {
      const payload = JSON.stringify(args.length <= 1 ? (args[0] ?? null) : args);
      messages.push({ payload, event, args, timestamp: Date.now() });
    });
  });
}

// ─── GraphQL subscriptions (graphql-ws) ──────────────────────────────────────

export interface GraphqlWsTestConfig extends ScriptScopes {
  url: string
  headers?: Record<string, string>
  query: string
  variables?: string
  operationName?: string
  connectionParams?: string
  collectMs: number
}

const GQL_SUB_ID = '1';

export async function runGraphqlWsTest(cfg: GraphqlWsTestConfig): Promise<RealtimeTestResult> {
  const messages: CollectedRealtimeMessage[] = [];
  const collectMs = clampWindow(cfg.collectMs);

  let variables: Record<string, unknown> | undefined;
  let connectionParams: Record<string, unknown> | undefined;
  try {
    variables = parseJsonObject(cfg.variables, 'Variables');
    connectionParams = parseJsonObject(cfg.connectionParams, 'Connection params');
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e), messages);
  }

  return new Promise<RealtimeTestResult>((resolve) => {
    let settled = false;
    let connected = false;
    let lastError = '';
    let ws: WebSocket;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = async (connectError?: string): Promise<void> => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { ws?.close(); } catch { /* ignore */ }
      if (connectError && messages.length === 0) { resolve(errorResult(connectError, messages)); return; }
      resolve(await assertOver(cfg, messages));
    };

    try {
      ws = new WebSocket(cfg.url, 'graphql-transport-ws', { headers: cfg.headers });
    } catch (err) {
      resolve(errorResult(err instanceof Error ? err.message : String(err), messages));
      return;
    }

    ws.on('open', () => {
      connected = true;
      ws.send(JSON.stringify({ type: 'connection_init', payload: connectionParams }));
      timer = setTimeout(() => void finish(), collectMs);
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      let msg: { type?: string; id?: string; payload?: unknown };
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      switch (msg.type) {
        case 'connection_ack':
          ws.send(JSON.stringify({ id: GQL_SUB_ID, type: 'subscribe', payload: { query: cfg.query, variables, operationName: cfg.operationName } }));
          break;
        case 'next': {
          const payload = msg.payload as { data?: unknown; errors?: unknown } | undefined;
          const data = payload?.data;
          messages.push({ payload: JSON.stringify(data ?? payload ?? null), data, errors: payload?.errors, timestamp: Date.now() });
          break;
        }
        case 'error':
          lastError = JSON.stringify(msg.payload);
          void finish(`The subscription returned an error${lastError ? ` [${lastError}]` : ''}`);
          break;
        case 'complete':
          // Server ended the subscription; assert over whatever we collected.
          void finish();
          break;
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        default:
          break;
      }
    });

    ws.on('error', (err: Error) => { lastError = err.message; void finish(err.message || 'Could not connect to the server'); });
    ws.on('close', () => {
      if (settled) return;
      void finish(connected
        ? `The subscription connection was closed before the window finished${lastError ? ` [${lastError}]` : ''}.`
        : `Could not connect to the server${lastError ? ` [${lastError}]` : ''}`);
    });
  });
}
