// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

/**
 * Shared request-execution core.
 *
 * The single-send IPC handler (`request-handler.ts`), the GUI batch runner
 * (`runner-handler.ts`) and the CLI runner (`cli/runner.ts`) all execute the
 * same request lifecycle: auth → body build → fetch (with NTLM/digest
 * handshakes) → tests → post-script → status. This module is the one
 * implementation they share, so the three entry points cannot drift apart
 * (the CLI used to support only bearer auth because its copy fell behind).
 */

import { fetch, Headers, ProxyAgent, Agent } from 'undici';
import { readFile } from 'fs/promises';
import * as nodeTls from 'tls';
import type {
  ApiRequest,
  SendRequestPayload,
  SentRequest,
  TestResult,
  RunStatus,
  RunnerItem,
  RunRequestResult,
  StreamEvent,
  StreamClose,
} from '../shared/types';
import { detectStreamKind, readStream } from './stream/parse';
import { interpolate, buildUrl, mergeVars, buildDynamicVars } from './interpolation';
import { runScript } from './script-runner';
import { patchGlobals, persistGlobals } from './globals-store';
import {
  buildAuthHeaders,
  buildApiKeyParam,
  performDigestAuth,
  performNtlmRequest,
  fetchOAuth2Token,
} from './auth-builder';
import { buildProxyUri } from './proxy-utils';
import Ajv from 'ajv';

export type ProxyConfig = NonNullable<SendRequestPayload['proxy']>;
export type TlsConfig = NonNullable<SendRequestPayload['tls']>;

type SystemCertificateTlsApi = {
  getCACertificates?: (type: 'default' | 'system') => string[]
  setDefaultCACertificates?: (certs: string[]) => void
}

let systemCertificateStoreApplied = false;

/**
 * Node does not use the Windows root store by default. Local TLS-intercepting
 * proxies usually install their CA there, so merge it into this process while
 * keeping normal certificate verification enabled.
 */
export function trustSystemCertificateStore(options: {
  platform?: NodeJS.Platform | string
  tlsApi?: SystemCertificateTlsApi
  force?: boolean
} = {}): boolean {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return false;
  if (systemCertificateStoreApplied && !options.force) return false;

  const tlsApi = options.tlsApi ?? nodeTls;
  if (
    typeof tlsApi.getCACertificates !== 'function' ||
    typeof tlsApi.setDefaultCACertificates !== 'function'
  ) {
    return false;
  }

  try {
    const defaultCerts = tlsApi.getCACertificates('default');
    const systemCerts = tlsApi.getCACertificates('system');
    const combinedCerts = Array.from(new Set([...defaultCerts, ...systemCerts]));

    if (!systemCerts.length || combinedCerts.length === defaultCerts.length) {
      systemCertificateStoreApplied = true;
      return false;
    }

    tlsApi.setDefaultCACertificates(combinedCerts);
    systemCertificateStoreApplied = true;
    return true;
  } catch {
    return false;
  }
}

// ─── PII masking ──────────────────────────────────────────────────────────────

/**
 * Replace values of matching JSON fields and matching header names with
 * `[REDACTED]`.  `patterns` is a list of field/header name substrings to
 * match (case-insensitive).
 */
export function maskPii(data: string, patterns: string[]): string {
  if (!patterns.length) return data;
  try {
    const obj = JSON.parse(data);
    const masked = maskObject(obj, patterns);
    return JSON.stringify(masked);
  } catch {
    // Not JSON — return as-is (raw masking of non-JSON is out of scope)
    return data;
  }
}

function maskObject(obj: unknown, patterns: string[]): unknown {
  if (Array.isArray(obj)) return obj.map(item => maskObject(item, patterns));
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (patterns.some(p => k.toLowerCase().includes(p.toLowerCase()))) {
        result[k] = '[REDACTED]';
      } else {
        result[k] = maskObject(v, patterns);
      }
    }
    return result;
  }
  return obj;
}

export function maskHeaders(headers: Record<string, string>, patterns: string[]): Record<string, string> {
  if (!patterns.length) return headers;
  // Always mask Authorization regardless of patterns
  const alwaysMask = ['authorization', 'cookie', 'set-cookie'];
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (alwaysMask.includes(lower) || patterns.some(p => lower.includes(p.toLowerCase()))) {
      result[k] = '[REDACTED]';
    } else {
      result[k] = v;
    }
  }
  return result;
}

// ─── Schema → TestResult adapter ──────────────────────────────────────────────

const schemaAjv = new Ajv({ allErrors: true, strict: false });

/**
 * Validate the response body against the request's standalone JSON Schema
 * (if any) and convert the result into TestResults so it shows up next to
 * post-script tests in the runner output.
 *
 * Independent of `request.contract` — this is the field edited in the
 * Schema tab.
 */
export function buildSchemaTestResults(
  schemaText: string | undefined,
  body: string,
): TestResult[] {
  const trimmed = schemaText?.trim();
  if (!trimmed) return [];

  let schema: unknown;
  try {
    schema = JSON.parse(trimmed);
  } catch {
    return [{
      name:   '[schema] body matches schema',
      passed: false,
      error:  'Schema is not valid JSON',
    }];
  }

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return [{
      name:   '[schema] body matches schema',
      passed: false,
      error:  'Response body is not valid JSON - cannot validate against schema',
    }];
  }

  let validate;
  try {
    validate = schemaAjv.compile(schema as object);
  } catch (e) {
    return [{
      name:   '[schema] body matches schema',
      passed: false,
      error:  `Schema compile error: ${e instanceof Error ? e.message : String(e)}`,
    }];
  }

  if (validate(data)) {
    return [{ name: '[schema] body matches schema', passed: true }];
  }
  return (validate.errors ?? []).map(err => ({
    name:   `[schema] body${err.instancePath ? ` at ${err.instancePath}` : ''}`,
    passed: false,
    error:  err.message ?? 'Schema violation',
  }));
}

// ─── Protocol-level "did the call succeed" tests ─────────────────────────────
//
// REST requests with no user-defined assertions stay 'skipped' — the runner
// nudges the user to write an explicit check. SOAP and GraphQL are different:
// HTTP 200 alone doesn't mean success (a SOAP service can return a Fault,
// GraphQL can return a populated `errors` array), so we add a synthetic
// pass/fail check based on the response shape. That promotes those requests
// from 'skipped' to 'passed'/'failed' automatically.

/** Returns synthetic test results for SOAP / GraphQL requests so the runner
 *  can mark them passed (no fault / no errors) or failed (fault / errors)
 *  without requiring a hand-written post-script. Returns `[]` for other body
 *  modes — REST keeps the existing "no tests = skipped" semantics. */
export function buildProtocolFaultTests(
  bodyMode: string | undefined,
  body: string,
): TestResult[] {
  if (!body) return [];

  if (bodyMode === 'soap') {
    // SOAP 1.1 fault element name: `Fault`. SOAP 1.2 same (different ns).
    // Match `<…:Fault` or `<Fault` (some servers omit the ns prefix on the
    // root response). Case-insensitive to cover non-standard servers.
    const isFault = /<(?:[\w-]+:)?Fault(?:\s|>)/i.test(body);
    if (isFault) {
      // Best-effort: extract the faultstring / Reason text for the error msg.
      const reason = /<(?:[\w-]+:)?(?:faultstring|Text)[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?(?:faultstring|Text)>/i.exec(body);
      return [{
        name:   '[soap] response is not a Fault',
        passed: false,
        error:  reason?.[1]?.trim() ?? 'SOAP Fault returned',
      }];
    }
    return [{ name: '[soap] response is not a Fault', passed: true }];
  }

  if (bodyMode === 'graphql') {
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { return []; } // not valid JSON, can't tell
    const errors = (parsed as { errors?: unknown })?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0] as { message?: string };
      return [{
        name:   '[graphql] response has no errors',
        passed: false,
        error:  first?.message ?? 'GraphQL response contained an `errors` array',
      }];
    }
    return [{ name: '[graphql] response has no errors', passed: true }];
  }

  return [];
}

// ─── Defensive defaults ───────────────────────────────────────────────────────

/** AI-generated collections may omit empty arrays — normalize in place. */
export function applyRequestDefaults(req: ApiRequest): void {
  if (!req.headers) req.headers = [];
  if (!req.params) req.params = [];
  if (!req.body) req.body = { mode: 'none' };
  if (!req.auth) req.auth = { type: 'none' };
}

// ─── Build undici dispatcher (proxy + TLS) ────────────────────────────────────

// A shared HTTP/2-capable dispatcher for plain requests, so we don't build an
// Agent per send. `allowH2` negotiates h2 via ALPN and transparently falls back
// to HTTP/1.1 for servers that don't offer it — matching what a browser does.
// This matters for streaming: some servers (and CDNs) only flush a response
// body incrementally over HTTP/2; over HTTP/1.1 Node's TLS stack coalesces the
// frames and an SSE/NDJSON stream arrives all at once at the end.
let _defaultAgent: Agent | undefined;
function defaultAgent(): Agent {
  if (!_defaultAgent) _defaultAgent = new Agent({ allowH2: true } as ConstructorParameters<typeof Agent>[0]);
  return _defaultAgent;
}

export async function buildDispatcher(
  proxy?: ProxyConfig,
  tls?: TlsConfig,
): Promise<ProxyAgent | Agent | undefined> {
  if (proxy?.url?.trim()) trustSystemCertificateStore();

  const connectOpts: Record<string, unknown> = {};
  let hasTls = false;

  if (tls) {
    hasTls = true;
    if (tls.rejectUnauthorized !== undefined) {
      connectOpts['rejectUnauthorized'] = tls.rejectUnauthorized;
    }
    if (tls.caCertPath) {
      try { connectOpts['ca'] = await readFile(tls.caCertPath); } catch { /* ignore missing */ }
    }
    if (tls.clientCertPath) {
      try { connectOpts['cert'] = await readFile(tls.clientCertPath); } catch { /* ignore missing */ }
    }
    if (tls.clientKeyPath) {
      try { connectOpts['key'] = await readFile(tls.clientKeyPath); } catch { /* ignore missing */ }
    }
  }

  if (proxy?.url?.trim()) {
    return new ProxyAgent({
      uri: buildProxyUri({ url: proxy.url, auth: proxy.auth }),
      requestTls: hasTls ? connectOpts : undefined,
      proxyTls: hasTls ? connectOpts : undefined,
      allowH2: true,
    } as ConstructorParameters<typeof ProxyAgent>[0]);
  }

  if (hasTls) {
    return new Agent({ connect: connectOpts, allowH2: true } as ConstructorParameters<typeof Agent>[0]);
  }

  return defaultAgent();
}

// ─── Body serialization ───────────────────────────────────────────────────────

/**
 * Serialize the request body for the current mode and apply the Content-Type /
 * SOAPAction defaults onto `headers` (only when the user did not set them).
 */
export function buildBodyAndApplyHeaders(
  req: ApiRequest,
  vars: Record<string, string>,
  headers: Headers,
): string | undefined {
  let body: string | undefined;

  if (req.body.mode === 'json' && req.body.json) {
    body = interpolate(req.body.json, vars);
    if (!headers.has('content-type')) headers.set('Content-Type', 'application/json');
  } else if (req.body.mode === 'form' && req.body.form) {
    body = req.body.form
      .filter(p => p.enabled && p.key)
      .map(p => `${encodeURIComponent(interpolate(p.key, vars))}=${encodeURIComponent(interpolate(p.value, vars))}`)
      .join('&');
    if (!headers.has('content-type')) headers.set('Content-Type', 'application/x-www-form-urlencoded');
  } else if (req.body.mode === 'raw' && req.body.raw) {
    body = interpolate(req.body.raw, vars);
    if (!headers.has('content-type')) headers.set('Content-Type', req.body.rawContentType ?? 'text/plain');
  } else if (req.body.mode === 'graphql' && req.body.graphql) {
    const gql = req.body.graphql;
    const gqlBody: Record<string, unknown> = { query: interpolate(gql.query, vars) };
    const rawVars = gql.variables?.trim();
    if (rawVars) {
      try { gqlBody.variables = JSON.parse(interpolate(rawVars, vars)); } catch { /* keep out */ }
    }
    if (gql.operationName?.trim()) gqlBody.operationName = gql.operationName.trim();
    body = JSON.stringify(gqlBody);
    if (!headers.has('content-type')) headers.set('Content-Type', 'application/json');
  } else if (req.body.mode === 'soap' && req.body.soap) {
    body = interpolate(req.body.soap.envelope, vars);
    if (!headers.has('content-type')) headers.set('Content-Type', 'text/xml; charset=utf-8');
    if (req.body.soap.soapAction && !headers.has('soapaction')) {
      headers.set('SOAPAction', req.body.soap.soapAction);
    }
  }

  return body;
}

// ─── HTTP exchange (auth handshakes included) ─────────────────────────────────

export interface ExchangeOptions {
  req: ApiRequest
  vars: Record<string, string>
  resolvedUrl: string
  dispatcher: ProxyAgent | Agent | undefined
  proxy?: ProxyConfig
  tls?: TlsConfig
  /** Called with the outgoing request snapshot just before dispatch, so the
   *  caller still has it when the fetch itself throws. */
  onSent?: (sent: SentRequest) => void
  /** Called for each frame of a streamed response, as it arrives. */
  onStreamEvent?: (ev: StreamEvent) => void
  /** Aborts an in-flight streamed read (the Stop button). */
  signal?: AbortSignal
  /** Force the streamed read path regardless of Content-Type. */
  forceStream?: boolean
}

export interface ExchangeResult {
  status: number
  statusText: string
  /** Response headers, unmasked. */
  rawHeaders: Record<string, string>
  /** Response body, unmasked. For a stream this is the full concatenation. */
  responseBody: string
  durationMs: number
  sentHeaders: Record<string, string>
  sentBody?: string
  /** resolvedUrl plus any apikey query param. */
  finalUrl: string
  /** Set when the body was consumed as a stream. */
  streamed?: boolean
  events?: StreamEvent[]
  streamClose?: StreamClose
  firstEventMs?: number
}

/**
 * Perform one HTTP exchange: OAuth2 token refresh, auth headers, api-key query
 * param, body serialization, and the NTLM / digest handshakes when needed.
 * Throws on transport failure — error shaping stays with the caller.
 */
export async function performHttpExchange(opts: ExchangeOptions): Promise<ExchangeResult> {
  const { req, vars, resolvedUrl, dispatcher, proxy, tls, onSent } = opts;
  const start = Date.now();

  // OAuth2: ensure a fresh token before building headers
  if (req.auth.type === 'oauth2') {
    const now = Date.now();
    const tokenMissing = !req.auth.oauth2CachedToken;
    const tokenExpired = req.auth.oauth2TokenExpiry ? req.auth.oauth2TokenExpiry <= now + 5000 : true;
    if (tokenMissing || tokenExpired) {
      const result = await fetchOAuth2Token(req.auth, vars);
      req.auth.oauth2CachedToken = result.accessToken;
      req.auth.oauth2TokenExpiry = result.expiresAt;
    }
  }

  const authHeaders = await buildAuthHeaders(req.auth, vars);
  const apiKeyParam = await buildApiKeyParam(req.auth, vars);

  let finalUrl = resolvedUrl;
  if (apiKeyParam) {
    const sep = finalUrl.includes('?') ? '&' : '?';
    finalUrl += `${sep}${encodeURIComponent(apiKeyParam.key)}=${encodeURIComponent(apiKeyParam.value)}`;
  }

  const headers = new Headers();
  for (const h of req.headers) {
    if (h.enabled && h.key) headers.set(interpolate(h.key, vars), interpolate(h.value, vars));
  }
  for (const [k, v] of Object.entries(authHeaders)) headers.set(k, v);

  const body = buildBodyAndApplyHeaders(req, vars, headers);
  const methodHasBody = !['GET', 'HEAD'].includes(req.method);
  const effectiveBody = methodHasBody ? body : undefined;

  const captureSent = (h: Headers): Record<string, string> => {
    const captured: Record<string, string> = {};
    h.forEach((value, key) => { captured[key] = value; });
    onSent?.({ method: req.method, url: finalUrl, headers: captured, body: effectiveBody });
    return captured;
  };

  const doFetch = (h: Headers): ReturnType<typeof fetch> => fetch(finalUrl, {
    method: req.method,
    headers: h,
    body: effectiveBody,
    dispatcher: dispatcher as Parameters<typeof fetch>[1] extends { dispatcher?: infer D } ? D : never,
  } as Parameters<typeof fetch>[1]);

  let sentHeaders: Record<string, string>;
  let fetchResp: Awaited<ReturnType<typeof fetch>>;

  // NTLM 3-message handshake over one keep-alive connection
  if (req.auth.type === 'ntlm') {
    sentHeaders = captureSent(headers);
    fetchResp = await performNtlmRequest({
      url: finalUrl,
      method: req.method,
      auth: req.auth,
      vars,
      baseHeaders: sentHeaders,
      body: effectiveBody,
      tls,
      proxy,
    }) as unknown as Awaited<ReturnType<typeof fetch>>;
  }
  // Digest two-round-trip
  else if (req.auth.type === 'digest') {
    const probeFetch = (url: string, init: Record<string, unknown>) => fetch(url, {
      ...(init as object),
      dispatcher: dispatcher as Parameters<typeof fetch>[1] extends { dispatcher?: infer D } ? D : never,
    } as Parameters<typeof fetch>[1]);

    const digestHeader = await performDigestAuth(finalUrl, req.method, req.auth, vars, probeFetch);
    if (digestHeader) headers.set('Authorization', digestHeader);
    sentHeaders = captureSent(headers);
    fetchResp = await doFetch(headers);
  }
  // Normal
  else {
    sentHeaders = captureSent(headers);
    fetchResp = await doFetch(headers);
  }

  const rawHeaders: Record<string, string> = {};
  fetchResp.headers.forEach((value, key) => { rawHeaders[key] = value; });

  // Stream the body when the Content-Type is an event/line format (or the
  // request forced it) AND the transport gave us a real ReadableStream. The
  // NTLM path returns a non-standard response, so it falls back to buffering.
  const kind = detectStreamKind(rawHeaders['content-type'], opts.forceStream);
  const bodyStream = fetchResp.body as ReadableStream<Uint8Array> | null;
  const canStream = kind !== null && bodyStream !== null && typeof bodyStream.getReader === 'function';

  let responseBody: string;
  let streamFields: Pick<ExchangeResult, 'streamed' | 'events' | 'streamClose' | 'firstEventMs'> = {};

  if (canStream) {
    const r = await readStream(bodyStream, kind, start, {
      signal: opts.signal,
      onEvent: opts.onStreamEvent,
      idleMs: req.stream?.idleMs,
      maxMs:  req.stream?.maxMs,
    });
    responseBody = r.text;
    streamFields = { streamed: true, events: r.events, streamClose: r.close, firstEventMs: r.firstEventMs };
  } else {
    responseBody = await fetchResp.text();
  }

  return {
    status: fetchResp.status,
    statusText: fetchResp.statusText,
    rawHeaders,
    responseBody,
    durationMs: Date.now() - start,
    sentHeaders,
    sentBody: effectiveBody,
    finalUrl,
    ...streamFields,
  };
}

// ─── Status determination ─────────────────────────────────────────────────────

/**
 * Derive the run status, in priority order:
 *   1. post-script crashed → 'error'
 *   2. has tests, any failed → 'failed'
 *   3. has tests, all passed → 'passed' (even on HTTP 4xx — the user
 *      intentionally expects that status, e.g. negative tests for 422)
 *   4. no tests + HTTP 4xx/5xx → 'failed'
 *   5. no tests + HTTP 2xx/3xx → 'passed' (SOAP Fault / GraphQL `errors`
 *      already became failing tests via buildProtocolFaultTests)
 */
export function deriveRunStatus(
  postScriptError: string | undefined,
  testResults: TestResult[],
  httpStatus: number,
): RunStatus {
  const httpFailed = httpStatus >= 400;
  if (postScriptError) return 'error';
  if (testResults.length > 0) return testResults.every(t => t.passed) ? 'passed' : 'failed';
  return httpFailed ? 'failed' : 'passed';
}

/** Synthetic failing test shown when HTTP failed and the user wrote no assertions. */
export function syntheticHttpFailure(status: number, statusText: string): TestResult {
  return {
    name: `HTTP status ${status} ${statusText}`.trim(),
    passed: false,
    error: `Request returned ${status} - no assertion was defined to verify the status code.`,
  };
}

// ─── Full runner-item execution (shared by GUI runner and CLI) ────────────────

export interface RunnerExecOptions {
  req: ApiRequest
  collectionVars: Record<string, string>
  envVars: Record<string, string>
  globals: Record<string, string>
  localVars: Record<string, string>
  dispatcher: ProxyAgent | Agent | undefined
  piiMaskPatterns: string[]
  proxy?: ProxyConfig
  tls?: TlsConfig
  /** Optional observer for pre/post script output (the CLI prints it live). */
  onScriptOutput?: (phase: 'pre' | 'post', consoleOutput: string[], error?: string) => void
}

export interface RunnerExecResult {
  result: RunRequestResult
  updatedEnvVars: Record<string, string>
  updatedCollectionVars: Record<string, string>
  updatedGlobals: Record<string, string>
  updatedLocalVars: Record<string, string>
}

/**
 * Execute one runner item end-to-end: pre-script → HTTP exchange → schema +
 * protocol tests → post-script → status. Used verbatim by the GUI batch
 * runner and the CLI runner.
 */
export async function executeRunnerRequest(opts: RunnerExecOptions): Promise<RunnerExecResult> {
  const { req, collectionVars, envVars, globals, dispatcher, piiMaskPatterns, proxy, tls, onScriptOutput } = opts;
  let { localVars } = opts;

  applyRequestDefaults(req);

  const base: RunRequestResult = {
    requestId: req.id,
    name: req.name,
    method: req.method,
    resolvedUrl: req.url,
    status: 'running',
  };

  // Dynamic built-in vars ($uuid, $timestamp, $randomInt, etc.) — generated
  // fresh for each request so each gets unique values.
  const dynamicVars = await buildDynamicVars();
  let vars = mergeVars(envVars, collectionVars, globals, localVars, dynamicVars);
  let updatedEnvVars = { ...envVars };
  let updatedCollectionVars = { ...collectionVars };
  let updatedGlobals = { ...globals };
  let preScriptError: string | undefined;

  // Pre-request script
  if (req.preRequestScript?.trim()) {
    const r = await runScript(interpolate(req.preRequestScript, vars), {
      envVars: { ...envVars }, collectionVars: { ...collectionVars },
      globals: { ...globals }, localVars: { ...localVars },
      piiMaskPatterns,
    });
    preScriptError = r.error;
    localVars = r.updatedLocalVars;
    updatedEnvVars = r.updatedEnvVars;
    updatedCollectionVars = r.updatedCollectionVars;
    updatedGlobals = r.updatedGlobals;
    patchGlobals(r.updatedGlobals);
    await persistGlobals();
    onScriptOutput?.('pre', r.consoleOutput, r.error);
    vars = mergeVars(updatedEnvVars, updatedCollectionVars, updatedGlobals, localVars, dynamicVars);
  }

  const resolvedUrl = buildUrl(req.url, req.params, vars);
  base.resolvedUrl = resolvedUrl;

  const start = Date.now();
  try {
    const exchange = await performHttpExchange({ req, vars, resolvedUrl, dispatcher, proxy, tls });

    const maskedBody = maskPii(exchange.responseBody, piiMaskPatterns);
    const maskedHeaders = maskHeaders(exchange.rawHeaders, piiMaskPatterns);

    // Same shape with the unmasked bytes — handed to the post-script so
    // `sp.response.json().access_token` returns the real value, not
    // "[REDACTED]". The displayed response keeps the redacted copy.
    const scriptResponse = {
      status: exchange.status, statusText: exchange.statusText,
      headers: exchange.rawHeaders, body: exchange.responseBody,
      bodySize: Buffer.byteLength(exchange.responseBody, 'utf8'),
      durationMs: exchange.durationMs,
    };

    // Schema validation (synthetic test results, independent of contract)
    const schemaTestResults = buildSchemaTestResults(req.schema, exchange.responseBody);
    // Protocol-level fault check — auto-pass/fail for SOAP / GraphQL so they
    // stop landing in 'skipped' just because no hand-written assertion was
    // added. Empty for REST, preserving the "add assertions" nudge there.
    const protocolFaultTests = buildProtocolFaultTests(req.body.mode, exchange.responseBody);

    let testResults: TestResult[] = [...schemaTestResults, ...protocolFaultTests];
    let consoleOutput: string[] = [];
    let postScriptError: string | undefined;

    if (req.postRequestScript?.trim()) {
      const r = await runScript(interpolate(req.postRequestScript, vars), {
        envVars: updatedEnvVars, collectionVars: updatedCollectionVars,
        globals: updatedGlobals, localVars, response: scriptResponse,
        piiMaskPatterns,
      });
      testResults = [...schemaTestResults, ...protocolFaultTests, ...r.testResults];
      consoleOutput = r.consoleOutput;
      postScriptError = r.error;
      updatedEnvVars = r.updatedEnvVars;
      updatedCollectionVars = r.updatedCollectionVars;
      updatedGlobals = r.updatedGlobals;
      localVars = r.updatedLocalVars;
      patchGlobals(r.updatedGlobals);
      await persistGlobals();
      onScriptOutput?.('post', r.consoleOutput, r.error);
    }

    const status = deriveRunStatus(postScriptError, testResults, exchange.status);

    // If HTTP failed and the user has NO tests at all, surface a synthetic
    // result. But if tests exist and passed, the user intentionally expects
    // that status code (e.g. negative tests expecting 422).
    if (exchange.status >= 400 && testResults.length === 0) {
      testResults = [...testResults, syntheticHttpFailure(exchange.status, exchange.statusText)];
    }

    return {
      result: {
        ...base,
        status,
        httpStatus: exchange.status,
        durationMs: exchange.durationMs,
        testResults,
        consoleOutput,
        preScriptError,
        postScriptError,
        sentRequest: { headers: exchange.sentHeaders, body: exchange.sentBody },
        receivedResponse: {
          status: exchange.status,
          statusText: exchange.statusText,
          headers: maskedHeaders,
          body: maskedBody,
        },
      },
      updatedEnvVars,
      updatedCollectionVars,
      updatedGlobals,
      updatedLocalVars: localVars,
    };
  } catch (err) {
    return {
      result: {
        ...base,
        status: 'error',
        durationMs: Date.now() - start,
        error: err instanceof Error
          ? (err.cause instanceof Error ? `${err.message}: ${err.cause.message}` : err.message)
          : String(err),
        preScriptError,
      },
      updatedEnvVars,
      updatedCollectionVars,
      updatedGlobals,
      updatedLocalVars: localVars,
    };
  }
}

// ─── Hook skip / failure propagation ──────────────────────────────────────────

/**
 * Tracks hook failures across a run plan: a beforeAll failure poisons its
 * scope, a before failure poisons its single main request. Subsequent items
 * in those scopes / for that request are reported as skipped without
 * executing. Shared by the GUI runner and the CLI.
 */
export class HookSkipTracker {
  /** Scopes whose beforeAll hook failed — all their requests are skipped. */
  private failedScopes = new Set<string>();
  /** Main request IDs whose before hook failed — that request is skipped. */
  private skipRequests = new Set<string>();

  /** Returns the human-readable skip reason, or undefined to run the item. */
  shouldSkip(item: RunnerItem): string | undefined {
    const { isHook, hookType, scopeId, scopeAncestors, mainRequestId } = item;
    if (isHook) {
      if (hookType === 'beforeAll') {
        if ((scopeAncestors ?? []).some(id => this.failedScopes.has(id))) {
          return 'Skipped - outer scope hook failed';
        }
      } else if (hookType === 'before') {
        const allScopes = [...(scopeAncestors ?? []), scopeId].filter(Boolean) as string[];
        if (allScopes.some(id => this.failedScopes.has(id))) {
          return 'Skipped - scope hook failed';
        }
        if (mainRequestId && this.skipRequests.has(mainRequestId)) {
          return 'Skipped - before hook failed';
        }
      }
      // after / afterAll: never skip
      return undefined;
    }
    const allScopes = [...(scopeAncestors ?? []), scopeId].filter(Boolean) as string[];
    if (allScopes.some(id => this.failedScopes.has(id))) {
      return 'Skipped - beforeAll hook failed';
    }
    if (this.skipRequests.has(item.request.id)) {
      return 'Skipped - before hook failed';
    }
    return undefined;
  }

  /** Record an executed item's outcome so later items skip when appropriate.
   *  A 'skipped' hook (HTTP 2xx with no assertions) is not a failure — only
   *  real failures or errors propagate to dependent requests. */
  recordResult(item: RunnerItem, status: RunStatus): void {
    const failed = status === 'failed' || status === 'error';
    if (!item.isHook || !failed) return;
    if (item.hookType === 'beforeAll' && item.scopeId) {
      this.failedScopes.add(item.scopeId);
    } else if (item.hookType === 'before' && item.mainRequestId) {
      this.skipRequests.add(item.mainRequestId);
    }
  }
}
