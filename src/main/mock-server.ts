// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import * as vm from 'node:vm';
import dayjs from 'dayjs';
import { fetch, Headers } from 'undici';
import { DOMParser } from '@xmldom/xmldom';
import type { MockServer, MockRoute, MockHit, MockFault } from '../shared/types';
import type { faker as FakerType } from '@faker-js/faker';

// Hop-by-hop headers, not forwarded to or relayed from the proxy upstream.
const HOP_BY_HOP = new Set([
  'host', 'connection', 'keep-alive', 'proxy-connection',
  'transfer-encoding', 'te', 'trailer', 'upgrade',
]);
// Also dropped from the upstream response: content-encoding (fetch already
// decoded) and content-length (we recompute it).
const STRIP_FROM_PROXY_RESPONSE = new Set([
  ...HOP_BY_HOP, 'content-encoding', 'content-length',
]);
const PROXY_TIMEOUT_MS = 30_000;

// Faker (lazy-loaded)

let _fakerCache: { faker: typeof FakerType } | null = null;
async function getFaker(): Promise<typeof FakerType> {
  _fakerCache ??= await import('@faker-js/faker');
  return _fakerCache.faker;
}

// Global server state

const running     = new Map<string, Server>();
const liveRoutes  = new Map<string, MockRoute[]>();  // mutable - survives route edits
const liveProxy   = new Map<string, string>();       // serverId -> proxy base URL for unmatched requests
// serverId -> (scenario -> state). Survives route edits; reset on (re)start.
const scenarioState = new Map<string, Map<string, string>>();

export const DEFAULT_SCENARIO_STATE = 'Started';

let hitCallback: ((hit: MockHit) => void) | null = null;

export function setHitCallback(cb: ((hit: MockHit) => void) | null) {
  hitCallback = cb;
}

/** Call this whenever routes are saved while the server is running. */
export function updateMockRoutes(id: string, routes: MockRoute[]): void {
  liveRoutes.set(id, routes);
}

/** Set, or clear with a blank value, the proxy base URL for unmatched requests. */
export function setMockProxy(id: string, baseUrl: string | null | undefined): void {
  const trimmed = baseUrl?.trim().replace(/\/+$/, '');
  if (trimmed) liveProxy.set(id, trimmed);
  else liveProxy.delete(id);
}

// Path matching

function matchPath(pattern: string, urlPath: string): boolean {
  const regexStr = pattern
    .replaceAll(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll(/:[^/]+/g, '[^/]+');
  try {
    const regex = new RegExp('^' + regexStr + '/?$');
    return regex.test(urlPath.split('?')[0]);
  } catch {
    return false;
  }
}

export function findRoute(routes: MockRoute[], method: string, urlPath: string): MockRoute | null {
  const path = urlPath.split('?')[0];
  return (
    routes.find(r => r.method === method && matchPath(r.path, path)) ??
    routes.find(r => r.method === 'ANY'  && matchPath(r.path, path)) ??
    null
  );
}

// Scenarios (stateful behavior)

/** A scenario's current state, defaulting to "Started". */
export function scenarioStateOf(serverId: string, scenario: string): string {
  return scenarioState.get(serverId)?.get(scenario) ?? DEFAULT_SCENARIO_STATE;
}

function setScenarioState(serverId: string, scenario: string, state: string): void {
  let states = scenarioState.get(serverId);
  if (!states) { states = new Map(); scenarioState.set(serverId, states); }
  states.set(scenario, state);
}

/** Rewind every scenario on a server to "Started" (the UI's Reset state button). */
export function resetScenarios(serverId: string): void {
  scenarioState.delete(serverId);
}

/** A route with no scenario always matches; otherwise its requiredState must
 *  equal the scenario's current state. */
function scenarioEligible(serverId: string, route: MockRoute): boolean {
  if (!route.scenario) return true;
  const required = route.requiredState ?? DEFAULT_SCENARIO_STATE;
  return scenarioStateOf(serverId, route.scenario) === required;
}

/** findRoute, but scenario-aware: skips routes whose scenario isn't in the
 *  required state, so several stubs can share a path and answer in sequence. */
function selectRoute(serverId: string, routes: MockRoute[], method: string, urlPath: string): MockRoute | null {
  const path = urlPath.split('?')[0];
  return (
    routes.find(r => r.method === method && matchPath(r.path, path) && scenarioEligible(serverId, r)) ??
    routes.find(r => r.method === 'ANY'  && matchPath(r.path, path) && scenarioEligible(serverId, r)) ??
    null
  );
}

// Protocol-level fault injection

/** Break the connection at the socket level instead of answering normally. */
function injectFault(fault: MockFault, res: ServerResponse): void {
  const socket = res.socket;
  if (!socket) return;
  switch (fault) {
    case 'EMPTY_RESPONSE':
      socket.destroy();
      break;
    case 'CONNECTION_RESET_BY_PEER':
      // RST, not EOF. resetAndDestroy is Node >= 16.17/18.3.
      if (typeof socket.resetAndDestroy === 'function') socket.resetAndDestroy();
      else socket.destroy();
      break;
    case 'MALFORMED_RESPONSE_CHUNK':
      // Valid status line, then a chunked body of garbage.
      socket.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n');
      socket.write(randomBytes(32));
      socket.destroy();
      break;
    case 'RANDOM_DATA_THEN_CLOSE':
      socket.write(randomBytes(32));
      socket.destroy();
      break;
  }
}

// Request utilities

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

// XML body parsing

/** Minimal subset of the @xmldom/xmldom node shape we walk. */
interface XmlNode {
  nodeType:   number
  nodeName:   string
  nodeValue:  string | null
  childNodes: { length: number; [i: number]: XmlNode }
  attributes: { length: number; [i: number]: { nodeName: string; nodeValue: string | null } } | null
}

const ELEMENT_NODE = 1, TEXT_NODE = 3, CDATA_NODE = 4;

/**
 * XML element -> plain JS value so `request.body.x` works like JSON:
 *   - leaf (text only)        -> trimmed text string
 *   - children/attrs          -> object keyed by child tag name
 *   - repeated child tags     -> array
 *   - attributes              -> `@name` keys
 *   - mixed text + children   -> text under `#text`
 * Namespaced tags keep their prefix; access via bracket notation in templates.
 */
function elementToValue(el: XmlNode): unknown {
  const obj: Record<string, unknown> = {};

  if (el.attributes) {
    for (const a of Array.from(el.attributes)) {
      obj['@' + a.nodeName] = a.nodeValue ?? '';
    }
  }

  let text = '';
  const childEls: XmlNode[] = [];
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === ELEMENT_NODE) childEls.push(c);
    else if (c.nodeType === TEXT_NODE || c.nodeType === CDATA_NODE) text += c.nodeValue ?? '';
  }

  for (const child of childEls) {
    const name = child.nodeName;
    const val  = elementToValue(child);
    const existing = obj[name];
    if (existing === undefined) obj[name] = val;
    else if (Array.isArray(existing)) existing.push(val);
    else obj[name] = [existing, val];
  }

  const trimmed = text.trim();
  // Pure leaf: no children and no attributes -> just the text.
  if (childEls.length === 0 && Object.keys(obj).length === 0) return trimmed;
  if (trimmed) obj['#text'] = trimmed;
  return obj;
}

/** Parse an XML string into a plain object, or null if it isn't valid XML. */
function parseXmlToObject(xml: string): Record<string, unknown> | null {
  try {
    const silent = { warning() {}, error() {}, fatalError() {} };
    const doc = new DOMParser({ errorHandler: silent })
      .parseFromString(xml, 'text/xml') as unknown as { documentElement: XmlNode | null };
    const root = doc.documentElement;
    if (root?.nodeType !== ELEMENT_NODE) return null;
    return { [root.nodeName]: elementToValue(root) };
  } catch {
    return null;
  }
}

/** Parse a request body for `request.body`: JSON first, then XML (by content-type or
 *  leading `<`), else `{}`. */
function parseRequestBody(bodyRaw: string, contentType: string): unknown {
  try {
    return JSON.parse(bodyRaw);
  } catch { /* not JSON - fall through */ }

  const ct = contentType.toLowerCase();
  if (ct.includes('xml') || bodyRaw.trimStart().startsWith('<')) {
    const xmlObj = parseXmlToObject(bodyRaw);
    if (xmlObj) return xmlObj;
  }

  return {};
}

// Body interpolation

/** Expand {{expression}} tokens via a vm context (faker, dayjs, request.xxx). */
function interpolateMockBody(body: string, context: Record<string, unknown>): string {
  return body.replaceAll(/\{\{([^}]+)\}\}/g, (match, key) => {
    const expr = key.trim();
    if (expr.includes('.') || expr.includes('(')) {
      try {
        const result = vm.runInNewContext(expr, context);
        if (result !== undefined && result !== null) return String(result);
      } catch {
        // Not a valid expression - leave token as-is
      }
    }
    return match;
  });
}

// Response draft type

interface ResponseDraft {
  statusCode: number
  body:       string
  headers:    Record<string, string>
}

// Passthrough proxy

/** Forward an unmatched request to the upstream and relay its response. Strips
 *  hop-by-hop headers both ways, rewrites Host, relays redirects (no follow), and
 *  returns 502 on error/timeout. Logs the hit with `proxied: true`. */
async function proxyToUpstream(
  serverId: string,
  upstream:  string,
  method:    string,
  urlPath:   string,
  req:       IncomingMessage,
  bodyRaw:   string,
  res:       ServerResponse,
  reqStart:  number,
): Promise<void> {
  const targetUrl = `${upstream}${urlPath.startsWith('/') ? urlPath : '/' + urlPath}`;

  const forwardHeaders = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    forwardHeaders.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  try { forwardHeaders.set('host', new URL(upstream).host); } catch { /* not an absolute URL */ }

  let upstreamResp: Awaited<ReturnType<typeof fetch>>;
  let respBuf: Buffer;
  let timedOut = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); timedOut = true; }, PROXY_TIMEOUT_MS);
    upstreamResp = await fetch(targetUrl, {
      method,
      headers:  forwardHeaders,
      body:     method === 'GET' || method === 'HEAD' ? undefined : bodyRaw,
      signal:   controller.signal,
      redirect: 'manual',
    } as Parameters<typeof fetch>[1]);
    clearTimeout(timer);
    respBuf = Buffer.from(await upstreamResp.arrayBuffer());
  } catch (err) {
    const msg = timedOut
      ? `Upstream timed out after ${PROXY_TIMEOUT_MS}ms`
      : `Upstream proxy error: ${err instanceof Error ? err.message : String(err)}`;
    const body = JSON.stringify({ error: msg, upstream: targetUrl });
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    res.end(body);
    hitCallback?.({
      id: randomUUID(), serverId, timestamp: reqStart,
      method, path: urlPath, matchedRouteId: null, proxied: true,
      status: 502, durationMs: Date.now() - reqStart,
      responseBody: body, responseHeaders: { 'Content-Type': 'application/json' },
    });
    return;
  }

  const outHeaders: Record<string, string> = {};
  upstreamResp.headers.forEach((v, k) => {
    if (!STRIP_FROM_PROXY_RESPONSE.has(k.toLowerCase())) outHeaders[k] = v;
  });
  outHeaders['content-length'] = String(respBuf.length);
  outHeaders['x-served-by']    = 'api-spector-mock-proxy';

  res.writeHead(upstreamResp.status, outHeaders);
  res.end(respBuf);

  hitCallback?.({
    id: randomUUID(), serverId, timestamp: reqStart,
    method, path: urlPath, matchedRouteId: null, proxied: true,
    status: upstreamResp.status, durationMs: Date.now() - reqStart,
    responseBody: respBuf.toString('utf8'),
    responseHeaders: outHeaders,
  });
}

// Per-request handler

export async function handleRequest(
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

  // Read request body before matching so scripts can inspect it.
  // Parses JSON or XML into `request.body`; raw string stays in `request.bodyRaw`.
  const bodyRaw    = await readBody(req);
  const bodyParsed = parseRequestBody(bodyRaw, req.headers['content-type'] ?? '');

  // Always read from liveRoutes so edits apply without restart
  const routes = liveRoutes.get(serverId) ?? [];
  const route  = selectRoute(serverId, routes, method, urlPath);

  if (!route) {
    // No match: proxy to the upstream if one is set, else 404.
    const upstream = liveProxy.get(serverId);
    if (upstream) {
      await proxyToUpstream(serverId, upstream, method, urlPath, req, bodyRaw, res, reqStart);
      return;
    }

    const notFoundBody = JSON.stringify({ error: 'No matching mock route', method, path: urlPath });
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(notFoundBody);
    hitCallback?.({
      id: randomUUID(), serverId, timestamp: reqStart,
      method, path: urlPath, matchedRouteId: null,
      status: 404, durationMs: Date.now() - reqStart,
      responseBody: notFoundBody,
      responseHeaders: { 'Content-Type': 'application/json' },
    });
    return;
  }

  // Advance the scenario on match, so delayed/faulted responses still transition.
  if (route.scenario && route.newState) {
    setScenarioState(serverId, route.scenario, route.newState);
  }

  // A fault replaces the response (after any delay).
  if (route.fault) {
    const fault = route.fault;
    const fire = () => {
      injectFault(fault, res);
      hitCallback?.({
        id: randomUUID(), serverId, timestamp: reqStart,
        method, path: urlPath, matchedRouteId: route.id, fault,
        status: 0, durationMs: Date.now() - reqStart,
      });
    };
    if (route.delay && route.delay > 0) setTimeout(fire, route.delay);
    else fire();
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

  // Mutable response draft - scripts can modify it before send
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
        // Free-form per-route data the importer/user can stash. Frozen so a script
        // can't mutate it across calls.
        metadata: route.metadata ? Object.freeze({ ...route.metadata }) : {},
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
      responseBody: finalBody,
      responseHeaders: responseDraft.headers,
    });
  };

  if (route.delay && route.delay > 0) setTimeout(respond, route.delay);
  else respond();
}

// Public API

export async function startMock(server: MockServer): Promise<void> {
  if (running.has(server.id)) await stopMock(server.id);

  liveRoutes.set(server.id, server.routes ?? []);
  setMockProxy(server.id, server.proxyBaseUrl);
  resetScenarios(server.id);

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
  liveProxy.delete(id);
  scenarioState.delete(id);
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
