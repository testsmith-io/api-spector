// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http';
import { randomUUID } from 'crypto';
import * as vm from 'vm';
import dayjs from 'dayjs';
import type { MockServer, MockRoute, MockHit } from '../shared/types';
import type { faker as FakerType } from '@faker-js/faker';

// ─── Faker (lazy-loaded) ──────────────────────────────────────────────────────

let _fakerCache: { faker: typeof FakerType } | null = null;
async function getFaker(): Promise<typeof FakerType> {
  if (!_fakerCache) _fakerCache = await import('@faker-js/faker');
  return _fakerCache.faker;
}

// ─── Global server state ──────────────────────────────────────────────────────

const running     = new Map<string, Server>();
const liveRoutes  = new Map<string, MockRoute[]>();  // mutable — survives route edits

let hitCallback: ((hit: MockHit) => void) | null = null;

export function setHitCallback(cb: ((hit: MockHit) => void) | null) {
  hitCallback = cb;
}

/** Call this whenever routes are saved while the server is running. */
export function updateMockRoutes(id: string, routes: MockRoute[]): void {
  liveRoutes.set(id, routes);
}

// ─── Path matching ────────────────────────────────────────────────────────────

function matchPath(pattern: string, urlPath: string): boolean {
  const regexStr = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:[^/]+/g, '[^/]+');
  try {
    const regex = new RegExp('^' + regexStr + '/?$');
    return regex.test(urlPath.split('?')[0]);
  } catch {
    return false;
  }
}

function findRoute(routes: MockRoute[], method: string, urlPath: string): MockRoute | null {
  const path = urlPath.split('?')[0];
  return (
    routes.find(r => r.method === method && matchPath(r.path, path)) ??
    routes.find(r => r.method === 'ANY'  && matchPath(r.path, path)) ??
    null
  );
}

// ─── Request utilities ────────────────────────────────────────────────────────

/** Extract :param values from a route pattern against an actual URL path. */
function extractPathParams(pattern: string, urlPath: string): Record<string, string> {
  const params: Record<string, string> = {};
  const patParts = pattern.split('/');
  const urlParts = urlPath.split('?')[0].split('/');
  patParts.forEach((part, i) => {
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(urlParts[i] ?? '');
    }
  });
  return params;
}

/** Parse query-string key/value pairs from a URL. */
function extractQueryParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const qs = url.split('?')[1];
  if (qs) new URLSearchParams(qs).forEach((v, k) => { params[k] = v; });
  return params;
}

/** Read entire request body as a string (resolves to '' on error). */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

// ─── Body interpolation ───────────────────────────────────────────────────────

/**
 * Expand {{expression}} tokens in a string using a vm context.
 * Supports faker expressions, dayjs expressions, and request.xxx access.
 */
function interpolateMockBody(body: string, context: Record<string, unknown>): string {
  return body.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const expr = key.trim();
    if (expr.includes('.') || expr.includes('(')) {
      try {
        const result = vm.runInNewContext(expr, context);
        if (result !== undefined && result !== null) return String(result);
      } catch {
        // Not a valid expression — leave token as-is
      }
    }
    return match;
  });
}

// ─── Response draft type ──────────────────────────────────────────────────────

interface ResponseDraft {
  statusCode: number
  body:       string
  headers:    Record<string, string>
}

// ─── Per-request handler ──────────────────────────────────────────────────────

async function handleRequest(
  serverId: string,
  req:      IncomingMessage,
  res:      ServerResponse,
  reqStart: number,
): Promise<void> {
  const method  = (req.method ?? 'GET').toUpperCase();
  const urlPath = req.url ?? '/';

  // Silently ignore browser-generated noise
  if (urlPath === '/favicon.ico') {
    res.writeHead(204); res.end(); return;
  }

  // Read request body before matching so scripts can inspect it
  const bodyRaw = await readBody(req);
  let bodyParsed: unknown = {};
  try { bodyParsed = JSON.parse(bodyRaw); } catch { /* not JSON */ }

  // Always read from liveRoutes so edits apply without restart
  const routes = liveRoutes.get(serverId) ?? [];
  const route  = findRoute(routes, method, urlPath);

  if (!route) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No matching mock route', method, path: urlPath }));
    hitCallback?.({
      id: randomUUID(), serverId, timestamp: reqStart,
      method, path: urlPath, matchedRouteId: null,
      status: 404, durationMs: Date.now() - reqStart,
    });
    return;
  }

  // Build request context accessible in scripts and {{...}} expressions
  const reqHeaders: Record<string, string> = {};
  Object.entries(req.headers).forEach(([k, v]) => {
    if (v !== undefined) reqHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
  });

  const requestCtx = {
    method,
    path:    urlPath.split('?')[0],
    params:  extractPathParams(route.path, urlPath),
    query:   extractQueryParams(urlPath),
    body:    bodyParsed,
    bodyRaw,
    headers: reqHeaders,
  };

  // Mutable response draft — scripts can modify it before send
  const responseDraft: ResponseDraft = {
    statusCode: route.statusCode,
    body:       route.body,
    headers:    { 'Content-Type': 'application/json', ...route.headers },
  };

  // Run optional pre-response script
  if (route.script?.trim()) {
    try {
      const faker = await getFaker();
      vm.runInNewContext(route.script, {
        request:  requestCtx,
        response: responseDraft,
        faker,
        dayjs,
        console: { log: (...args: unknown[]) => console.log('[mock-script]', ...args) },
      });
    } catch (err) {
      console.error('[mock-script error]', err);
    }
  }

  // Interpolate {{...}} in the response body
  const faker    = await getFaker();
  const exprCtx  = { request: requestCtx, faker, dayjs };
  const finalBody = interpolateMockBody(responseDraft.body, exprCtx);

  const respond = () => {
    res.writeHead(responseDraft.statusCode, responseDraft.headers);
    res.end(finalBody);
    hitCallback?.({
      id: randomUUID(), serverId, timestamp: reqStart,
      method, path: urlPath, matchedRouteId: route.id,
      status: responseDraft.statusCode, durationMs: Date.now() - reqStart,
    });
  };

  if (route.delay && route.delay > 0) setTimeout(respond, route.delay);
  else respond();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function startMock(server: MockServer): Promise<void> {
  if (running.has(server.id)) await stopMock(server.id);

  liveRoutes.set(server.id, server.routes ?? []);

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const reqStart = Date.now();
    handleRequest(server.id, req, res, reqStart).catch(err => {
      console.error('[mock-handler uncaught]', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Mock handler error', message: String(err) }));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(server.port, '127.0.0.1', resolve);
  });

  running.set(server.id, httpServer);
}

export async function stopMock(id: string): Promise<void> {
  const srv = running.get(id);
  if (!srv) return;
  await new Promise<void>((resolve, reject) =>
    srv.close(err => (err ? reject(err) : resolve()))
  );
  running.delete(id);
  liveRoutes.delete(id);
}

export function isRunning(id: string): boolean {
  return running.has(id);
}

export function getRunningIds(): string[] {
  return [...running.keys()];
}

export async function stopAll(): Promise<void> {
  await Promise.all([...running.keys()].map(stopMock));
}
