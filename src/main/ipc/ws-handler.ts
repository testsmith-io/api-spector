// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { WsMessage } from '../../shared/types';
import { runWsTest, type WsTestConfig, type RealtimeTestResult } from '../realtime-test';

// ─── Connection registry ──────────────────────────────────────────────────────

const connections = new Map<string, WebSocket>();

export function closeAllWsConnections(): void {
  for (const [, ws] of connections) {
    try { ws.close(); } catch { /* ignore */ }
  }
  connections.clear();
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

export function registerWsHandlers(ipc: IpcMain): void {
  // ws:connect — open a new WebSocket connection
  handleIpc(ipc, IPC.ws.connect, async (event: IpcMainInvokeEvent, requestId: string, url: string, headers: Record<string, string>) => {
    // Close any existing connection for this requestId
    const existing = connections.get(requestId);
    if (existing) {
      existing.close();
      connections.delete(requestId);
    }

    // The renderer may be destroyed (tab/window closed or reloaded) while the
    // socket is still open and firing message/close callbacks, so guard every
    // send — calling WebContents.send on a destroyed sender throws.
    const alive = () => !event.sender.isDestroyed();
    const status = (s: string, error?: string) => { if (alive()) event.sender.send(IPC.ws.status, { requestId, status: s, error }); };

    // Notify renderer: connecting
    status('connecting');

    const ws = new WebSocket(url, { headers });

    connections.set(requestId, ws);

    // If the renderer goes away (tab/window closed or reloaded), close the
    // socket so it doesn't stream into a destroyed sender indefinitely.
    event.sender.once('destroyed', () => { try { ws.close(); } catch { /* ignore */ } connections.delete(requestId); });

    ws.on('open', () => {
      status('connected');
    });

    ws.on('message', (data: WebSocket.RawData) => {
      if (!alive()) return;
      const message: WsMessage = {
        id: uuidv4(),
        direction: 'received',
        data: data.toString(),
        timestamp: Date.now(),
      };
      event.sender.send(IPC.ws.message, { requestId, message });
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

  // ws:send — send a text message on an existing connection
  handleIpc(ipc, IPC.ws.send, async (_event: IpcMainInvokeEvent, requestId: string, data: string) => {
    const ws = connections.get(requestId);
    if (ws?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    ws.send(data);
  });

  // ws:test — run a one-shot WebSocket test (its own connection) and assert.
  handleIpc(ipc, IPC.ws.test, async (_event: IpcMainInvokeEvent, cfg: WsTestConfig): Promise<RealtimeTestResult> => {
    const t0 = Date.now();
    const res = await runWsTest(cfg);
    console.log(`[ws:test] url=${cfg.url} collectMs=${cfg.collectMs} ran=${Date.now() - t0}ms messages=${res.messages.length}${res.error ? ` error=${res.error}` : ''}`);
    return res;
  });

  // ws:disconnect — close a connection
  handleIpc(ipc, IPC.ws.disconnect, async (_event: IpcMainInvokeEvent, requestId: string) => {
    const ws = connections.get(requestId);
    if (ws) {
      ws.close();
      connections.delete(requestId);
    }
  });
}
