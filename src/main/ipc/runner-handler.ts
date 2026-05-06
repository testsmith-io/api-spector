// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { fetch, Headers, ProxyAgent, Agent } from 'undici';
import { readFile } from 'fs/promises';
import type {
  RunnerPayload,
  RunRequestResult,
  RunSummary,
  ApiRequest,
} from '../../shared/types';
import { interpolate, buildUrl, buildEnvVars, mergeVars, buildDynamicVars } from '../interpolation';
import { runScript } from '../script-runner';
import { getGlobals, patchGlobals, persistGlobals } from '../globals-store';
import {
  buildAuthHeaders,
  performDigestAuth,
  performNtlmRequest,
  fetchOAuth2Token,
} from '../auth-builder';
import { maskPii, maskHeaders, buildSchemaTestResults, buildProtocolFaultTests } from './request-handler';

// ─── Build undici dispatcher (proxy + TLS) ────────────────────────────────────

async function buildDispatcher(
  proxy?: RunnerPayload['proxy'],
  tls?: RunnerPayload['tls'],
): Promise<ProxyAgent | Agent | undefined> {
  const connectOpts: Record<string, unknown> = {};
  let hasTls = false;

  if (tls) {
    hasTls = true;
    if (tls.rejectUnauthorized !== undefined) connectOpts['rejectUnauthorized'] = tls.rejectUnauthorized;
    if (tls.caCertPath)      { try { connectOpts['ca']   = await readFile(tls.caCertPath); }      catch { /* ignore */ } }
    if (tls.clientCertPath)  { try { connectOpts['cert'] = await readFile(tls.clientCertPath); }  catch { /* ignore */ } }
    if (tls.clientKeyPath)   { try { connectOpts['key']  = await readFile(tls.clientKeyPath); }   catch { /* ignore */ } }
  }

  if (proxy?.url) {
    return new ProxyAgent({
      uri: proxyUri,
      requestTls: proxyConnect,
      proxyTls: proxyConnect,
    } as ConstructorParameters<typeof ProxyAgent>[0]);
  }
  if (hasTls) return new Agent({ connect: connectOpts } as ConstructorParameters<typeof Agent>[0]);
  return undefined;
}

// ─── Execute a single request, return a result ────────────────────────────────

interface ExecuteOneResult {
  result: RunRequestResult
  updatedEnvVars:        Record<string, string>
  updatedCollectionVars: Record<string, string>
  updatedGlobals:        Record<string, string>
  updatedLocalVars:      Record<string, string>
}

async function executeOne(
  req: ApiRequest,
  collectionVars: Record<string, string>,
  envVars: Record<string, string>,
  globals: Record<string, string>,
  localVars: Record<string, string>,
  dispatcher: ProxyAgent | Agent | undefined,
  piiMaskPatterns: string[],
): Promise<ExecuteOneResult> {
  // Defensive defaults — AI-generated collections may omit empty arrays
  if (!req.headers) req.headers = [];
  if (!req.params) req.params = [];
  if (!req.body) req.body = { mode: 'none' };
  if (!req.auth) req.auth = { type: 'none' };

  const base: RunRequestResult = {
    requestId:   req.id,
    name:        req.name,
    method:      req.method,
    resolvedUrl: '',
    status:      'running',
  };

  // Dynamic built-in vars ($uuid, $timestamp, $randomInt, etc.) — generated
  // fresh for each request so each gets unique values.
  const dynamicVars = await buildDynamicVars();
  let vars                  = mergeVars(envVars, collectionVars, globals, localVars, dynamicVars);
  let updatedEnvVars        = { ...envVars };
  let updatedCollectionVars = { ...collectionVars };
  let updatedGlobals        = { ...globals };
  let preScriptError: string | undefined;

  // Pre-request script
  if (req.preRequestScript?.trim()) {
    const r = await runScript(interpolate(req.preRequestScript, vars), {
      envVars: { ...envVars }, collectionVars: { ...collectionVars },
      globals: { ...globals }, localVars: {},
      piiMaskPatterns,
    });
    preScriptError        = r.error;
    localVars             = r.updatedLocalVars;
    updatedEnvVars        = r.updatedEnvVars;
    updatedCollectionVars = r.updatedCollectionVars;
    updatedGlobals        = r.updatedGlobals;
    patchGlobals(r.updatedGlobals);
    await persistGlobals();
    vars = mergeVars(updatedEnvVars, updatedCollectionVars, updatedGlobals, localVars, dynamicVars);
  }

  const resolvedUrl = buildUrl(req.url, req.params, vars);
  base.resolvedUrl  = resolvedUrl;

  const start = Date.now();
  try {
    // OAuth2 token refresh
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
    const headers     = new Headers();

    for (const h of req.headers) {
      if (h.enabled && h.key) headers.set(interpolate(h.key, vars), interpolate(h.value, vars));
    }
    for (const [k, v] of Object.entries(authHeaders)) headers.set(k, v);

    let body: string | undefined;
    if (req.body.mode === 'json' && req.body.json) {
      body = interpolate(req.body.json, vars);
      if (!headers.has('content-type')) headers.set('Content-Type', 'application/json');
    } else if (req.body.mode === 'raw' && req.body.raw) {
      body = interpolate(req.body.raw, vars);
      if (!headers.has('content-type')) headers.set('Content-Type', req.body.rawContentType ?? 'text/plain');
    } else if (req.body.mode === 'graphql' && req.body.graphql) {
      const gql = req.body.graphql;
      const gqlBody: Record<string, unknown> = { query: interpolate(gql.query, vars) };
      const rawVars = gql.variables?.trim();
      if (rawVars) {
        try { gqlBody.variables = JSON.parse(interpolate(rawVars, vars)); } catch { /* skip */ }
      }
      if (gql.operationName?.trim()) gqlBody.operationName = gql.operationName.trim();
      body = JSON.stringify(gqlBody);
      if (!headers.has('content-type')) headers.set('Content-Type', 'application/json');
    } else if (req.body.mode === 'soap' && req.body.soap) {
      // Send the SOAP envelope. Without this branch the body went out empty
      // and the server returned `Root element is missing`.
      body = interpolate(req.body.soap.envelope, vars);
      if (!headers.has('content-type')) headers.set('Content-Type', 'text/xml; charset=utf-8');
      if (req.body.soap.soapAction && !headers.has('soapaction')) {
        headers.set('SOAPAction', req.body.soap.soapAction);
      }
    }

    const methodHasBody = !['GET', 'HEAD'].includes(req.method);

    const doFetch = (h: Headers) => fetch(resolvedUrl, {
      method:     req.method,
      headers:    h,
      body:       methodHasBody ? body : undefined,
      dispatcher: dispatcher as Parameters<typeof fetch>[1] extends { dispatcher?: infer D } ? D : never,
    } as Parameters<typeof fetch>[1]);

    let fetchResp: Awaited<ReturnType<typeof fetch>>;

    if (req.auth.type === 'ntlm') {
      await performNtlmRequest(resolvedUrl, req.method, req.auth, vars);
      fetchResp = await doFetch(headers); // unreachable
    } else if (req.auth.type === 'digest') {
      const probeFetch = (url: string, init: Record<string, unknown>) =>
        fetch(url, {
          ...(init as object),
          dispatcher: dispatcher as Parameters<typeof fetch>[1] extends { dispatcher?: infer D } ? D : never,
        } as Parameters<typeof fetch>[1]);

      const digestHeader = await performDigestAuth(resolvedUrl, req.method, req.auth, vars, probeFetch);
      if (digestHeader) headers.set('Authorization', digestHeader);
      fetchResp = await doFetch(headers);
    } else {
      fetchResp = await doFetch(headers);
    }

    const responseBody = await fetchResp.text();
    const durationMs   = Date.now() - start;
    const rawRespHeaders: Record<string, string> = {};
    fetchResp.headers.forEach((v, k) => { rawRespHeaders[k] = v; });

    const maskedBody    = maskPii(responseBody, piiMaskPatterns);
    const maskedHeaders = maskHeaders(rawRespHeaders, piiMaskPatterns);

    const response = {
      status: fetchResp.status, statusText: fetchResp.statusText,
      headers: maskedHeaders, body: maskedBody,
      bodySize: Buffer.byteLength(responseBody, 'utf8'), durationMs,
    };
    // Same shape with the unmasked bytes — handed to the post-script so
    // `sp.response.json().access_token` returns the real value, not
    // "[REDACTED]". The displayed `response` keeps the redacted copy.
    const scriptResponse = {
      status: fetchResp.status, statusText: fetchResp.statusText,
      headers: rawRespHeaders, body: responseBody,
      bodySize: Buffer.byteLength(responseBody, 'utf8'), durationMs,
    };

    // Schema validation (synthetic test results, independent of contract)
    const schemaTestResults = buildSchemaTestResults(req.schema, responseBody);
    // Protocol-level fault check — auto-pass/fail for SOAP / GraphQL so they
    // stop landing in 'skipped' just because no hand-written assertion was
    // added. Empty for REST, preserving the "add assertions" nudge there.
    const protocolFaultTests = buildProtocolFaultTests(req.body.mode, responseBody);

    // Post-request script
    let testResults: RunRequestResult['testResults'] = [...schemaTestResults, ...protocolFaultTests];
    let consoleOutput: string[] = [];
    let postScriptError: string | undefined;

    if (req.postRequestScript?.trim()) {
      const r = await runScript(interpolate(req.postRequestScript, vars), {
        envVars: updatedEnvVars, collectionVars: updatedCollectionVars,
        globals: updatedGlobals, localVars, response: scriptResponse,
        piiMaskPatterns,
      });
      testResults           = [...schemaTestResults, ...protocolFaultTests, ...r.testResults];
      consoleOutput         = r.consoleOutput;
      postScriptError       = r.error;
      updatedEnvVars        = r.updatedEnvVars;
      updatedCollectionVars = r.updatedCollectionVars;
      updatedGlobals        = r.updatedGlobals;
      localVars             = r.updatedLocalVars;
      patchGlobals(r.updatedGlobals);
      await persistGlobals();
    }

    // Status determination, in priority order:
    //   1. post-script crashed → 'error'
    //   2. any test failed → 'failed'
    //   3. has tests, all passed → 'passed' (even if HTTP 4xx/5xx — the user
    //      intentionally expects that status, e.g. negative tests for 422)
    //   4. no tests + HTTP 4xx/5xx → 'failed' (synthetic test added below)
    //   5. no tests + HTTP 2xx/3xx → 'passed' (a 2xx is success on its own;
    //      SOAP Fault and GraphQL `errors` already turned into failing tests
    //      via buildProtocolFaultTests above, so we won't mislabel those)
    const allPassed  = testResults.every(t => t.passed);
    const httpFailed = fetchResp.status >= 400;
    const hasTests   = testResults.length > 0;
    const status: RunRequestResult['status'] = postScriptError
      ? 'error'
      : hasTests
        ? (allPassed ? 'passed' : 'failed')
        : httpFailed
          ? 'failed'
          : 'passed';

    // If HTTP failed and the user has NO tests at all, surface a synthetic
    // result. But if tests exist and passed, the user intentionally expects
    // that status code (e.g. negative tests expecting 422).
    if (httpFailed && testResults.length === 0) {
      testResults = [
        ...testResults,
        {
          name:   `HTTP status ${fetchResp.status} ${fetchResp.statusText}`.trim(),
          passed: false,
          error:  `Request returned ${fetchResp.status} — no assertion was defined to verify the status code.`,
        },
      ];
    }

    const sentHeaders: Record<string, string> = {};
    headers.forEach((v, k) => { sentHeaders[k] = v; });

    return {
      result: {
        ...base,
        status,
        httpStatus:   fetchResp.status,
        durationMs,
        testResults,
        consoleOutput,
        preScriptError,
        postScriptError,
        sentRequest: { headers: sentHeaders, body: body ?? undefined },
        receivedResponse: {
          status:     fetchResp.status,
          statusText: fetchResp.statusText,
          headers:    maskedHeaders,
          body:       maskedBody,
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
        status:     'error',
        durationMs: Date.now() - start,
        error:      err instanceof Error
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

// ─── IPC handler ─────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function registerRunnerHandler(ipc: IpcMain): void {
  ipc.handle('runner:start', async (event: IpcMainInvokeEvent, payload: RunnerPayload) => {
    const { items, environment, globals: payloadGlobals, proxy, tls, piiMaskPatterns = [], requestDelay = 0 } = payload;

    const envVars     = await buildEnvVars(environment);
    const liveGlobals = getGlobals();
    const globals     = { ...payloadGlobals, ...liveGlobals };

    const dispatcher = await buildDispatcher(proxy, tls);

    const summary: RunSummary = { total: items.length, passed: 0, failed: 0, errors: 0, skipped: 0, durationMs: 0 };
    const totalStart = Date.now();

    let runEnvVars        = { ...envVars };
    let runCollectionVars: Record<string, string> = {};
    let runGlobals        = { ...globals };
    let runLocalVars:     Record<string, string> = {};

    /** Scopes whose beforeAll hook failed — all their requests are skipped. */
    const failedScopes  = new Set<string>();
    /** Main request IDs whose before hook failed — that request is skipped. */
    const skipRequests  = new Set<string>();

    for (const item of items) {
      const { isHook, hookType, scopeId, scopeAncestors, mainRequestId } = item;

      // ── Determine whether to skip this item ─────────────────────────────
      let skipReason: string | undefined;
      if (isHook) {
        if (hookType === 'beforeAll') {
          // Skip if an ancestor scope's beforeAll already failed
          if ((scopeAncestors ?? []).some(id => failedScopes.has(id))) {
            skipReason = 'Skipped — outer scope hook failed';
          }
        } else if (hookType === 'before') {
          // Skip if any scope (ancestor or own) failed, or this request's before already failed
          const allScopes = [...(scopeAncestors ?? []), scopeId].filter(Boolean) as string[];
          if (allScopes.some(id => failedScopes.has(id))) {
            skipReason = 'Skipped — scope hook failed';
          } else if (mainRequestId && skipRequests.has(mainRequestId)) {
            skipReason = 'Skipped — before hook failed';
          }
        }
        // after / afterAll: never skip
      } else {
        // Main request
        const allScopes = [...(item.scopeAncestors ?? []), item.scopeId].filter(Boolean) as string[];
        if (allScopes.some(id => failedScopes.has(id))) {
          skipReason = 'Skipped — beforeAll hook failed';
        } else if (skipRequests.has(item.request.id)) {
          skipReason = 'Skipped — before hook failed';
        }
      }

      if (skipReason) {
        const skipped: RunRequestResult = {
          requestId:  item.request.id,
          name:       item.request.name,
          method:     item.request.method,
          resolvedUrl: item.request.url,
          status:     'failed',
          error:      skipReason,
          isHook:     item.isHook,
          hookType:   item.hookType,
          scopeId:    item.scopeId,
          scopePath:  item.scopePath,
          iterationLabel: item.iterationLabel,
        };
        summary.failed++;
        event.sender.send('runner:progress', skipped);
        continue;
      }

      // ── Run the item ────────────────────────────────────────────────────
      const runningUpdate: Partial<RunRequestResult> = {
        status: 'running', iterationLabel: item.iterationLabel,
        isHook: item.isHook, hookType: item.hookType, scopeId: item.scopeId,
        scopePath: item.scopePath,
      };
      event.sender.send('runner:progress', { requestId: item.request.id, ...runningUpdate });

      const { result, updatedEnvVars, updatedCollectionVars, updatedGlobals, updatedLocalVars } = await executeOne(
        item.request,
        { ...item.collectionVars, ...runCollectionVars },
        runEnvVars,
        runGlobals,
        { ...runLocalVars, ...(item.dataRow ?? {}) },
        dispatcher,
        piiMaskPatterns,
      );

      runEnvVars        = updatedEnvVars;
      runCollectionVars = updatedCollectionVars;
      runGlobals        = updatedGlobals;
      runLocalVars      = updatedLocalVars;

      // ── Post-run: propagate failures ────────────────────────────────────
      // A 'skipped' hook (HTTP 2xx with no assertions) is not a failure —
      // only real failures or errors should propagate to dependent requests.
      const hookFailed = result.status === 'failed' || result.status === 'error';
      if (isHook && hookFailed) {
        if (hookType === 'beforeAll' && scopeId) {
          failedScopes.add(scopeId);
        } else if (hookType === 'before' && mainRequestId) {
          skipRequests.add(mainRequestId);
        }
      }

      if (result.status === 'passed')       summary.passed++;
      else if (result.status === 'failed')  summary.failed++;
      else if (result.status === 'skipped') summary.skipped++;
      else                                   summary.errors++;

      event.sender.send('runner:progress', {
        ...result, iterationLabel: item.iterationLabel,
        isHook: item.isHook, hookType: item.hookType, scopeId: item.scopeId,
        scopePath: item.scopePath,
      });

      if (requestDelay > 0 && item !== items[items.length - 1]) {
        await sleep(requestDelay);
      }
    }

    summary.durationMs = Date.now() - totalStart;
    return summary;
  });
}
