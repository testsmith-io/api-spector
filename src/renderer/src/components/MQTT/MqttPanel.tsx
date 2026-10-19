// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// MQTT session panel: connect to a broker (mqtt://, mqtts://, ws://, wss://),
// subscribe to topics, publish messages, and watch the live session log.
// Mirrors the Socket.IO panel; the connection itself lives in the main process
// (see mqtt-handler.ts) and streams messages into the store, which App.tsx
// subscribes to once. Broker URL is edited in the shared URL bar above.
// username / password / topics support {{var}} interpolation, so a secret can
// be referenced with a variable instead of being stored on disk.

import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { useVarValues } from '../../hooks/useVarValues';
import { VarInput } from '../common/VarInput';
import { useT } from '../../i18n';
import type { ApiRequest, MqttMessage } from '../../../../shared/types';

const { electron } = window;

type Qos = 0 | 1 | 2

interface Props {
  readonly request: ApiRequest
  readonly onChange: (patch: Partial<ApiRequest>) => void
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export function MqttPanel({ request, onChange }: Props) {
  const t = useT();
  const connections   = useStore(s => s.mqttConnections);
  const setStatus     = useStore(s => s.setMqttStatus);
  const addMessage    = useStore(s => s.addMqttMessage);
  const clearMessages = useStore(s => s.clearMqttMessages);
  const vars = useVarValues();

  const conn = connections[request.id] ?? { status: 'disconnected', messages: [] as MqttMessage[] };
  const isConnected = conn.status === 'connected';
  const isConnecting = conn.status === 'connecting';
  const locked = isConnected || isConnecting;

  const cfg = request.mqtt ?? {};
  const qos: Qos = (cfg.qos ?? 0) as Qos;

  const [payload, setPayload] = useState('');
  const [publishError, setPublishError] = useState('');
  const [showTest, setShowTest] = useState(Boolean(cfg.testScript?.trim()));
  const [testRunning, setTestRunning] = useState(false);
  const [testRemaining, setTestRemaining] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<Awaited<ReturnType<typeof electron.mqttTest>> | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conn.messages.length]);

  const interp = (s: string) => (s ?? '').replace(/\{\{([^}]+)\}\}/g, (_m, k) => vars[String(k).trim()] ?? '');

  function patchConfig(patch: Partial<NonNullable<ApiRequest['mqtt']>>) {
    onChange({ mqtt: { ...request.mqtt, ...patch } });
  }

  async function connect() {
    const url = interp(request.url).trim();
    if (!url) { setStatus(request.id, 'error', t('No broker URL')); return; }
    try {
      await electron.mqttConnect(request.id, {
        url,
        clientId: cfg.clientId ? interp(cfg.clientId) : undefined,
        username: cfg.username ? interp(cfg.username) : undefined,
        password: cfg.password ? interp(cfg.password) : undefined,
        cleanSession: cfg.cleanSession !== false,
        subscribeTopic: cfg.subscribeTopic ? interp(cfg.subscribeTopic) : undefined,
        qos,
      });
    } catch (err) {
      setStatus(request.id, 'error', err instanceof Error ? err.message : String(err));
    }
  }

  async function disconnect() {
    await electron.mqttDisconnect(request.id);
  }

  async function subscribe() {
    const topic = interp(cfg.subscribeTopic ?? '').trim();
    if (!topic || !isConnected) return;
    try {
      await electron.mqttSubscribe(request.id, { topic, qos });
    } catch (err) {
      setStatus(request.id, 'error', err instanceof Error ? err.message : String(err));
    }
  }

  async function unsubscribe() {
    const topic = interp(cfg.subscribeTopic ?? '').trim();
    if (!topic || !isConnected) return;
    await electron.mqttUnsubscribe(request.id, { topic });
  }

  async function publish() {
    const topic = interp(cfg.publishTopic ?? '').trim();
    if (!topic || !isConnected) return;
    // MQTT forbids wildcards in a published topic; sending one makes the broker
    // drop the connection, so refuse it here with a clear message instead.
    if (/[+#]/.test(topic)) {
      setPublishError(t('A publish topic cannot contain a wildcard (+ or #).'));
      return;
    }
    setPublishError('');
    const body = interp(payload);
    try {
      await electron.mqttPublish(request.id, { topic, payload: body, qos, retain: Boolean(cfg.retain) });
      addMessage(request.id, {
        id: crypto.randomUUID(),
        direction: 'sent',
        kind: 'message',
        topic,
        data: body,
        qos,
        retain: Boolean(cfg.retain),
        timestamp: Date.now(),
      });
    } catch (err) {
      setStatus(request.id, 'error', err instanceof Error ? err.message : String(err));
    }
  }

  // Run the request as a test: a fresh one-shot connection subscribes,
  // optionally publishes, collects messages for the window, then asserts.
  async function runTest() {
    const url = interp(request.url).trim();
    if (!url) return;
    const collectMs = cfg.collectMs ?? 3000;
    setTestRunning(true);
    setTestResult(null);
    // Visible countdown so it is clear the test is collecting for the window.
    setTestRemaining(Math.ceil(collectMs / 1000));
    const countdown = setInterval(() => setTestRemaining(r => (r && r > 1 ? r - 1 : 0)), 1000);
    try {
      const res = await electron.mqttTest({
        url,
        // The test opens its own connection; never reuse the panel's Client ID,
        // or the broker would kick whichever connected first (a clientId clash).
        clientId: undefined,
        username: cfg.username ? interp(cfg.username) : undefined,
        password: cfg.password ? interp(cfg.password) : undefined,
        cleanSession: cfg.cleanSession !== false,
        subscribeTopic: cfg.subscribeTopic ? interp(cfg.subscribeTopic) : undefined,
        qos,
        publishTopic: cfg.publishTopic ? interp(cfg.publishTopic) : undefined,
        publishPayload: cfg.publishPayload ? interp(cfg.publishPayload) : undefined,
        retain: Boolean(cfg.retain),
        collectMs,
        script: cfg.testScript ?? '',
        collectionVars: vars,
      });
      setTestResult(res);
    } catch (err) {
      setTestResult({ testResults: [], consoleOutput: [], error: err instanceof Error ? err.message : String(err), messages: [] });
    } finally {
      clearInterval(countdown);
      setTestRemaining(null);
      setTestRunning(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      publish();
    }
  }

  const statusColors: Record<string, string> = {
    connected: 'bg-emerald-500',
    connecting: 'bg-amber-400',
    error: 'bg-red-500',
    disconnected: 'bg-surface-600',
  };

  const inputCls = 'bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-500 placeholder-surface-700 disabled:opacity-50';

  return (
    <div className="flex flex-col h-full">
      {/* Line 2: protocol label | endpoint | connect */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 flex-shrink-0">
        <span className="text-xs font-bold text-teal-100 bg-teal-700 rounded px-2 py-1.5 flex-shrink-0">
          MQTT
        </span>
        <VarInput
          value={request.url}
          onChange={url => onChange({ url })}
          placeholder="mqtt://broker.example.com:1883"
          wrapperClassName="flex-1"
          className="bg-surface-800 border border-surface-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 font-mono placeholder-surface-700"
        />
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColors[conn.status] ?? 'bg-surface-600'}`} title={conn.status} />
        {locked ? (
          <button
            onClick={disconnect}
            disabled={isConnecting}
            className="px-4 py-1.5 bg-red-700 hover:bg-red-600 disabled:bg-surface-800 disabled:text-surface-600 rounded text-sm font-medium transition-colors min-w-[100px]"
          >
            {isConnecting ? t('Connecting…') : t('Disconnect')}
          </button>
        ) : (
          <button
            onClick={connect}
            disabled={!request.url}
            className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-surface-800 disabled:text-surface-600 rounded text-sm font-medium transition-colors min-w-[100px]"
          >
            {t('Connect')}
          </button>
        )}
      </div>

      {/* Connection config (persisted) */}
      <div className="flex items-center gap-2 px-4 pb-2 flex-shrink-0 flex-wrap">
        <input
          value={cfg.clientId ?? ''}
          onChange={e => patchConfig({ clientId: e.target.value })}
          disabled={locked}
          placeholder={t('Client ID (auto)')}
          className={`w-40 ${inputCls}`}
        />
        <input
          value={cfg.username ?? ''}
          onChange={e => patchConfig({ username: e.target.value })}
          disabled={locked}
          placeholder={t('Username')}
          className={`w-36 ${inputCls}`}
        />
        <input
          type="password"
          value={cfg.password ?? ''}
          onChange={e => patchConfig({ password: e.target.value })}
          disabled={locked}
          placeholder={t('Password or {{var}}')}
          className={`w-44 ${inputCls}`}
        />
        <label className="flex items-center gap-1.5 text-xs text-surface-400 select-none">
          <input
            type="checkbox"
            checked={cfg.cleanSession !== false}
            onChange={e => patchConfig({ cleanSession: e.target.checked })}
            disabled={locked}
            className="accent-blue-500"
          />
          {t('Clean session')}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-surface-400 select-none ml-auto">
          {t('QoS')}
          <select
            value={qos}
            onChange={e => patchConfig({ qos: Number(e.target.value) as Qos })}
            className="bg-surface-800 border border-surface-700 rounded px-1.5 py-1 text-xs focus:outline-none focus:border-blue-500"
          >
            <option value={0}>0</option>
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </label>
      </div>

      {/* Error message */}
      {conn.status === 'error' && conn.error && (
        <div className="mx-4 mb-1 px-3 py-1.5 bg-red-900/40 border border-red-700/50 rounded text-xs text-red-400 flex-shrink-0">
          {conn.error}
        </div>
      )}

      {/* Subscribe row */}
      <div className="flex items-center gap-2 px-4 pb-2 flex-shrink-0">
        <label className="text-[10px] uppercase tracking-wider text-surface-500 shrink-0">{t('Subscribe')}</label>
        <input
          value={cfg.subscribeTopic ?? ''}
          onChange={e => patchConfig({ subscribeTopic: e.target.value })}
          placeholder={t('topic/filter (e.g. sensors/#)')}
          className={`flex-1 ${inputCls}`}
        />
        <button
          onClick={subscribe}
          disabled={!isConnected || !(cfg.subscribeTopic ?? '').trim()}
          className="px-3 py-1 bg-teal-700 hover:bg-teal-600 disabled:bg-surface-800 disabled:text-surface-600 rounded text-xs font-medium transition-colors whitespace-nowrap"
        >
          {t('Subscribe')}
        </button>
        <button
          onClick={unsubscribe}
          disabled={!isConnected || !(cfg.subscribeTopic ?? '').trim()}
          className="px-3 py-1 bg-surface-800 hover:bg-surface-700 disabled:text-surface-600 rounded text-xs font-medium transition-colors whitespace-nowrap"
        >
          {t('Unsubscribe')}
        </button>
      </div>

      {/* Body: message feed (left) + publish & test controls (right) */}
      <div className="flex-1 min-h-0 flex gap-3 px-4 pb-3">
        {/* Message feed */}
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex-1 min-h-0 border border-surface-800 rounded overflow-y-auto bg-surface-950 relative">
            {conn.messages.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-surface-400">
                {t('No messages yet')}
              </div>
            ) : (
              <div className="p-2 flex flex-col gap-1">
                {conn.messages.map(msg => (
                  <div
                    key={msg.id}
                    className={`flex gap-2 items-start text-xs rounded px-2 py-1.5 ${
                      msg.kind === 'system'
                        ? 'bg-surface-900 border border-surface-800'
                        : msg.direction === 'sent'
                          ? 'bg-blue-900/30 border border-blue-800/40'
                          : 'bg-emerald-900/20 border border-emerald-800/30'
                    }`}
                  >
                    <span className={`flex-shrink-0 font-mono font-bold ${msg.kind === 'system' ? 'text-surface-500' : msg.direction === 'sent' ? 'text-blue-400' : 'text-emerald-400'}`}>
                      {msg.kind === 'system' ? 'ℹ' : msg.direction === 'sent' ? '→' : '←'}
                    </span>
                    <div className="flex-1 min-w-0">
                      {msg.kind === 'message' ? (
                        <>
                          <span className="font-mono font-semibold text-surface-200">{msg.topic}</span>
                          <span className="ml-1.5 text-[9px] uppercase tracking-wider text-surface-500 border border-surface-700 rounded px-1">{t('QoS')} {msg.qos ?? 0}</span>
                          {msg.retain && <span className="ml-1 text-[9px] uppercase tracking-wider text-amber-400 border border-amber-500/30 rounded px-1">{t('retain')}</span>}
                          {msg.data && (
                            <div className="font-mono whitespace-pre-wrap break-all mt-0.5 text-surface-300">{msg.data}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-surface-500 italic">{msg.data}</span>
                      )}
                    </div>
                    <span className="flex-shrink-0 text-surface-400 font-mono text-[10px] mt-px">{formatTime(msg.timestamp)}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
          {conn.messages.length > 0 && (
            <div className="flex justify-end">
              <button
                onClick={() => clearMessages(request.id)}
                className="text-[10px] text-surface-600 hover:text-surface-400 transition-colors"
              >
                {t('Clear log')}
              </button>
            </div>
          )}
        </div>

        {/* Publish + Test controls */}
        <div className="w-[380px] flex-shrink-0 flex flex-col gap-3 min-h-0 overflow-y-auto">
          {/* Publish */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase tracking-wider text-surface-500 shrink-0">{t('Publish')}</label>
              <input
                value={cfg.publishTopic ?? ''}
                onChange={e => patchConfig({ publishTopic: e.target.value })}
                disabled={!isConnected}
                placeholder={t('topic (e.g. devices/lamp/set)')}
                className={`flex-1 ${inputCls}`}
              />
              <label className="flex items-center gap-1.5 text-xs text-surface-400 select-none">
                <input
                  type="checkbox"
                  checked={Boolean(cfg.retain)}
                  onChange={e => patchConfig({ retain: e.target.checked })}
                  className="accent-blue-500"
                />
                {t('Retain')}
              </label>
            </div>
            <div className="flex gap-2">
              <textarea
                value={payload}
                onChange={e => setPayload(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!isConnected}
                rows={2}
                placeholder={isConnected ? t('Message payload (Ctrl+Enter to publish)') : t('Connect first to publish')}
                className="flex-1 resize-none bg-surface-800 border border-surface-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500 placeholder-surface-700 disabled:opacity-50"
              />
              <button
                onClick={publish}
                disabled={!isConnected || !(cfg.publishTopic ?? '').trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-surface-800 disabled:text-surface-400 rounded text-sm font-medium transition-colors self-end"
              >
                {t('Publish')}
              </button>
            </div>
            {publishError && (
              <p className="text-[10px] text-red-400">{publishError}</p>
            )}
          </div>

          {/* Test: collect messages for a window, then assert over them */}
          <div className="border-t border-surface-800 pt-2 flex flex-col gap-2">
            <button
              onClick={() => setShowTest(v => !v)}
              className="text-[10px] uppercase tracking-wider text-surface-500 hover:text-surface-300 transition-colors self-start"
            >
              <span className="text-[14px] leading-none">{showTest ? '▾' : '▸'}</span> {t('Test')}
              {(cfg.testScript ?? '').trim() && <span className="ml-1.5 text-emerald-500/70 normal-case">●</span>}
            </button>

            {showTest && (
              <div className="flex flex-col gap-2">
                <p className="text-[10px] text-surface-600">
                  {t('The test opens its own connection, subscribes to the Subscribe topic above, optionally publishes, collects for the window, then asserts. Messages are in')} <span className="font-mono text-surface-500">sp.messages</span>.
                </p>
                {!(cfg.subscribeTopic ?? '').trim() && (
                  <p className="text-[10px] text-amber-500/80">{t('No Subscribe topic is set above, so the test will collect nothing. Set one (e.g. sensors/#) to receive messages.')}</p>
                )}
                <div className="flex items-center gap-2">
                  <label className="text-[10px] uppercase tracking-wider text-surface-500 shrink-0">{t('Collect (seconds)')}</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    step={1}
                    value={Math.round((cfg.collectMs ?? 3000) / 1000)}
                    onChange={e => patchConfig({ collectMs: Math.max(1, Math.min(60, Math.floor(Number(e.target.value) || 1))) * 1000 })}
                    className={`w-20 ${inputCls}`}
                  />
                </div>
                <input
                  value={cfg.publishPayload ?? ''}
                  onChange={e => patchConfig({ publishPayload: e.target.value })}
                  placeholder={t('Publish payload (optional) — sent to the Publish topic')}
                  className={`w-full ${inputCls}`}
                />
                {/[+#]/.test((cfg.publishTopic ?? '').trim()) && (
                  <p className="text-[10px] text-amber-500/80">{t('The Publish topic contains a wildcard (+ or #), which MQTT does not allow for publishing, so the test will not publish. Use a concrete topic to publish, or clear it to only collect.')}</p>
                )}
                <textarea
                  value={cfg.testScript ?? ''}
                  onChange={e => patchConfig({ testScript: e.target.value })}
                  rows={8}
                  spellCheck={false}
                  placeholder={"sp.test('a reading arrives', () => {\n  const m = sp.messages.find(m => m.topic === 'sensors/temp');\n  sp.expect(m).to.exist;\n  sp.expect(m.json().c).to.be.a('number');\n});"}
                  className="w-full resize-y bg-surface-800 border border-surface-700 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-500 placeholder-surface-700"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={runTest}
                    disabled={testRunning || !request.url || !(cfg.testScript ?? '').trim()}
                    className="px-3 py-1.5 bg-teal-700 hover:bg-teal-600 disabled:bg-surface-800 disabled:text-surface-600 rounded text-xs font-medium transition-colors"
                  >
                    {testRunning ? (testRemaining && testRemaining > 0 ? t('Collecting… :n s', { n: testRemaining }) : t('Running…')) : t('Run test')}
                  </button>
                  {testResult && !testRunning && (() => {
                    const passed = testResult.testResults.filter(r => r.passed).length;
                    const total = testResult.testResults.length;
                    const ok = !testResult.error && total > 0 && passed === total;
                    return (
                      <span className={`text-xs font-medium ${testResult.error ? 'text-red-400' : ok ? 'text-emerald-400' : total === 0 ? 'text-surface-500' : 'text-red-400'}`}>
                        {testResult.error ? t('error') : total === 0 ? t('no assertions') : `${passed}/${total} ${t('passed')}`}
                        <span className="text-surface-600 font-normal"> · {t(':count message|:count messages', { count: testResult.messages.length })} {t('collected')}</span>
                      </span>
                    );
                  })()}
                </div>

                {testResult && !testRunning && (
                  <div className="flex flex-col gap-1">
                    {testResult.error && (
                      <div className="px-2 py-1 bg-red-900/40 border border-red-700/50 rounded text-[11px] text-red-400 font-mono break-all">{testResult.error}</div>
                    )}
                    {testResult.testResults.map((r, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11px]">
                        <span className={r.passed ? 'text-emerald-400' : 'text-red-400'}>{r.passed ? '✓' : '✗'}</span>
                        <span className="text-surface-300">{r.name}</span>
                        {!r.passed && r.error && <span className="text-red-400/80 font-mono break-all">{r.error}</span>}
                      </div>
                    ))}
                    {testResult.consoleOutput.length > 0 && (
                      <pre className="mt-1 text-[10px] text-surface-500 font-mono whitespace-pre-wrap break-all">{testResult.consoleOutput.join('\n')}</pre>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
