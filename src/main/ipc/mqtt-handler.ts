// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// MQTT connections, managed in main and keyed by requestId (like the WS/Socket.IO handlers).
// MQTT.js speaks MQTT over TCP (mqtt://, mqtts://) and WebSocket (ws://, wss://).

import { type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import mqtt, { type MqttClient } from 'mqtt';
import { v4 as uuidv4 } from 'uuid';
import type { MqttMessage } from '../../shared/types';
import { runMqttTest, type MqttTestConfig, type MqttTestResult } from '../mqtt-test';

// Connection registry

const connections = new Map<string, MqttClient>();

export function closeAllMqttConnections(): void {
  for (const [, client] of connections) {
    try { client.end(true); } catch { /* ignore */ }
  }
  connections.clear();
}

type Qos = 0 | 1 | 2

interface ConnectOpts {
  url: string
  clientId?: string
  username?: string
  password?: string
  cleanSession?: boolean
  /** Optional topic to subscribe to immediately on connect. */
  subscribeTopic?: string
  qos?: Qos
}

interface PublishOpts {
  topic: string
  payload: string
  qos?: Qos
  retain?: boolean
}

interface SubscribeOpts {
  topic: string
  qos?: Qos
}

function normalizeQos(q: unknown): Qos {
  return q === 1 || q === 2 ? q : 0;
}

// IPC handlers

export function registerMqttHandlers(ipc: IpcMain): void {
  // mqtt:connect - open (or re-open) a connection for this request.
  handleIpc(ipc, IPC.mqtt.connect, async (event: IpcMainInvokeEvent, requestId: string, opts: ConnectOpts) => {
    const existing = connections.get(requestId);
    if (existing) {
      try { existing.end(true); } catch { /* ignore */ }
      connections.delete(requestId);
    }

    // Guard sends: the renderer may be destroyed while the connection is open,
    // and WebContents.send then throws.
    const alive = () => !event.sender.isDestroyed();
    const send = (message: MqttMessage) => { if (alive()) event.sender.send(IPC.mqtt.message, { requestId, message }); };
    const status = (s: string, error?: string) => { if (alive()) event.sender.send(IPC.mqtt.status, { requestId, status: s, error }); };
    const note = (topic: string, text: string) => send({ id: uuidv4(), direction: 'received', kind: 'system', topic, data: text, timestamp: Date.now() });

    const url = (opts.url ?? '').trim();
    if (!url) { status('error', 'No broker URL'); return; }

    status('connecting');

    let client: MqttClient;
    try {
      client = mqtt.connect(url, {
        clientId: opts.clientId?.trim() || `api-spector-${Math.random().toString(16).slice(2, 10)}`,
        username: opts.username?.trim() || undefined,
        password: opts.password ? opts.password : undefined,
        clean: opts.cleanSession !== false,
        // Recover from a transient drop and re-apply subscriptions automatically.
        reconnectPeriod: 2000,
        resubscribe: true,
        connectTimeout: 30_000,
      });
    } catch (err) {
      status('error', err instanceof Error ? err.message : String(err));
      return;
    }

    connections.set(requestId, client);

    // If the renderer goes away, end the client so it doesn't stream into a
    // destroyed sender.
    event.sender.once('destroyed', () => { try { client.end(true); } catch { /* ignore */ } connections.delete(requestId); });

    client.on('connect', () => {
      status('connected');
      note('', `Connected to ${url}`);
      const topic = opts.subscribeTopic?.trim();
      if (topic) {
        client.subscribe(topic, { qos: normalizeQos(opts.qos) }, (err) => {
          note(topic, err ? `Subscribe failed: ${err.message}` : `Subscribed to ${topic}`);
        });
      }
    });

    client.on('message', (topic: string, payload: Buffer, packet) => {
      send({
        id: uuidv4(),
        direction: 'received',
        kind: 'message',
        topic,
        data: payload.toString('utf8'),
        qos: normalizeQos(packet?.qos),
        retain: Boolean(packet?.retain),
        timestamp: Date.now(),
      });
    });

    // A non-fatal error (mqtt.js keeps the connection on many of these) is shown
    // as a note, NOT a disconnect - only an actual close changes the status.
    client.on('error', (err: Error) => {
      note('', `Error: ${err.message}`);
    });
    client.on('reconnect', () => {
      status('connecting');
    });
    client.on('offline', () => {
      status('connecting');
      note('', 'Connection lost, reconnecting…');
    });
    client.on('close', () => {
      // Only a close we did NOT initiate (client still registered) is a drop
      // we auto-recover from; an explicit disconnect de-registers it first.
      if (connections.get(requestId) === client) status('connecting');
    });
  });

  // mqtt:publish - publish a message on an existing connection.
  handleIpc(ipc, IPC.mqtt.publish, async (_event: IpcMainInvokeEvent, requestId: string, opts: PublishOpts) => {
    const client = connections.get(requestId);
    if (!client || !client.connected) throw new Error('MQTT is not connected');
    const topic = (opts.topic ?? '').trim();
    if (!topic) throw new Error('Publish topic is required');
    await new Promise<void>((resolve, reject) => {
      client.publish(topic, opts.payload ?? '', { qos: normalizeQos(opts.qos), retain: Boolean(opts.retain) }, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  });

  // mqtt:subscribe - subscribe to a topic (or topic filter) on an existing connection.
  handleIpc(ipc, IPC.mqtt.subscribe, async (event: IpcMainInvokeEvent, requestId: string, opts: SubscribeOpts) => {
    const client = connections.get(requestId);
    if (!client || !client.connected) throw new Error('MQTT is not connected');
    const topic = (opts.topic ?? '').trim();
    if (!topic) throw new Error('Subscribe topic is required');
    const send = (message: MqttMessage) => { if (!event.sender.isDestroyed()) event.sender.send(IPC.mqtt.message, { requestId, message }); };
    await new Promise<void>((resolve, reject) => {
      client.subscribe(topic, { qos: normalizeQos(opts.qos) }, (err) => {
        send({ id: uuidv4(), direction: 'received', kind: 'system', topic, data: err ? `Subscribe failed: ${err.message}` : `Subscribed to ${topic}`, timestamp: Date.now() });
        if (err) reject(err); else resolve();
      });
    });
  });

  // mqtt:unsubscribe - stop receiving from a topic.
  handleIpc(ipc, IPC.mqtt.unsubscribe, async (event: IpcMainInvokeEvent, requestId: string, opts: SubscribeOpts) => {
    const client = connections.get(requestId);
    if (!client || !client.connected) return;
    const topic = (opts.topic ?? '').trim();
    if (!topic) return;
    const send = (message: MqttMessage) => { if (!event.sender.isDestroyed()) event.sender.send(IPC.mqtt.message, { requestId, message }); };
    client.unsubscribe(topic, () => {
      send({ id: uuidv4(), direction: 'received', kind: 'system', topic, data: `Unsubscribed from ${topic}`, timestamp: Date.now() });
    });
  });

  // mqtt:test - run a one-shot MQTT test (its own connection) and assert.
  handleIpc(ipc, IPC.mqtt.test, async (_event: IpcMainInvokeEvent, cfg: MqttTestConfig): Promise<MqttTestResult> => {
    const t0 = Date.now();
    const res = await runMqttTest(cfg);
    // Diagnostic: asked-for vs actual run time and what was collected.
    console.log(`[mqtt:test] url=${cfg.url} sub=${cfg.subscribeTopic ?? '(none)'} clientId=${res.clientId} collectMs=${cfg.collectMs} ran=${Date.now() - t0}ms messages=${res.messages.length}${res.error ? ` error=${res.error}` : ''}`);
    return res;
  });

  // mqtt:disconnect - close a connection.
  handleIpc(ipc, IPC.mqtt.disconnect, async (event: IpcMainInvokeEvent, requestId: string) => {
    const client = connections.get(requestId);
    if (client) {
      connections.delete(requestId);   // mark intentional before 'close' fires
      try { client.end(true); } catch { /* ignore */ }
    }
    if (!event.sender.isDestroyed()) event.sender.send(IPC.mqtt.status, { requestId, status: 'disconnected' });
  });
}
