// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { useVarValues } from '../../hooks/useVarValues';
import { VarInput } from '../common/VarInput';
import { RealtimeTestSection, useRealtimeTest } from '../common/RealtimeTestSection';
import { useT } from '../../i18n';
import type { ApiRequest, WsMessage } from '../../../../shared/types';

const { electron } = window;

interface Props {
  readonly request: ApiRequest
  readonly onChange: (patch: Partial<ApiRequest>) => void
}

// Format timestamp as HH:MM:SS.mmm
function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function WebSocketPanel({ request, onChange }: Props) {
  const t = useT();
  const wsConnections    = useStore(s => s.wsConnections);
  const setWsStatus      = useStore(s => s.setWsStatus);
  const addWsMessage     = useStore(s => s.addWsMessage);
  const clearWsMessages  = useStore(s => s.clearWsMessages);

  const conn = wsConnections[request.id] ?? { status: 'disconnected', messages: [] };
  const isConnected = conn.status === 'connected';
  const isConnecting = conn.status === 'connecting';

  const vars = useVarValues();
  const cfg = request.websocket ?? {};
  const [sendText, setSendText] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);

  const interp = (s: string) => (s ?? '').replace(/\{\{([^}]+)\}\}/g, (_m, k) => vars[String(k).trim()] ?? '');

  function patchConfig(patch: Partial<NonNullable<ApiRequest['websocket']>>) {
    onChange({ websocket: { ...request.websocket, ...patch } });
  }

  // Run the request as a test: a fresh connection opens, optionally sends a
  // message, collects frames for the window, then asserts over sp.messages.
  const test = useRealtimeTest(async (collectMs) => {
    const url = interp(request.url).trim();
    const headers: Record<string, string> = {};
    for (const h of request.headers) if (h.enabled && h.key) headers[interp(h.key)] = interp(h.value);
    return electron.wsTest({
      url,
      headers,
      sendMessage: cfg.sendMessage ? interp(cfg.sendMessage) : undefined,
      collectMs,
      script: cfg.testScript ?? '',
      collectionVars: vars,
    });
  });

  // Subscribe to WS events from main process
  useEffect(() => {
    electron.onWsMessage(({ requestId, message }: { requestId: string; message: WsMessage }) => {
      addWsMessage(requestId, message);
    });
    electron.onWsStatus(({ requestId, status, error }: { requestId: string; status: Parameters<typeof setWsStatus>[1]; error?: string }) => {
      setWsStatus(requestId, status, error);
    });
    return () => {
      electron.offWsEvents();
    };
  }, [addWsMessage, setWsStatus]);

  // Auto-scroll to latest message
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conn.messages.length]);

  async function connect() {
    if (!request.url) return;
    const headers: Record<string, string> = {};
    for (const h of request.headers) {
      if (h.enabled && h.key) headers[h.key] = h.value;
    }
    try {
      await electron.wsConnect(request.id, request.url, headers);
    } catch (err) {
      setWsStatus(request.id, 'error', err instanceof Error ? err.message : String(err));
    }
  }

  async function disconnect() {
    await electron.wsDisconnect(request.id);
  }

  async function sendMessage() {
    const text = sendText.trim();
    if (!text || !isConnected) return;
    try {
      await electron.wsSend(request.id, text);
      const msg: WsMessage = {
        id: crypto.randomUUID(),
        direction: 'sent',
        data: text,
        timestamp: Date.now(),
      };
      addWsMessage(request.id, msg);
      setSendText('');
    } catch (err) {
      setWsStatus(request.id, 'error', err instanceof Error ? err.message : String(err));
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendMessage();
    }
  }

  // Status badge
  const statusColors: Record<string, string> = {
    connected: 'bg-emerald-500',
    connecting: 'bg-amber-400',
    error: 'bg-red-500',
    disconnected: 'bg-surface-600',
  };

  return (
    <div className="flex flex-col h-full">
      {/* Line 2: protocol label | endpoint | connect */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 flex-shrink-0">
        <span className="text-xs font-bold text-cyan-200 bg-cyan-700 rounded px-2 py-1.5 flex-shrink-0">
          WS
        </span>
        <VarInput
          value={request.url}
          onChange={url => onChange({ url })}
          placeholder="ws://example.com/socket"
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

      {/* Error message */}
      {conn.status === 'error' && conn.error && (
        <div className="mx-4 mb-1 px-3 py-1.5 bg-red-900/40 border border-red-700/50 rounded text-xs text-red-400 flex-shrink-0">
          {conn.error}
        </div>
      )}

      {/* URL edit hint */}
      <div className="px-4 mb-1 flex-shrink-0">
        <p className="text-[10px] text-surface-600">
          {t('Edit URL and headers in the ')}<span className="text-surface-500">{t('Headers')}</span>{t(' tab above. Connect, then send messages on the right.')}
        </p>
      </div>

      {/* Body: message feed (left) + send & test controls (right) */}
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
                      msg.direction === 'sent'
                        ? 'bg-blue-900/30 border border-blue-800/40'
                        : 'bg-emerald-900/20 border border-emerald-800/30'
                    }`}
                  >
                    <span className={`flex-shrink-0 font-mono font-bold ${msg.direction === 'sent' ? 'text-blue-400' : 'text-emerald-400'}`}>
                      {msg.direction === 'sent' ? '→' : '←'}
                    </span>
                    <span className="flex-1 font-mono text-surface-300 whitespace-pre-wrap break-all">{msg.data}</span>
                    <span className="flex-shrink-0 text-surface-400 font-mono text-[10px] mt-px">
                      {formatTime(msg.timestamp)}
                    </span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
          {conn.messages.length > 0 && (
            <div className="flex justify-end">
              <button
                onClick={() => clearWsMessages(request.id)}
                className="text-[10px] text-surface-600 hover:text-surface-400 transition-colors"
              >
                {t('Clear messages')}
              </button>
            </div>
          )}
        </div>

        {/* Send + Test controls */}
        <div className="w-[380px] flex-shrink-0 flex flex-col gap-3 min-h-0 overflow-y-auto">
          {/* Send */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase tracking-wider text-surface-500">{t('Send')}</label>
            <div className="flex gap-2">
              <textarea
                value={sendText}
                onChange={e => setSendText(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!isConnected}
                rows={2}
                placeholder={isConnected ? t('Type a message… (Ctrl+Enter to send)') : t('Connect first to send messages')}
                className="flex-1 resize-none bg-surface-800 border border-surface-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500 placeholder-surface-700 disabled:opacity-50"
              />
              <button
                onClick={sendMessage}
                disabled={!isConnected || !sendText.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-surface-800 disabled:text-surface-400 rounded text-sm font-medium transition-colors self-end"
              >
                {t('Send')}
              </button>
            </div>
          </div>

          {/* Test: collect frames for a window, then assert over them */}
          <RealtimeTestSection
            buttonClass="bg-cyan-700 hover:bg-cyan-600"
            dotClass="text-cyan-400/70"
            hint={<>{t('The test opens its own connection, optionally sends a message, collects frames for the window, then asserts. Frames are in')} <span className="font-mono text-surface-500">sp.messages</span>.</>}
            scriptPlaceholder={"sp.test('a tick arrives', () => {\n  const m = sp.messages.find(m => m.text().includes('tick'));\n  sp.expect(m).to.exist;\n  sp.expect(m.json().type).to.equal('tick');\n});"}
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
            <input
              value={cfg.sendMessage ?? ''}
              onChange={e => patchConfig({ sendMessage: e.target.value })}
              placeholder={t('Message to send on open (optional)')}
              className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-500 placeholder-surface-700"
            />
          </RealtimeTestSection>
        </div>
      </div>
    </div>
  );
}
