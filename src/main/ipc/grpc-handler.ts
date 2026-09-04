// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type { GrpcServiceInfo, GrpcMessage } from '../../shared/types';

// ─── Call registry ────────────────────────────────────────────────────────────
// One in-flight call per requestId, so a second invoke or a cancel supersedes it.
interface ActiveCall {
  cancel: () => void
}
const calls = new Map<string, ActiveCall>();

export function closeAllGrpcConnections(): void {
  for (const [, c] of calls) {
    try { c.cancel(); } catch { /* ignore */ }
  }
  calls.clear();
}

// ─── Proto loading ────────────────────────────────────────────────────────────

interface ProtoSource {
  protoSource?: string
  protoPath?: string
  importPaths?: string[]
}

const LOADER_OPTS: protoLoader.Options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

// Resolve the proto to a filename + import dirs proto-loader can read. Pasted
// source is written to a throwaway temp file so its `import` statements still
// resolve against importPaths.
function resolveProtoFile(src: ProtoSource): { file: string; includeDirs: string[] } {
  const importPaths = (src.importPaths ?? []).filter(Boolean);

  if (src.protoPath) {
    return { file: src.protoPath, includeDirs: [path.dirname(src.protoPath), ...importPaths] };
  }
  if (src.protoSource && src.protoSource.trim()) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apispector-proto-'));
    const file = path.join(dir, 'main.proto');
    fs.writeFileSync(file, src.protoSource, 'utf8');
    return { file, includeDirs: [dir, ...importPaths] };
  }
  throw new Error('No proto source: paste a .proto or provide a file path.');
}

function loadPackage(src: ProtoSource): protoLoader.PackageDefinition {
  const { file, includeDirs } = resolveProtoFile(src);
  return protoLoader.loadSync(file, { ...LOADER_OPTS, includeDirs });
}

// A package-definition entry is a service when its members look like gRPC
// methods (they carry requestStream / responseStream flags).
function enumerateServices(pkgDef: protoLoader.PackageDefinition): GrpcServiceInfo[] {
  const services: GrpcServiceInfo[] = [];
  for (const [name, def] of Object.entries(pkgDef)) {
    const methods = Object.entries(def as Record<string, unknown>)
      .filter(([, m]) => m && typeof m === 'object' && 'requestStream' in (m as object))
      .map(([mName, m]) => {
        const md = m as { requestStream: boolean; responseStream: boolean };
        return { name: mName, requestStream: !!md.requestStream, responseStream: !!md.responseStream };
      });
    if (methods.length) services.push({ name, methods });
  }
  return services;
}

// Walk a dotted service name (e.g. "helloworld.Greeter") into the loaded object.
function resolveService(grpcObj: grpc.GrpcObject, serviceName: string): grpc.ServiceClientConstructor {
  let node: unknown = grpcObj;
  for (const part of serviceName.split('.')) {
    node = (node as Record<string, unknown>)?.[part];
    if (!node) throw new Error(`Service "${serviceName}" not found in the proto.`);
  }
  if (typeof node !== 'function') throw new Error(`"${serviceName}" is not a service.`);
  return node as grpc.ServiceClientConstructor;
}

// Strip a scheme (grpc://, http://, dns:) so grpc-js gets a bare host:port.
function normalizeTarget(url: string): string {
  return url.replace(/^[a-z0-9+.-]+:\/\//i, '').replace(/\/+$/, '');
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

export function registerGrpcHandlers(ipc: IpcMain): void {
  // grpc:loadProto — parse a proto and list its services + methods.
  handleIpc(ipc, IPC.grpc.loadProto, async (_e: IpcMainInvokeEvent, src: ProtoSource): Promise<{ services: GrpcServiceInfo[] }> => {
    return { services: enumerateServices(loadPackage(src)) };
  });

  // grpc:invoke — call one method. Unary sends one message + a status; server
  // streaming sends many messages then a status. Both stream back over
  // IPC.grpc.message / IPC.grpc.status keyed by requestId.
  handleIpc(ipc, IPC.grpc.invoke, async (
    event: IpcMainInvokeEvent,
    requestId: string,
    opts: ProtoSource & {
      target: string
      serviceName: string
      methodName: string
      message: string
      metadata?: Record<string, string>
      plaintext?: boolean
    },
  ): Promise<void> => {
    // Supersede any previous call for this request.
    calls.get(requestId)?.cancel();
    calls.delete(requestId);

    const sendStatus = (status: string, extra: Record<string, unknown> = {}): void =>
      event.sender.send(IPC.grpc.status, { requestId, status, ...extra });
    const sendMessage = (data: unknown): void => {
      const message: GrpcMessage = {
        id: uuidv4(),
        direction: 'received',
        data: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
        timestamp: Date.now(),
      };
      event.sender.send(IPC.grpc.message, { requestId, message });
    };

    let pkgDef: protoLoader.PackageDefinition;
    let ServiceCtor: grpc.ServiceClientConstructor;
    let request: unknown;
    try {
      pkgDef = loadPackage(opts);
      const grpcObj = grpc.loadPackageDefinition(pkgDef);
      ServiceCtor = resolveService(grpcObj, opts.serviceName);
      request = opts.message.trim() ? JSON.parse(opts.message) : {};
    } catch (err) {
      sendStatus('error', { error: err instanceof Error ? err.message : String(err) });
      return;
    }

    // Find the method (proto names are kept as-is; match case-insensitively too).
    const serviceDef = ServiceCtor.service as Record<string, { requestStream: boolean; responseStream: boolean }>;
    const methodKey = Object.keys(serviceDef).find(k => k === opts.methodName)
      ?? Object.keys(serviceDef).find(k => k.toLowerCase() === opts.methodName.toLowerCase());
    if (!methodKey) {
      sendStatus('error', { error: `Method "${opts.methodName}" not found on ${opts.serviceName}.` });
      return;
    }
    const def = serviceDef[methodKey];

    if (def.requestStream) {
      // Client-streaming and bidi need an interactive send loop (a follow-up).
      sendStatus('error', { error: 'Client-streaming methods are not supported yet.' });
      return;
    }

    const creds = opts.plaintext
      ? grpc.credentials.createInsecure()
      : grpc.credentials.createSsl();
    const client = new ServiceCtor(normalizeTarget(opts.target), creds);

    const metadata = new grpc.Metadata();
    for (const [k, v] of Object.entries(opts.metadata ?? {})) metadata.set(k, v);

    // Map a gRPC status to a friendly code name for the UI.
    const statusName = (code: number): string =>
      Object.keys(grpc.status).find(k => (grpc.status as unknown as Record<string, number>)[k] === code) ?? String(code);

    const cleanup = (): void => { calls.delete(requestId); try { client.close(); } catch { /* ignore */ } };

    sendStatus('running');

    try {
      const method = (client as unknown as Record<string, (...a: unknown[]) => grpc.ClientUnaryCall | grpc.ClientReadableStream<unknown>>)[methodKey].bind(client);

      if (def.responseStream) {
        // Server streaming: many messages, then a status.
        const call = method(request, metadata) as grpc.ClientReadableStream<unknown>;
        calls.set(requestId, { cancel: () => call.cancel() });
        call.on('data', (d: unknown) => sendMessage(d));
        call.on('error', (e: grpc.ServiceError) => {
          sendStatus('error', { code: e.code, codeName: e.code !== undefined ? statusName(e.code) : undefined, error: e.details || e.message });
          cleanup();
        });
        call.on('status', (s: grpc.StatusObject) => {
          if (s.code === grpc.status.OK) sendStatus('completed', { code: s.code, codeName: statusName(s.code) });
          cleanup();
        });
      } else {
        // Unary: one message + a status.
        const call = method(request, metadata, (err: grpc.ServiceError | null, response: unknown) => {
          if (err) {
            sendStatus('error', { code: err.code, codeName: err.code !== undefined ? statusName(err.code) : undefined, error: err.details || err.message });
          } else {
            sendMessage(response);
            sendStatus('completed', { code: grpc.status.OK, codeName: 'OK' });
          }
          cleanup();
        }) as grpc.ClientUnaryCall;
        calls.set(requestId, { cancel: () => call.cancel() });
      }
    } catch (err) {
      sendStatus('error', { error: err instanceof Error ? err.message : String(err) });
      cleanup();
    }
  });

  // grpc:cancel — abort an in-flight call.
  handleIpc(ipc, IPC.grpc.cancel, async (_e: IpcMainInvokeEvent, requestId: string): Promise<void> => {
    calls.get(requestId)?.cancel();
    calls.delete(requestId);
  });
}
