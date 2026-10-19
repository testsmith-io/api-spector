// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Run an MQTT request as a test: connect, subscribe, optionally publish, collect
// the messages that arrive for a window, then run an sp.* assertion script over
// them (the messages are exposed as sp.messages). Used by the MQTT panel's "Run
// test" button and by the collection runner so an MQTT request can be a pass/
// fail step. One-shot: it opens its own connection and closes it when done.

import mqtt from 'mqtt';
import { runScript } from './script-runner';
import type { TestResult } from '../shared/types';

export interface CollectedMqttMessage {
  topic: string
  payload: string
  qos?: number
  retain?: boolean
  timestamp: number
}

export interface MqttTestConfig {
  url: string
  clientId?: string
  username?: string
  password?: string
  cleanSession?: boolean
  subscribeTopic?: string
  qos?: 0 | 1 | 2
  publishTopic?: string
  publishPayload?: string
  retain?: boolean
  /** How long to collect messages before running the script (ms). */
  collectMs: number
  /** Assertion script (sp.* sandbox). */
  script: string
  // Variable scopes available to the script.
  envVars?: Record<string, string>
  collectionVars?: Record<string, string>
  globals?: Record<string, string>
  localVars?: Record<string, string>
}

export interface MqttTestResult {
  testResults: TestResult[]
  consoleOutput: string[]
  error?: string
  messages: CollectedMqttMessage[]
  /** The client id actually used for the test connection (diagnostic). */
  clientId: string
}

export async function runMqttTest(cfg: MqttTestConfig): Promise<MqttTestResult> {
  const messages: CollectedMqttMessage[] = [];
  const collectMs = Math.max(0, Math.min(60_000, Math.floor(cfg.collectMs ?? 2000)));
  const clientId = cfg.clientId?.trim() || `api-spector-test-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;

  return new Promise<MqttTestResult>((resolve) => {
    let settled = false;
    let connected = false;
    let lastError = '';
    let client: mqtt.MqttClient;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const runAssertions = async (connectError?: string): Promise<void> => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { client?.end(true); } catch { /* ignore */ }

      // A connection error with nothing collected is the result — don't run the
      // script against an empty set as if it were a legitimate "no messages".
      if (connectError && messages.length === 0) {
        resolve({ testResults: [], consoleOutput: [], error: connectError, messages, clientId });
        return;
      }

      const out = await runScript(cfg.script ?? '', {
        envVars: cfg.envVars ?? {},
        collectionVars: cfg.collectionVars ?? {},
        globals: cfg.globals ?? {},
        localVars: cfg.localVars ?? {},
        mqttMessages: messages,
      });
      resolve({ testResults: out.testResults, consoleOutput: out.consoleOutput, error: out.error, messages, clientId });
    };

    try {
      client = mqtt.connect(cfg.url, {
        clientId,
        username: cfg.username?.trim() || undefined,
        password: cfg.password ? cfg.password : undefined,
        clean: cfg.cleanSession !== false,
        reconnectPeriod: 0,
        connectTimeout: 15_000,
      });
    } catch (err) {
      resolve({ testResults: [], consoleOutput: [], error: err instanceof Error ? err.message : String(err), messages, clientId });
      return;
    }

    client.on('connect', () => {
      connected = true;
      const publish = () => {
        const topic = cfg.publishTopic?.trim();
        if (!topic) return;
        // A PUBLISH topic must be concrete: MQTT forbids wildcards (+ or #) in a
        // published topic, and a broker answers such a packet by dropping the
        // connection with a protocol error. Subscribing to a wildcard is fine,
        // so when the Publish topic is a filter we simply skip publishing and
        // just collect from the subscription (the usual "listen only" test).
        if (/[+#]/.test(topic)) return;
        client.publish(topic, cfg.publishPayload ?? '', { qos: (cfg.qos ?? 0) as 0 | 1 | 2, retain: Boolean(cfg.retain) });
      };
      const sub = cfg.subscribeTopic?.trim();
      if (sub) {
        client.subscribe(sub, { qos: (cfg.qos ?? 0) as 0 | 1 | 2 }, () => setTimeout(publish, 100));
      } else {
        publish();
      }
      timer = setTimeout(() => void runAssertions(), collectMs);
    });

    client.on('message', (topic: string, payload: Buffer, packet) => {
      messages.push({ topic, payload: payload.toString('utf8'), qos: packet?.qos, retain: Boolean(packet?.retain), timestamp: Date.now() });
    });

    // mqtt.js can emit an error with an empty message for a refused connection,
    // so fall back to a clear one. A close while we are still collecting is a
    // real problem: either we never connected, or the broker dropped the
    // connection mid-test (a protocol error such as publishing to a wildcard
    // topic, or another connection using the same client id).
    client.on('error', (err: Error) => {
      const code = (err as { code?: string })?.code;
      lastError = [err?.message, code].filter(Boolean).join(' ');
      void runAssertions(err?.message || 'Could not connect to the broker');
    });
    client.on('close', () => {
      if (settled) return;
      void runAssertions(connected
        ? `The test connection was dropped by the broker before the window finished${lastError ? ` [${lastError}]` : ''}. Common causes: publishing to a topic that contains a wildcard (+ or #), or another connection using the same client id. Check the broker's log.`
        : `Could not connect to the broker${lastError ? ` [${lastError}]` : ''}`);
    });
  });
}
