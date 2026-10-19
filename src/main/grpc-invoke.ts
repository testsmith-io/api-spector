// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Headless unary gRPC caller for load testing. Loads the proto and opens one
// client, then does repeated unary calls over the same channel. Pure Node
// (@grpc/grpc-js is not a native addon), so it runs in the perf utilityProcess.
// Only unary methods are supported — streaming is a different load shape.

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const LOADER_OPTS: protoLoader.Options = { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true };

function resolveProtoFile(src: { protoSource?: string; protoPath?: string; importPaths?: string[] }): { file: string; includeDirs: string[] } {
  const importPaths = (src.importPaths ?? []).filter(Boolean);
  if (src.protoPath) return { file: src.protoPath, includeDirs: [path.dirname(src.protoPath), ...importPaths] };
  if (src.protoSource?.trim()) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apispector-proto-'));
    const file = path.join(dir, 'main.proto');
    fs.writeFileSync(file, src.protoSource, 'utf8');
    return { file, includeDirs: [dir, ...importPaths] };
  }
  throw new Error('No proto source: paste a .proto or provide a file path.');
}

function resolveService(grpcObj: grpc.GrpcObject, serviceName: string): grpc.ServiceClientConstructor {
  let node: unknown = grpcObj;
  for (const part of serviceName.split('.')) {
    node = (node as Record<string, unknown>)?.[part];
    if (!node) throw new Error(`Service "${serviceName}" not found in the proto.`);
  }
  if (typeof node !== 'function') throw new Error(`"${serviceName}" is not a service.`);
  return node as grpc.ServiceClientConstructor;
}

function normalizeTarget(url: string): string {
  return url.replace(/^[a-z0-9+.-]+:\/\//i, '').replace(/\/+$/, '');
}

function statusName(code: number): string {
  return Object.keys(grpc.status).find(k => (grpc.status as unknown as Record<string, number>)[k] === code) ?? String(code);
}

export interface GrpcInvokeConfig {
  target: string
  protoSource?: string
  protoPath?: string
  importPaths?: string[]
  serviceName: string
  methodName: string
  /** Request message as a JSON string. */
  message: string
  metadata?: Record<string, string>
  plaintext?: boolean
}

export interface GrpcCallResult { ok: boolean; code: number; codeName: string; bytes: number; error?: string }
export interface GrpcInvoker { invoke(): Promise<GrpcCallResult>; close(): void }

/** Build a reusable unary caller: loads the proto + opens the channel once. */
export function createGrpcInvoker(cfg: GrpcInvokeConfig): GrpcInvoker {
  const { file, includeDirs } = resolveProtoFile(cfg);
  const pkgDef = protoLoader.loadSync(file, { ...LOADER_OPTS, includeDirs });
  const grpcObj = grpc.loadPackageDefinition(pkgDef);
  const ServiceCtor = resolveService(grpcObj, cfg.serviceName);
  const serviceDef = ServiceCtor.service as Record<string, { requestStream: boolean; responseStream: boolean }>;
  const methodKey = Object.keys(serviceDef).find(k => k === cfg.methodName)
    ?? Object.keys(serviceDef).find(k => k.toLowerCase() === cfg.methodName.toLowerCase());
  if (!methodKey) throw new Error(`Method "${cfg.methodName}" not found on ${cfg.serviceName}.`);
  const def = serviceDef[methodKey];
  if (def.requestStream || def.responseStream) throw new Error('Only unary gRPC methods can be load tested.');

  const request = cfg.message?.trim() ? JSON.parse(cfg.message) : {};
  const creds = cfg.plaintext ? grpc.credentials.createInsecure() : grpc.credentials.createSsl();
  const client = new ServiceCtor(normalizeTarget(cfg.target), creds);
  const metadata = new grpc.Metadata();
  for (const [k, v] of Object.entries(cfg.metadata ?? {})) metadata.set(k, v);
  const method = (client as unknown as Record<string, (...a: unknown[]) => grpc.ClientUnaryCall>)[methodKey].bind(client);

  return {
    invoke() {
      return new Promise<GrpcCallResult>((resolve) => {
        try {
          method(request, metadata, (err: grpc.ServiceError | null, response: unknown) => {
            if (err) resolve({ ok: false, code: err.code ?? grpc.status.UNKNOWN, codeName: statusName(err.code ?? grpc.status.UNKNOWN), bytes: 0, error: err.details || err.message });
            else resolve({ ok: true, code: grpc.status.OK, codeName: 'OK', bytes: Buffer.byteLength(JSON.stringify(response ?? {}), 'utf8') });
          });
        } catch (e) {
          resolve({ ok: false, code: grpc.status.UNKNOWN, codeName: 'UNKNOWN', bytes: 0, error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
    close() { try { client.close(); } catch { /* ignore */ } },
  };
}
