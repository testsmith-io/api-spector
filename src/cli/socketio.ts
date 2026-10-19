#!/usr/bin/env node
// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

/**
 * API Spector CLI — Socket.IO
 *
 * Connect to a Socket.IO server, emit events, and capture what comes back.
 * Useful in CI to smoke-test a realtime endpoint, or to script an emit/observe
 * exchange. Uses the same socket.io-client the desktop app uses.
 *
 * Usage:
 *   api-spector socketio --url <url> [options]
 *   api-spector socketio --workspace <path> --request <name> [options]
 *
 * Options:
 *   --url         <url>       Socket.IO server URL (e.g. https://example.com)
 *   --workspace   <path>      Take url/headers/namespace/auth from a saved request
 *   --request     <name>      Name of the Socket.IO request in the workspace
 *   --namespace   <ns>        Namespace, e.g. /admin (default: /)
 *   --auth        <json>      Handshake auth as JSON, e.g. '{"token":"abc"}'
 *   --path        <path>      Engine.IO path (default: /socket.io)
 *   --header      <k:v>       Handshake header (repeatable)
 *   --emit        <event[:json]>  Emit an event; JSON after the first ':' is the
 *                             argument(s), e.g. --emit 'chat:["hello"]' (repeatable)
 *   --ack                     Wait for an acknowledgement on each --emit
 *   --listen      <seconds>   Keep listening for events after emitting (default 5)
 *   --json                    Print the session as JSON instead of a log
 *   --help                    Show this message
 *
 * Exit code is non-zero when the connection fails.
 */

import { io, type Socket } from 'socket.io-client';
import type { Workspace, ApiRequest } from '../shared/types';
import { C, color, parseArgs, loadWorkspace, loadCollections } from './cli-common';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function printHelp(): void {
  console.log(`
  API Spector - Socket.IO

  api-spector socketio --url <url> [--namespace /ns] [--auth '{"token":"x"}']
                       [--header K:V] [--emit 'event:[args]'] [--ack]
                       [--listen <seconds>] [--json]
  api-spector socketio --workspace <path> --request <name> [same options]
`);
}

function jsonText(value: unknown): string {
  try { return JSON.stringify(value); } catch { return String(value); }
}

function targetUrl(url: string, namespace?: string): string {
  const ns = (namespace ?? '').trim();
  if (!ns || ns === '/') return url;
  return url.replace(/\/+$/, '') + (ns.startsWith('/') ? ns : `/${ns}`);
}

// Parse an --emit value "event:jsonArgs" into a name + argument list.
function parseEmit(spec: string): { event: string; args: unknown[] } {
  const i = spec.indexOf(':');
  if (i === -1) return { event: spec, args: [] };
  const event = spec.slice(0, i);
  const rest = spec.slice(i + 1).trim();
  if (!rest) return { event, args: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(rest); } catch { throw new Error(`--emit "${spec}": arguments after ':' must be JSON`); }
  return { event, args: Array.isArray(parsed) ? parsed : [parsed] };
}

async function sourceFromWorkspace(wsPath: string, name: string): Promise<{ url: string; headers: Record<string, string>; namespace?: string; auth?: string }> {
  const { workspace, dir } = await loadWorkspace(wsPath);
  const collections = await loadCollections(workspace as Workspace, dir);
  let found: ApiRequest | undefined;
  for (const col of collections) {
    for (const req of Object.values(col.requests)) {
      if (req.name === name) { found = req; break; }
    }
    if (found) break;
  }
  if (!found) throw new Error(`Request "${name}" not found in the workspace`);
  const headers: Record<string, string> = {};
  for (const h of found.headers ?? []) if (h.enabled && h.key) headers[h.key] = h.value;
  return { url: found.url, headers, namespace: found.socketio?.namespace, auth: found.socketio?.auth };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), ['emit', 'header']);
  if (args.help || args.h) { printHelp(); return; }

  // ── Resolve connection config ──
  let url = typeof args.url === 'string' ? args.url : '';
  let headers: Record<string, string> = {};
  let namespace = typeof args.namespace === 'string' ? args.namespace : undefined;
  let auth = typeof args.auth === 'string' ? args.auth : undefined;

  if (typeof args.workspace === 'string' && typeof args.request === 'string') {
    const src = await sourceFromWorkspace(args.workspace, args.request);
    url = url || src.url;
    headers = { ...src.headers };
    namespace = namespace ?? src.namespace;
    auth = auth ?? src.auth;
  }

  // CLI --header overrides/augments.
  const headerList = Array.isArray(args.header) ? args.header : typeof args.header === 'string' ? [args.header] : [];
  for (const h of headerList) {
    const idx = h.indexOf(':');
    if (idx > 0) headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
  }

  if (!url) {
    console.error(color('  [error] Provide --url, or --workspace with --request.', C.red));
    printHelp();
    process.exit(1);
  }

  let authObj: Record<string, unknown> | undefined;
  if (auth && auth.trim()) {
    try { authObj = JSON.parse(auth); }
    catch { console.error(color('  [error] --auth is not valid JSON', C.red)); process.exit(1); }
  }

  const emits = (Array.isArray(args.emit) ? args.emit : typeof args.emit === 'string' ? [args.emit] : []).map(parseEmit);
  const listenMs = Math.round((typeof args.listen === 'string' ? Number(args.listen) : 5) * 1000) || 5000;
  const asJson = Boolean(args.json);
  const ack = Boolean(args.ack);

  const received: { at: number; event: string; args: unknown[] }[] = [];
  const log = (s: string) => { if (!asJson) console.log(s); };

  if (!asJson) {
    console.log('');
    console.log(`  ${color('Socket.IO', C.bold)} ${color(targetUrl(url, namespace), C.dim)}`);
  }

  const socket: Socket = io(targetUrl(url, namespace), {
    path: typeof args.path === 'string' ? args.path : '/socket.io',
    transports: ['websocket', 'polling'],
    extraHeaders: headers,
    auth: authObj,
    forceNew: true,
    reconnection: false,
  });

  socket.onAny((event: string, ...a: unknown[]) => {
    received.push({ at: Date.now(), event, args: a });
    log(`  ${color('←', C.green)} ${color(event, C.bold)} ${color(jsonText(a), C.dim)}`);
  });

  await new Promise<void>((resolve, reject) => {
    socket.on('connect_error', (err: Error) => reject(err));
    socket.on('connect', async () => {
      log(`  ${color('connected', C.green)} ${color(`(id ${socket.id})`, C.dim)}`);
      for (const { event, args: emitArgs } of emits) {
        if (ack) {
          try {
            const resp = await socket.timeout(5000).emitWithAck(event, ...emitArgs);
            log(`  ${color('→', C.cyan)} ${color(event, C.bold)} ${color(jsonText(emitArgs), C.dim)}  ${color('ack', C.green)} ${color(jsonText(resp), C.dim)}`);
          } catch {
            log(`  ${color('→', C.cyan)} ${color(event, C.bold)} ${color(jsonText(emitArgs), C.dim)}  ${color('(no ack)', C.yellow)}`);
          }
        } else {
          socket.emit(event, ...emitArgs);
          log(`  ${color('→', C.cyan)} ${color(event, C.bold)} ${color(jsonText(emitArgs), C.dim)}`);
        }
      }
      if (listenMs > 0) {
        log(color(`  listening for ${listenMs / 1000}s…`, C.dim));
        await sleep(listenMs);
      }
      resolve();
    });
  }).catch((err: Error) => {
    socket.close();
    if (asJson) console.log(JSON.stringify({ url, namespace: namespace ?? '/', connected: false, error: err.message }, null, 2));
    else console.error(color(`  [error] Connection failed: ${err.message}`, C.red));
    process.exit(1);
  });

  socket.disconnect();

  if (asJson) {
    console.log(JSON.stringify({
      url, namespace: namespace ?? '/', connected: true,
      emitted: emits.map(e => ({ event: e.event, args: e.args })),
      received: received.map(r => ({ event: r.event, args: r.args })),
    }, null, 2));
  } else {
    console.log('');
    console.log(`  ${color(String(received.length), C.bold)} event(s) received, ${emits.length} emitted.`);
    console.log('');
  }
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(color(`  [error] ${err instanceof Error ? err.message : String(err)}`, C.red));
  process.exit(1);
});
