// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store';
import type { GrpcCallState } from '../../store/slices/grpc-slice';
import type { ApiRequest, GrpcBody, GrpcMessage, GrpcServiceInfo, KeyValuePair } from '../../../../shared/types';

const { electron } = window;

interface Props {
  request: ApiRequest
  onChange: (patch: Partial<ApiRequest>) => void
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

const DEFAULT_GRPC: GrpcBody = { message: '{}', metadata: [], plaintext: false };

// metadata KeyValuePair[] <-> "key: value" lines, for a compact editor.
function metaToText(meta?: KeyValuePair[]): string {
  return (meta ?? []).map(m => `${m.key}: ${m.value}`).join('\n');
}
function textToMeta(text: string): KeyValuePair[] {
  return text.split('\n').map(line => {
    const i = line.indexOf(':');
    if (i === -1) return null;
    const key = line.slice(0, i).trim();
    if (!key) return null;
    return { key, value: line.slice(i + 1).trim(), enabled: true } as KeyValuePair;
  }).filter((x): x is KeyValuePair => x !== null);
}

export function GrpcPanel({ request, onChange }: Props) {
  const grpc = { ...DEFAULT_GRPC, ...(request.body.grpc ?? {}) };

  const grpcCalls          = useStore(s => s.grpcCalls);
  const setGrpcStatus      = useStore(s => s.setGrpcStatus);
  const addGrpcMessage     = useStore(s => s.addGrpcMessage);
  const clearGrpcMessages  = useStore(s => s.clearGrpcMessages);
  const setGrpcServices    = useStore(s => s.setGrpcServices);
  const setGrpcProtoError  = useStore(s => s.setGrpcProtoError);

  const call: GrpcCallState = grpcCalls[request.id] ?? { status: 'idle', messages: [], services: [] };
  const isRunning = call.status === 'running';

  const [loadingProto, setLoadingProto] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Patch the grpc body without losing the other body fields.
  function patchGrpc(changes: Partial<GrpcBody>): void {
    onChange({ body: { ...request.body, mode: 'grpc', grpc: { ...grpc, ...changes } } });
  }

  // Subscribe to streamed messages + status from the main process.
  useEffect(() => {
    electron.onGrpcMessage(({ requestId, message }: { requestId: string; message: GrpcMessage }) => {
      addGrpcMessage(requestId, message);
    });
    electron.onGrpcStatus(({ requestId, status, code, codeName, error }: { requestId: string; status: string; code?: number; codeName?: string; error?: string }) => {
      setGrpcStatus(requestId, status as 'idle' | 'running' | 'completed' | 'error', { code, codeName, error });
    });
    return () => electron.offGrpcEvents();
  }, [addGrpcMessage, setGrpcStatus]);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [call.messages.length]);

  const selectedService = useMemo(
    () => call.services.find(s => s.name === grpc.serviceName),
    [call.services, grpc.serviceName],
  );

  async function loadProto(): Promise<void> {
    if (!grpc.protoSource?.trim() && !grpc.protoPath?.trim()) return;
    setLoadingProto(true);
    try {
      const result: { services: GrpcServiceInfo[] } = await electron.grpcLoadProto({ protoSource: grpc.protoSource, protoPath: grpc.protoPath });
      const services = result.services;
      setGrpcServices(request.id, services);
      // Pre-select the first service/method if none chosen yet.
      if (services.length && !services.some(s => s.name === grpc.serviceName)) {
        patchGrpc({ serviceName: services[0].name, methodName: services[0].methods[0]?.name });
      }
    } catch (err) {
      setGrpcProtoError(request.id, err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingProto(false);
    }
  }

  async function invoke(): Promise<void> {
    if (!request.url || !grpc.serviceName || !grpc.methodName) return;
    clearGrpcMessages(request.id);
    // Log the request we are about to send.
    addGrpcMessage(request.id, { id: crypto.randomUUID(), direction: 'sent', data: grpc.message || '{}', timestamp: Date.now() });
    const metadata: Record<string, string> = {};
    for (const m of grpc.metadata ?? []) if (m.enabled && m.key) metadata[m.key] = m.value;
    try {
      await electron.grpcInvoke(request.id, {
        target: request.url,
        serviceName: grpc.serviceName,
        methodName: grpc.methodName,
        message: grpc.message || '{}',
        metadata,
        plaintext: grpc.plaintext,
        protoSource: grpc.protoSource,
        protoPath: grpc.protoPath,
      });
    } catch (err) {
      setGrpcStatus(request.id, 'error', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  function cancel(): void { electron.grpcCancel(request.id); }

  const statusColors: Record<string, string> = {
    running: 'bg-amber-400', completed: 'bg-emerald-500', error: 'bg-red-500', idle: 'bg-surface-600',
  };
  const inputCls = 'bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500';

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 pt-2 pb-1 flex-shrink-0 flex items-center gap-2">
        <span className="text-xs font-bold text-violet-400 bg-surface-800 border border-surface-700 rounded px-2 py-1">gRPC</span>
        <span className="text-[10px] text-surface-600">Set the target (host:port) in the URL field above.</span>
        <span className={`ml-auto w-2 h-2 rounded-full ${statusColors[call.status] ?? 'bg-surface-600'}`} title={call.status} />
        {call.codeName && <span className="text-[10px] font-mono text-surface-400">{call.codeName}</span>}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-2 flex flex-col gap-3">
        {/* Proto source */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] text-surface-400">Proto (paste .proto source, or a file path below)</label>
            <button onClick={loadProto} disabled={loadingProto} className="text-[10px] px-2 py-0.5 rounded border border-surface-700 text-surface-300 hover:border-violet-500 hover:text-violet-400 disabled:opacity-40">
              {loadingProto ? 'Loading…' : 'Load proto'}
            </button>
          </div>
          <textarea
            value={grpc.protoSource ?? ''}
            onChange={e => patchGrpc({ protoSource: e.target.value })}
            rows={4}
            spellCheck={false}
            placeholder={'syntax = "proto3";\npackage helloworld;\nservice Greeter { rpc SayHello (HelloRequest) returns (HelloReply); }'}
            className="w-full resize-y bg-surface-950 border border-surface-800 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-violet-500 placeholder-surface-700"
          />
          <input
            value={grpc.protoPath ?? ''}
            onChange={e => patchGrpc({ protoPath: e.target.value })}
            placeholder="/path/to/service.proto (optional; used if source is empty)"
            className={`${inputCls} w-full font-mono mt-1`}
          />
          {call.protoError && <p className="text-[10px] text-red-400 mt-1">{call.protoError}</p>}
        </div>

        {/* Service / method / plaintext */}
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <div>
            <label className="block text-[11px] text-surface-400 mb-1">Service</label>
            <select value={grpc.serviceName ?? ''} onChange={e => patchGrpc({ serviceName: e.target.value, methodName: call.services.find(s => s.name === e.target.value)?.methods[0]?.name })} className={`${inputCls} w-full`}>
              <option value="">{call.services.length ? 'Select…' : 'Load a proto first'}</option>
              {call.services.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-surface-400 mb-1">Method</label>
            <select value={grpc.methodName ?? ''} onChange={e => patchGrpc({ methodName: e.target.value })} className={`${inputCls} w-full`}>
              <option value="">Select…</option>
              {selectedService?.methods.map(m => (
                <option key={m.name} value={m.name}>{m.name}{m.responseStream ? ' (stream)' : ''}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-surface-300 pb-1.5">
            <input type="checkbox" checked={!!grpc.plaintext} onChange={e => patchGrpc({ plaintext: e.target.checked })} />
            Plaintext
          </label>
        </div>

        {/* Request message */}
        <div>
          <label className="block text-[11px] text-surface-400 mb-1">Request message (JSON)</label>
          <textarea
            value={grpc.message}
            onChange={e => patchGrpc({ message: e.target.value })}
            rows={4}
            spellCheck={false}
            placeholder={'{ "name": "world" }'}
            className="w-full resize-y bg-surface-950 border border-surface-800 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-violet-500 placeholder-surface-700"
          />
        </div>

        {/* Metadata */}
        <div>
          <label className="block text-[11px] text-surface-400 mb-1">Metadata (one <span className="font-mono">key: value</span> per line)</label>
          <textarea
            value={metaToText(grpc.metadata)}
            onChange={e => patchGrpc({ metadata: textToMeta(e.target.value) })}
            rows={2}
            spellCheck={false}
            placeholder={'authorization: Bearer {{TOKEN}}'}
            className="w-full resize-y bg-surface-950 border border-surface-800 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-violet-500 placeholder-surface-700"
          />
        </div>

        {/* Invoke / cancel */}
        <div className="flex items-center gap-2">
          {isRunning ? (
            <button onClick={cancel} className="px-4 py-1.5 bg-red-700 hover:bg-red-600 rounded text-sm font-medium">Cancel</button>
          ) : (
            <button onClick={invoke} disabled={!request.url || !grpc.serviceName || !grpc.methodName} className="px-4 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-surface-800 disabled:text-surface-500 rounded text-sm font-medium">
              Invoke
            </button>
          )}
          {call.messages.length > 0 && (
            <button onClick={() => clearGrpcMessages(request.id)} className="text-[10px] text-surface-600 hover:text-surface-400 ml-auto">Clear</button>
          )}
        </div>

        {call.status === 'error' && call.error && (
          <div className="px-3 py-1.5 bg-red-900/40 border border-red-700/50 rounded text-xs text-red-400">{call.error}</div>
        )}

        {/* Message log */}
        <div className="border border-surface-800 rounded bg-surface-950 min-h-[120px]">
          {call.messages.length === 0 ? (
            <div className="p-4 text-center text-xs text-surface-500">No messages yet</div>
          ) : (
            <div className="p-2 flex flex-col gap-1">
              {call.messages.map(msg => (
                <div key={msg.id} className={`flex gap-2 items-start text-xs rounded px-2 py-1.5 ${msg.direction === 'sent' ? 'bg-blue-900/30 border border-blue-800/40' : 'bg-emerald-900/20 border border-emerald-800/30'}`}>
                  <span className={`flex-shrink-0 font-mono font-bold ${msg.direction === 'sent' ? 'text-blue-400' : 'text-emerald-400'}`}>{msg.direction === 'sent' ? '→' : '←'}</span>
                  <span className="flex-1 font-mono text-surface-300 whitespace-pre-wrap break-all">{msg.data}</span>
                  <span className="flex-shrink-0 text-surface-400 font-mono text-[10px] mt-px">{formatTime(msg.timestamp)}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
