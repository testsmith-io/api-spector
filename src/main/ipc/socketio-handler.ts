// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Socket.IO connections, managed in the main process and keyed by requestId —
// the same model as the WebSocket handler. We use the official socket.io-client
// so the full protocol (Engine.IO handshake + upgrade, namespaces, handshake
// auth, acknowledgement callbacks, binary, reconnection) is handled for us.
// The renderer only emits events and renders the streamed session log.

import { type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import { io, type Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import type { SocketIoMessage } from '../../shared/types';
import { runSocketIoTest, type SocketIoTestConfig, type RealtimeTestResult } from '../realtime-test';

// ─── Connection registry ──────────────────────────────────────────────────────

const connections = new Map<string, Socket>();

export function closeAllSocketIoConnections(): void {
  for (const [, socket] of connections) {
    try { socket.disconnect(); } catch { /* ignore */ }
  }
  connections.clear();
}

interface ConnectOpts {
  url: string
  /** Namespace, e.g. "/admin". Defaults to the root namespace "/". */
  namespace?: string
  /** Handshake auth, a JSON object as text (e.g. '{"token":"abc"}'). */
  auth?: string
  /** Handshake headers (applied to the underlying transport). */
  headers?: Record<string, string>
  /** Engine.IO path, defaults to "/socket.io". */
  path?: string
}

interface EmitOpts {
  event: string
  /** Emit arguments as a JSON value; an array is spread, anything else is sent
   *  as a single argument. Empty means no arguments. */
  args?: string
  /** When true, request an acknowledgement callback and stream its payload back. */
  withAck?: boolean
  ackTimeoutMs?: number
}

// Join an origin URL with a namespace path (socket.io-client reads the namespace
// from the URI path, while the Engine.IO endpoint is the `path` option).
function targetUrl(url: string, namespace?: string): string {
  const ns = (namespace ?? '').trim();
  if (!ns || ns === '/') return url;
  return url.replace(/\/+$/, '') + (ns.startsWith('/') ? ns : `/${ns}`);
}

function jsonText(value: unknown): string {
  try { return JSON.stringify(value); } catch { return String(value); }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

export function registerSocketIoHandlers(ipc: IpcMain): void {
  // socketio:connect — open (or re-open) a connection for this request.
  handleIpc(ipc, IPC.socketio.connect, async (event: IpcMainInvokeEvent, requestId: string, opts: ConnectOpts) => {
    const existing = connections.get(requestId);
    if (existing) {
      existing.disconnect();
      connections.delete(requestId);
    }

    // Guard sends: the renderer may be destroyed (tab/window closed or reloaded)
    // while the socket is still open, and WebContents.send then throws.
    const alive = () => !event.sender.isDestroyed();
    const send = (message: SocketIoMessage) => { if (alive()) event.sender.send(IPC.socketio.message, { requestId, message }); };
    const status = (s: string, error?: string) => { if (alive()) event.sender.send(IPC.socketio.status, { requestId, status: s, error }); };
    const note = (ev: string, text: string) => send({ id: uuidv4(), direction: 'received', kind: 'system', event: ev, data: text, timestamp: Date.now() });

    let auth: Record<string, unknown> | undefined;
    if (opts.auth && opts.auth.trim()) {
      try {
        const parsed = JSON.parse(opts.auth);
        auth = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
      } catch {
        status('error', 'Auth is not valid JSON');
        return;
      }
    }

    status('connecting');

    let socket: Socket;
    try {
      socket = io(targetUrl(opts.url, opts.namespace), {
        path: opts.path?.trim() || '/socket.io',
        transports: ['websocket', 'polling'],
        extraHeaders: opts.headers,
        auth,
        forceNew: true,
        reconnection: true,
      });
    } catch (err) {
      status('error', err instanceof Error ? err.message : String(err));
      return;
    }

    connections.set(requestId, socket);

    // If the renderer goes away (tab/window closed or reloaded), close the
    // socket so it doesn't stream into a destroyed sender indefinitely.
    event.sender.once('destroyed', () => { try { socket.disconnect(); } catch { /* ignore */ } connections.delete(requestId); });

    socket.on('connect', () => {
      status('connected');
      note('connect', `Connected (id ${socket.id})`);
    });
    socket.on('disconnect', (reason: string) => {
      status('disconnected');
      note('disconnect', `Disconnected: ${reason}`);
    });
    socket.on('connect_error', (err: Error) => {
      status('error', err.message);
    });
    // Every inbound event (any name, including reserved ones the app didn't name).
    socket.onAny((eventName: string, ...args: unknown[]) => {
      send({ id: uuidv4(), direction: 'received', kind: 'event', event: eventName, data: jsonText(args), timestamp: Date.now() });
    });
  });

  // socketio:emit — emit an event on an existing connection.
  handleIpc(ipc, IPC.socketio.emit, async (event: IpcMainInvokeEvent, requestId: string, opts: EmitOpts) => {
    const socket = connections.get(requestId);
    if (!socket || !socket.connected) {
      throw new Error('Socket.IO is not connected');
    }

    let args: unknown[] = [];
    if (opts.args && opts.args.trim()) {
      let parsed: unknown;
      try { parsed = JSON.parse(opts.args); }
      catch { throw new Error('Emit arguments are not valid JSON'); }
      args = Array.isArray(parsed) ? parsed : [parsed];
    }

    if (opts.withAck) {
      const send = (message: SocketIoMessage) => { if (!event.sender.isDestroyed()) event.sender.send(IPC.socketio.message, { requestId, message }); };
      socket.timeout(opts.ackTimeoutMs ?? 5000).emit(opts.event, ...args, (err: Error | null, ...response: unknown[]) => {
        send(err
          ? { id: uuidv4(), direction: 'received', kind: 'system', event: opts.event, data: `No acknowledgement: ${err.message}`, timestamp: Date.now() }
          : { id: uuidv4(), direction: 'received', kind: 'ack', event: opts.event, data: jsonText(response), timestamp: Date.now() });
      });
    } else {
      socket.emit(opts.event, ...args);
    }
  });

  // socketio:test — run a one-shot Socket.IO test (its own connection) and assert.
  handleIpc(ipc, IPC.socketio.test, async (_event: IpcMainInvokeEvent, cfg: SocketIoTestConfig): Promise<RealtimeTestResult> => {
    const t0 = Date.now();
    const res = await runSocketIoTest(cfg);
    console.log(`[socketio:test] url=${cfg.url} collectMs=${cfg.collectMs} ran=${Date.now() - t0}ms messages=${res.messages.length}${res.error ? ` error=${res.error}` : ''}`);
    return res;
  });

  // socketio:disconnect — close a connection.
  handleIpc(ipc, IPC.socketio.disconnect, async (_event: IpcMainInvokeEvent, requestId: string) => {
    const socket = connections.get(requestId);
    if (socket) {
      socket.disconnect();
      connections.delete(requestId);
    }
  });
}
