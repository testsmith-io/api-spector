// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// GraphQL subscriptions over WebSocket, using the graphql-ws protocol
// ("graphql-transport-ws" subprotocol). Managed in the main process and keyed
// by requestId, like the WebSocket and Socket.IO handlers. We speak the protocol
// directly over the ws library (already a dependency): connection_init ->
// connection_ack -> subscribe -> next* -> complete, answering server pings.

import { type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { GraphQlWsMessage } from '../../shared/types';
import { runGraphqlWsTest, type GraphqlWsTestConfig, type RealtimeTestResult } from '../realtime-test';

const SUB_ID = '1';   // one subscription per connection/request
const connections = new Map<string, WebSocket>();

export function closeAllGraphqlWsConnections(): void {
  for (const [, ws] of connections) {
    try { ws.close(); } catch { /* ignore */ }
  }
  connections.clear();
}

interface SubscribeOpts {
  url: string
  headers?: Record<string, string>
  query: string
  /** Variables as JSON text. */
  variables?: string
  operationName?: string
  /** connection_init payload as JSON text. */
  connectionParams?: string
}

function parseJsonObject(text: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!text || !text.trim()) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error(`${label} is not valid JSON`); }
  return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
}

export function registerGraphqlWsHandlers(ipc: IpcMain): void {
  handleIpc(ipc, IPC.graphqlws.subscribe, async (event: IpcMainInvokeEvent, requestId: string, opts: SubscribeOpts) => {
    const existing = connections.get(requestId);
    if (existing) { existing.close(); connections.delete(requestId); }

    // The renderer may be gone (tab/window closed or reloaded) while the socket
    // is still open and firing close/error callbacks, so guard every send —
    // calling WebContents.send on a destroyed sender throws.
    const alive = () => !event.sender.isDestroyed();
    const send = (message: GraphQlWsMessage) => { if (alive()) event.sender.send(IPC.graphqlws.message, { requestId, message }); };
    const status = (s: string, error?: string) => { if (alive()) event.sender.send(IPC.graphqlws.status, { requestId, status: s, error }); };
    const note = (text: string) => send({ id: uuidv4(), kind: 'system', data: text, timestamp: Date.now() });

    let variables: Record<string, unknown> | undefined;
    let connectionParams: Record<string, unknown> | undefined;
    try {
      variables = parseJsonObject(opts.variables, 'Variables');
      connectionParams = parseJsonObject(opts.connectionParams, 'Connection params');
    } catch (e) {
      status('error', e instanceof Error ? e.message : String(e));
      return;
    }

    status('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(opts.url, 'graphql-transport-ws', { headers: opts.headers });
    } catch (e) {
      status('error', e instanceof Error ? e.message : String(e));
      return;
    }
    connections.set(requestId, ws);

    // If the renderer goes away (tab/window closed or reloaded), close the
    // socket so the subscription doesn't stream into a destroyed sender.
    event.sender.once('destroyed', () => { try { ws.close(); } catch { /* ignore */ } connections.delete(requestId); });

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'connection_init', payload: connectionParams }));
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      let msg: { type?: string; id?: string; payload?: unknown };
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      switch (msg.type) {
        case 'connection_ack':
          status('connected');
          note('Connected; subscription started');
          ws.send(JSON.stringify({ id: SUB_ID, type: 'subscribe', payload: { query: opts.query, variables, operationName: opts.operationName } }));
          break;
        case 'next':
          send({ id: uuidv4(), kind: 'next', data: JSON.stringify(msg.payload), timestamp: Date.now() });
          break;
        case 'error':
          send({ id: uuidv4(), kind: 'error', data: JSON.stringify(msg.payload), timestamp: Date.now() });
          break;
        case 'complete':
          send({ id: uuidv4(), kind: 'complete', data: 'Subscription complete', timestamp: Date.now() });
          ws.close();
          break;
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        default:
          break;
      }
    });

    ws.on('error', (err: Error) => {
      status('error', err.message);
      connections.delete(requestId);
    });
    ws.on('close', () => {
      status('disconnected');
      connections.delete(requestId);
    });
  });

  // graphqlws:test — run a one-shot subscription test (its own connection) and assert.
  handleIpc(ipc, IPC.graphqlws.test, async (_event: IpcMainInvokeEvent, cfg: GraphqlWsTestConfig): Promise<RealtimeTestResult> => {
    const t0 = Date.now();
    const res = await runGraphqlWsTest(cfg);
    console.log(`[graphqlws:test] url=${cfg.url} collectMs=${cfg.collectMs} ran=${Date.now() - t0}ms messages=${res.messages.length}${res.error ? ` error=${res.error}` : ''}`);
    return res;
  });

  handleIpc(ipc, IPC.graphqlws.stop, async (_event: IpcMainInvokeEvent, requestId: string) => {
    const ws = connections.get(requestId);
    if (!ws) return;
    try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: SUB_ID, type: 'complete' })); } catch { /* ignore */ }
    ws.close();
    connections.delete(requestId);
  });
}
