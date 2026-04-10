// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { type IpcMain } from 'electron';
import { fetch, Headers, ProxyAgent, Agent } from 'undici';
import { readFile } from 'fs/promises';
import type {
  SendRequestPayload,
  ResponsePayload,
  RequestExecutionResult,
  ScriptExecutionMeta,
  SentRequest,
  TestResult,
} from '../../shared/types';
import { interpolate, buildUrl, buildEnvVars, mergeVars, buildDynamicVars } from '../interpolation';
import { runScript } from '../script-runner';
import { getGlobals, patchGlobals, persistGlobals } from '../globals-store';
import {
  buildAuthHeaders,
  buildApiKeyParam,
  performDigestAuth,
  performNtlmRequest,
  fetchOAuth2Token,
} from '../auth-builder';
import { buildProxyUri } from '../proxy-utils';

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

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function readStringField(obj: Record<string, unknown> | null, key: string): string | undefined {
  const value = obj?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

function safeProxySummary(proxy?: SendRequestPayload['proxy']): string {
  if (!proxy?.url?.trim()) return 'off';
  try {
    const normalized = buildProxyUri({ url: proxy.url });
    const parsed = new URL(normalized);
    const host = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
    const auth = proxy.auth ? 'yes' : 'no';
    return `${parsed.protocol}//${host} auth=${auth}`;
  } catch {
    return `invalid input "${proxy.url}"`;
  }
}

function safeTlsSummary(tls?: SendRequestPayload['tls']): string {
  if (!tls) return 'off';
  const parts: string[] = [];
  if (tls.rejectUnauthorized !== undefined) parts.push(`rejectUnauthorized=${String(tls.rejectUnauthorized)}`);
  if (tls.caCertPath) parts.push(`ca=${tls.caCertPath}`);
  if (tls.clientCertPath) parts.push(`cert=${tls.clientCertPath}`);
  if (tls.clientKeyPath) parts.push(`key=${tls.clientKeyPath}`);
  return parts.length ? parts.join(', ') : 'on';
}

function formatRequestError(
  err: unknown,
  context: {
    requestId: string
    method: string
    resolvedUrl: string
    proxy?: SendRequestPayload['proxy']
    tls?: SendRequestPayload['tls']
  },
): string {
  const obj = asObject(err);
  const message = err instanceof Error ? err.message : String(err);
  const code = readStringField(obj, 'code');
  const stack = err instanceof Error ? err.stack : undefined;
  const causeObj = obj ? asObject(obj['cause']) : null;
  const causeMessage = readStringField(causeObj, 'message');
  const causeCode = readStringField(causeObj, 'code');

  const lines: string[] = [
    `[request:send] ${context.method} ${context.resolvedUrl}`,
    `[request:send] requestId=${context.requestId}`,
    `[request:send] proxy=${safeProxySummary(context.proxy)}`,
    `[request:send] tls=${safeTlsSummary(context.tls)}`,
    `[request:send] error=${message}${code ? ` (code=${code})` : ''}`,
  ];

  if (causeMessage) {
    lines.push(`[request:send] cause=${causeMessage}${causeCode ? ` (code=${causeCode})` : ''}`);
  }

  if (stack) {
    const preview = stack.split('\n').slice(0, 6).join('\n');
    lines.push('[request:send] stack:');
    lines.push(preview);
  }

  return lines.join('\n');
}

// ─── Build undici dispatcher (proxy + TLS) ────────────────────────────────────

export async function buildDispatcher(
  proxy?: SendRequestPayload['proxy'],
  tls?: SendRequestPayload['tls'],
): Promise<ProxyAgent | Agent | undefined> {
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

  if (proxy?.url) {
    return new ProxyAgent({
      uri: buildProxyUri(proxy),
      ...(hasTls ? { requestTls: connectOpts, proxyTls: connectOpts } : {}),
    } as ConstructorParameters<typeof ProxyAgent>[0]);
  }

  if (hasTls) {
    return new Agent({ connect: connectOpts } as ConstructorParameters<typeof Agent>[0]);
  }

  return undefined;
}

// ─── IPC handler ─────────────────────────────────────────────────────────────

export function registerRequestHandler(ipc: IpcMain): void {
  ipc.handle('request:send', async (
    _e,
    payload: SendRequestPayload,
  ): Promise<RequestExecutionResult> => {
    const {
      request: req,
      environment,
      collectionVars,
      globals: payloadGlobals,
      proxy,
      tls,
      piiMaskPatterns = [],
    } = payload;
    const start = Date.now();

    // Merge globals: in-memory store wins over payload snapshot
    const liveGlobals  = getGlobals();
    const mergedGlobals = { ...payloadGlobals, ...liveGlobals };

    // Resolve env secrets
    const envVars = await buildEnvVars(environment);
    let localVars: Record<string, string> = {};

    // Detect secrets that could not be decrypted
    const decryptionWarnings: string[] = [];
    if (environment) {
      const masterKeySet = Boolean(process.env['API_SPECTOR_MASTER_KEY']);
      for (const v of environment.variables) {
        if (!v.enabled || !v.secret || !v.secretEncrypted) continue;
        if (!masterKeySet) {
          decryptionWarnings.push(`[warn] Secret "${v.key}" was not decrypted: API_SPECTOR_MASTER_KEY is not set. Use the master password modal or export the variable in your shell.`);
        } else if (envVars[v.key] === undefined) {
          decryptionWarnings.push(`[warn] Secret "${v.key}" could not be decrypted: wrong password or corrupted data.`);
        }
      }
    }

    // Dynamic built-in vars ($uuid, $randomEmail, etc.) — generated once per send
    const dynamicVars = await buildDynamicVars();

    // Merge for pre-script
    let vars = mergeVars(envVars, collectionVars, mergedGlobals, localVars, dynamicVars);

    // ── Pre-request script ────────────────────────────────────────────────────
    let preScriptMeta: { error?: string; consoleOutput: string[] } = { consoleOutput: [] };
    let updatedCollectionVars = { ...collectionVars };
    let updatedEnvVars        = { ...envVars };
    let updatedGlobals        = { ...mergedGlobals };

    if (req.preRequestScript?.trim()) {
      const result = await runScript(req.preRequestScript, {
        envVars:        { ...envVars },
        collectionVars: { ...collectionVars },
        globals:        { ...mergedGlobals },
        localVars:      {},
      });
      preScriptMeta         = { error: result.error, consoleOutput: result.consoleOutput };
      localVars             = result.updatedLocalVars;
      updatedEnvVars        = result.updatedEnvVars;
      updatedCollectionVars = result.updatedCollectionVars;
      updatedGlobals        = result.updatedGlobals;

      patchGlobals(result.updatedGlobals);
      await persistGlobals();

      vars = mergeVars(updatedEnvVars, updatedCollectionVars, updatedGlobals, localVars, dynamicVars);
    }

    // ── Build & send HTTP request ─────────────────────────────────────────────
    let response: ResponsePayload;
    let sentRequest: SentRequest = { method: req.method, url: '', headers: {} };
    const resolvedUrl = buildUrl(req.url, req.params, vars);

    // Collect decrypted secret values so we can redact them from the sent request display
    const secretValues = new Set<string>();
    if (environment) {
      for (const v of environment.variables) {
        if (!v.enabled) continue;
        if ((v.secret || v.envRef) && envVars[v.key]) {
          secretValues.add(envVars[v.key]);
        }
      }
    }

    function redactSecrets(s: string): string {
      if (!secretValues.size) return s;
      let result = s;
      for (const secret of secretValues) {
        if (secret) result = result.split(secret).join('[*****]');
      }
      return result;
    }

    function redactSentRequest(sr: SentRequest): SentRequest {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(sr.headers)) {
        headers[k] = redactSecrets(v);
      }
      return {
        method: sr.method,
        url: redactSecrets(sr.url),
        headers,
        body: sr.body !== undefined ? redactSecrets(sr.body) : undefined,
      };
    }

    try {
      // Build dispatcher once — shared across digest/ntlm retries
      const dispatcher = await buildDispatcher(proxy, tls);

      // For OAuth2: ensure we have a fresh token before building headers
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

      // Final URL with possible apikey query param
      let finalUrl = resolvedUrl;
      if (apiKeyParam) {
        const sep = finalUrl.includes('?') ? '&' : '?';
        finalUrl += `${sep}${encodeURIComponent(apiKeyParam.key)}=${encodeURIComponent(apiKeyParam.value)}`;
      }

      const buildHeaders = (): Headers => {
        const h = new Headers();
        for (const header of req.headers) {
          if (header.enabled && header.key) {
            h.set(interpolate(header.key, vars), interpolate(header.value, vars));
          }
        }
        for (const [k, v] of Object.entries(authHeaders)) h.set(k, v);
        return h;
      };

      let body: string | undefined;
      if (req.body.mode === 'json' && req.body.json) {
        body = interpolate(req.body.json, vars);
      } else if (req.body.mode === 'form' && req.body.form) {
        body = req.body.form
          .filter(p => p.enabled && p.key)
          .map(p => `${encodeURIComponent(interpolate(p.key, vars))}=${encodeURIComponent(interpolate(p.value, vars))}`)
          .join('&');
      } else if (req.body.mode === 'raw' && req.body.raw) {
        body = interpolate(req.body.raw, vars);
      } else if (req.body.mode === 'graphql' && req.body.graphql) {
        const gql = req.body.graphql;
        const gqlBody: Record<string, unknown> = { query: interpolate(gql.query, vars) };
        const rawVars = gql.variables?.trim();
        if (rawVars) {
          try { gqlBody.variables = JSON.parse(interpolate(rawVars, vars)); } catch { /* keep out */ }
        }
        if (gql.operationName?.trim()) gqlBody.operationName = gql.operationName.trim();
        body = JSON.stringify(gqlBody);
      } else if (req.body.mode === 'soap' && req.body.soap) {
        const soap = req.body.soap;
        body = interpolate(soap.envelope, vars);
      }

      const methodHasBody = !['GET', 'HEAD'].includes(req.method);

      // Helper that adds Content-Type defaults and fires the actual request
      const doFetch = async (overrideHeaders?: Headers): Promise<ReturnType<typeof fetch>> => {
        const h = overrideHeaders ?? buildHeaders();
        if (body !== undefined) {
          if (!h.has('content-type')) {
            if      (req.body.mode === 'json' || req.body.mode === 'graphql') h.set('Content-Type', 'application/json');
            else if (req.body.mode === 'form')                                 h.set('Content-Type', 'application/x-www-form-urlencoded');
            else if (req.body.mode === 'raw')                                  h.set('Content-Type', req.body.rawContentType ?? 'text/plain');
            else if (req.body.mode === 'soap')                                 h.set('Content-Type', 'text/xml; charset=utf-8');
          }
          // SOAP requires SOAPAction header
          if (req.body.mode === 'soap' && req.body.soap?.soapAction && !h.has('soapaction')) {
            h.set('SOAPAction', req.body.soap.soapAction);
          }
        }
        // Capture what we're actually sending
        const capturedHeaders: Record<string, string> = {};
        h.forEach((value, key) => { capturedHeaders[key] = value; });
        sentRequest = { method: req.method, url: finalUrl, headers: capturedHeaders, body: methodHasBody ? body : undefined };
        return fetch(finalUrl, {
          method:     req.method,
          headers:    h,
          body:       methodHasBody ? body : undefined,
          dispatcher: dispatcher as Parameters<typeof fetch>[1] extends { dispatcher?: infer D } ? D : never,
        } as Parameters<typeof fetch>[1]);
      };

      let fetchResp: Awaited<ReturnType<typeof fetch>>;

      // ── NTLM ──────────────────────────────────────────────────────────────
      if (req.auth.type === 'ntlm') {
        // performNtlmRequest currently throws with a helpful TODO message
        await performNtlmRequest(finalUrl, req.method, req.auth, vars);
        // unreachable — silence TS
        fetchResp = await doFetch();
      }
      // ── Digest two-round-trip ──────────────────────────────────────────────
      else if (req.auth.type === 'digest') {
        // Thin fetch wrapper for the probe request (no body, just to get 401)
        const probeFetch = async (url: string, init: Record<string, unknown>) => {
          return fetch(url, {
            ...(init as object),
            dispatcher: dispatcher as Parameters<typeof fetch>[1] extends { dispatcher?: infer D } ? D : never,
          } as Parameters<typeof fetch>[1]);
        };

        const digestHeader = await performDigestAuth(finalUrl, req.method, req.auth, vars, probeFetch);
        const h = buildHeaders();
        if (digestHeader) h.set('Authorization', digestHeader);
        fetchResp = await doFetch(h);
      }
      // ── Normal ────────────────────────────────────────────────────────────
      else {
        fetchResp = await doFetch();
      }

      const responseBody = await fetchResp.text();
      const durationMs   = Date.now() - start;
      const rawResponseHeaders: Record<string, string> = {};
      fetchResp.headers.forEach((value, key) => { rawResponseHeaders[key] = value; });

      // ── PII masking ────────────────────────────────────────────────────────
      const maskedBody    = maskPii(responseBody, piiMaskPatterns);
      const maskedHeaders = maskHeaders(rawResponseHeaders, piiMaskPatterns);

      response = {
        status:     fetchResp.status,
        statusText: fetchResp.statusText,
        headers:    maskedHeaders,
        body:       maskedBody,
        bodySize:   Buffer.byteLength(responseBody, 'utf8'),
        durationMs,
      };
    } catch (err) {
      const diagnostic = formatRequestError(err, {
        requestId: req.id,
        method: req.method,
        resolvedUrl,
        proxy,
        tls,
      });
      console.error(diagnostic);
      response = {
        status:     0,
        statusText: 'Error',
        headers:    {},
        body:       '',
        bodySize:   0,
        durationMs: Date.now() - start,
        error:      diagnostic,
      };
    }

    // ── Post-request script ───────────────────────────────────────────────────
    let postTestResults: TestResult[] = [];
    let postConsole: string[] = [];
    let postError: string | undefined;

    if (req.postRequestScript?.trim() && !response.error) {
      const result = await runScript(req.postRequestScript, {
        envVars:        { ...updatedEnvVars },
        collectionVars: { ...updatedCollectionVars },
        globals:        { ...updatedGlobals },
        localVars:      { ...localVars },
        response,
      });
      postTestResults       = result.testResults;
      postConsole           = result.consoleOutput;
      postError             = result.error;
      updatedEnvVars        = result.updatedEnvVars;
      updatedCollectionVars = result.updatedCollectionVars;
      updatedGlobals        = result.updatedGlobals;
      localVars             = result.updatedLocalVars;

      patchGlobals(result.updatedGlobals);
      await persistGlobals();
    }

    const scriptResult: ScriptExecutionMeta = {
      testResults:          postTestResults,
      consoleOutput:        [...decryptionWarnings, ...preScriptMeta.consoleOutput, ...postConsole],
      updatedEnvVars,
      updatedCollectionVars,
      updatedGlobals,
      updatedLocalVars:     localVars,
      resolvedUrl,
      preScriptError:  preScriptMeta.error,
      postScriptError: postError,
    };

    return { response, scriptResult, sentRequest: redactSentRequest(sentRequest) };
  });

  // ── Hook script runner ─────────────────────────────────────────────────────
  // Runs an arbitrary script with caller-supplied variable context and returns
  // the updated variable scopes. Used by the GraphQL introspection hook.
  ipc.handle('script:run-hook', async (
    _e,
    payload: {
      script:         string
      envVars:        Record<string, string>
      collectionVars: Record<string, string>
      globals:        Record<string, string>
    },
  ) => {
    const { script, envVars, collectionVars, globals } = payload;
    const result = await runScript(script, { envVars, collectionVars, globals, localVars: {} });
    patchGlobals(result.updatedGlobals);
    await persistGlobals();
    return {
      updatedEnvVars:        result.updatedEnvVars,
      updatedCollectionVars: result.updatedCollectionVars,
      updatedGlobals:        result.updatedGlobals,
      consoleOutput:         result.consoleOutput,
      error:                 result.error,
    };
  });
}
