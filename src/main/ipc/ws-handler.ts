import { type IpcMain, type IpcMainInvokeEvent } from 'electron';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { WsMessage } from '../../shared/types';

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
  ipc.handle('ws:connect', async (event: IpcMainInvokeEvent, requestId: string, url: string, headers: Record<string, string>) => {
    // Close any existing connection for this requestId
    const existing = connections.get(requestId);
    if (existing) {
      existing.close();
      connections.delete(requestId);
    }

    // Notify renderer: connecting
    event.sender.send('ws:status', { requestId, status: 'connecting' });

    const ws = new WebSocket(url, { headers });

    connections.set(requestId, ws);

    ws.on('open', () => {
      event.sender.send('ws:status', { requestId, status: 'connected' });
    });

    ws.on('message', (data: WebSocket.RawData) => {
      const message: WsMessage = {
        id: uuidv4(),
        direction: 'received',
        data: data.toString(),
        timestamp: Date.now(),
      };
      event.sender.send('ws:message', { requestId, message });
    });

    ws.on('error', (err: Error) => {
      event.sender.send('ws:status', { requestId, status: 'error', error: err.message });
      connections.delete(requestId);
    });

    ws.on('close', () => {
      event.sender.send('ws:status', { requestId, status: 'disconnected' });
      connections.delete(requestId);
    });
  });

  // ws:send — send a text message on an existing connection
  ipc.handle('ws:send', async (_event: IpcMainInvokeEvent, requestId: string, data: string) => {
    const ws = connections.get(requestId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    ws.send(data);
  });

  // ws:disconnect — close a connection
  ipc.handle('ws:disconnect', async (_event: IpcMainInvokeEvent, requestId: string) => {
    const ws = connections.get(requestId);
    if (ws) {
      ws.close();
      connections.delete(requestId);
    }
  });
}
