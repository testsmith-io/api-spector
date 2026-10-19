// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Socket.IO session panel: connect to a Socket.IO server, emit named events
// with JSON arguments (optionally waiting for an acknowledgement), and watch the
// live session log. Mirrors the WebSocket panel; the connection itself lives in
// the main process (see socketio-handler.ts) and streams events into the store,
// which App.tsx subscribes to once.

import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { useVarValues } from '../../hooks/useVarValues';
import { VarInput } from '../common/VarInput';
import { RealtimeTestSection, useRealtimeTest } from '../common/RealtimeTestSection';
import { useT } from '../../i18n';
import type { ApiRequest, SocketIoMessage } from '../../../../shared/types';

const { electron } = window;

interface Props {
  readonly request: ApiRequest
  readonly onChange: (patch: Partial<ApiRequest>) => void
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export function SocketIoPanel({ request, onChange }: Props) {
  const t = useT();
  const connections    = useStore(s => s.socketIoConnections);
  const setStatus      = useStore(s => s.setSocketIoStatus);
  const addMessage     = useStore(s => s.addSocketIoMessage);
  const clearMessages  = useStore(s => s.clearSocketIoMessages);

  const conn = connections[request.id] ?? { status: 'disconnected', messages: [] };
  const isConnected = conn.status === 'connected';
  const isConnecting = conn.status === 'connecting';

  const cfg = request.socketio ?? {};
  const namespace = cfg.namespace ?? '';
  const auth = cfg.auth ?? '';

  const vars = useVarValues();
  const [eventName, setEventName] = useState('message');
  const [argsText, setArgsText] = useState('');
  const [withAck, setWithAck] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const interp = (s: string) => (s ?? '').replace(/\{\{([^}]+)\}\}/g, (_m, k) => vars[String(k).trim()] ?? '');

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conn.messages.length]);

  function patchConfig(patch: Partial<NonNullable<ApiRequest['socketio']>>) {
    onChange({ socketio: { ...request.socketio, ...patch } });
  }

  // Run the request as a test: a fresh connection opens, optionally emits an
  // event, collects received events for the window, then asserts over sp.messages.
  const test = useRealtimeTest(async (collectMs) => {
    const url = interp(request.url).trim();
    const headers: Record<string, string> = {};
    for (const h of request.headers) if (h.enabled && h.key) headers[interp(h.key)] = interp(h.value);
    return electron.socketIoTest({
      url,
      namespace,
      auth: auth ? interp(auth) : undefined,
      headers,
      emitEvent: cfg.emitEvent ? interp(cfg.emitEvent) : undefined,
      emitArgs: cfg.emitArgs ? interp(cfg.emitArgs) : undefined,
      collectMs,
      script: cfg.testScript ?? '',
      collectionVars: vars,
    });
  });

  async function connect() {
    if (!request.url) return;
    const headers: Record<string, string> = {};
    for (const h of request.headers) {
      if (h.enabled && h.key) headers[h.key] = h.value;
    }
    try {
      await electron.socketIoConnect(request.id, { url: request.url, namespace, auth, headers });
    } catch (err) {
      setStatus(request.id, 'error', err instanceof Error ? err.message : String(err));
    }
  }

  async function disconnect() {
    await electron.socketIoDisconnect(request.id);
  }

  async function emit() {
    const event = eventName.trim();
    if (!event || !isConnected) return;
    try {
      await electron.socketIoEmit(request.id, { event, args: argsText, withAck });
      const msg: SocketIoMessage = {
        id: crypto.randomUUID(),
        direction: 'sent',
        kind: 'event',
        event,
        data: argsText.trim() || '[]',
        timestamp: Date.now(),
      };
      addMessage(request.id, msg);
    } catch (err) {
      setStatus(request.id, 'error', err instanceof Error ? err.message : String(err));
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      emit();
    }
  }

  const statusColors: Record<string, string> = {
    connected: 'bg-emerald-500',
    connecting: 'bg-amber-400',
    error: 'bg-red-500',
    disconnected: 'bg-surface-600',
  };

  const kindStyle: Record<SocketIoMessage['kind'], string> = {
    event: 'text-surface-300',
    ack: 'text-violet-300',
    system: 'text-surface-500 italic',
  };

  return (
    <div className="flex flex-col h-full">
      {/* Line 2: protocol label | endpoint | connect */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 flex-shrink-0">
        <span className="text-xs font-bold text-fuchsia-100 bg-fuchsia-700 rounded px-2 py-1.5 flex-shrink-0">
          IO
        </span>
        <VarInput
          value={request.url}
          onChange={url => onChange({ url })}
          placeholder="http://localhost:3000"
          wrapperClassName="flex-1"
          className="bg-surface-800 border border-surface-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 font-mono placeholder-surface-700"
        />
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColors[conn.status] ?? 'bg-surface-600'}`} title={conn.status} />
        {isConnected || isConnecting ? (
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

      {/* Namespace + handshake auth (persisted on the request) */}
      <div className="flex items-center gap-2 px-4 pb-2 flex-shrink-0">
        <label className="text-[10px] uppercase tracking-wider text-surface-500 shrink-0">{t('Namespace')}</label>
        <input
          value={namespace}
          onChange={e => patchConfig({ namespace: e.target.value })}
          disabled={isConnected || isConnecting}
          placeholder="/"
          className="w-32 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <label className="text-[10px] uppercase tracking-wider text-surface-500 shrink-0 ml-2">{t('Auth (JSON)')}</label>
        <input
          value={auth}
          onChange={e => patchConfig({ auth: e.target.value })}
          disabled={isConnected || isConnecting}
          placeholder='{"token":"..."}'
          className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-500 placeholder-surface-700 disabled:opacity-50"
        />
      </div>

      {/* Error message */}
      {conn.status === 'error' && conn.error && (
        <div className="mx-4 mb-1 px-3 py-1.5 bg-red-900/40 border border-red-700/50 rounded text-xs text-red-400 flex-shrink-0">
          {conn.error}
        </div>
      )}

      <div className="px-4 mb-1 flex-shrink-0">
        <p className="text-[10px] text-surface-600">
          {t('Edit the URL and headers in the ')}<span className="text-surface-500">{t('Headers')}</span>{t(' tab above. Connect, then emit events on the right.')}
        </p>
      </div>

      {/* Body: event feed (left) + emit & test controls (right) */}
      <div className="flex-1 min-h-0 flex gap-3 px-4 pb-3">
        {/* Event feed */}
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex-1 min-h-0 border border-surface-800 rounded overflow-y-auto bg-surface-950 relative">
            {conn.messages.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-surface-400">
                {t('No events yet')}
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
                      <span className="font-mono font-semibold text-surface-200">{msg.event}</span>
                      {msg.kind === 'ack' && <span className="ml-1.5 text-[9px] uppercase tracking-wider text-violet-400 border border-violet-500/30 rounded px-1">{t('ack')}</span>}
                      {msg.data && msg.data !== '[]' && (
                        <div className={`font-mono whitespace-pre-wrap break-all mt-0.5 ${kindStyle[msg.kind]}`}>{msg.data}</div>
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

        {/* Emit + Test controls */}
        <div className="w-[380px] flex-shrink-0 flex flex-col gap-3 min-h-0 overflow-y-auto">
          {/* Emit */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase tracking-wider text-surface-500">{t('Emit')}</label>
            <div className="flex items-center gap-2">
              <input
                value={eventName}
                onChange={e => setEventName(e.target.value)}
                disabled={!isConnected}
                placeholder={t('event name')}
                className="w-48 bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-500 placeholder-surface-700 disabled:opacity-50"
              />
              <label className="flex items-center gap-1.5 text-xs text-surface-400 select-none">
                <input type="checkbox" checked={withAck} onChange={e => setWithAck(e.target.checked)} className="accent-blue-500" />
                {t('Wait for ack')}
              </label>
            </div>
            <div className="flex gap-2">
              <textarea
                value={argsText}
                onChange={e => setArgsText(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!isConnected}
                rows={2}
                placeholder={isConnected ? t('Arguments as JSON, e.g. ["hello", {"id": 1}]  (Ctrl+Enter to emit)') : t('Connect first to emit events')}
                className="flex-1 resize-none bg-surface-800 border border-surface-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500 placeholder-surface-700 disabled:opacity-50"
              />
              <button
                onClick={emit}
                disabled={!isConnected || !eventName.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-surface-800 disabled:text-surface-400 rounded text-sm font-medium transition-colors self-end"
              >
                {t('Emit')}
              </button>
            </div>
          </div>

          {/* Test: collect events for a window, then assert over them */}
          <RealtimeTestSection
            buttonClass="bg-fuchsia-700 hover:bg-fuchsia-600"
            dotClass="text-fuchsia-400/70"
            hint={<>{t('The test opens its own connection, optionally emits an event, collects events for the window, then asserts. Events are in')} <span className="font-mono text-surface-500">sp.messages</span> {t('(each has .event and .args).')}</>}
            scriptPlaceholder={"sp.test('a tick arrives', () => {\n  const m = sp.messages.find(m => m.event === 'tick');\n  sp.expect(m).to.exist;\n  sp.expect(m.json().n).to.be.a('number');\n});"}
            testScript={cfg.testScript ?? ''}
            collectMs={cfg.collectMs ?? 3000}
            onChangeScript={s => patchConfig({ testScript: s })}
            onChangeCollectMs={ms => patchConfig({ collectMs: ms })}
            running={test.running}
            remaining={test.remaining}
            result={test.result}
            onRun={() => test.run(cfg.collectMs ?? 3000)}
            runDisabled={!request.url}
          >
            <div className="flex items-center gap-2">
              <input
                value={cfg.emitEvent ?? ''}
                onChange={e => patchConfig({ emitEvent: e.target.value })}
                placeholder={t('event to emit on connect (optional)')}
                className="w-56 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-500 placeholder-surface-700"
              />
              <input
                value={cfg.emitArgs ?? ''}
                onChange={e => patchConfig({ emitArgs: e.target.value })}
                placeholder={t('args as JSON (optional)')}
                className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-500 placeholder-surface-700"
              />
            </div>
          </RealtimeTestSection>
        </div>
      </div>
    </div>
  );
}
