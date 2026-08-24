// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { type IpcMain } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import type {
  SendRequestPayload,
  ResponsePayload,
  RequestExecutionResult,
  ScriptExecutionMeta,
  SentRequest,
  TestResult,
  StreamEvent,
} from '../../shared/types';
import { interpolate, buildUrl, buildEnvVars, mergeVars, buildDynamicVars } from '../interpolation';
import { runScript } from '../script-runner';
import { getGlobals, patchGlobals, persistGlobals } from '../globals-store';
import { buildProxyUri } from '../proxy-utils';
import { validateSendRequestPayload } from './ipc-validate';
import {
  applyRequestDefaults,
  buildDispatcher,
  performHttpExchange,
  maskPii,
  maskHeaders,
  buildSchemaTestResults,
} from '../request-exec';

// The masking / schema / protocol-test helpers and the dispatcher builder
// live in the shared execution core now; re-export them so existing import
// sites (recorder, CLI, tests) keep working.
export {
  buildDispatcher,
  maskPii,
  maskHeaders,
  buildSchemaTestResults,
  buildProtocolFaultTests,
} from '../request-exec';

// ─── Error diagnostics ────────────────────────────────────────────────────────

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

  // TLS certificate rejections are the most common opaque "fetch failed" cause,
  // especially behind an intercepting proxy that presents a self-signed cert.
  // Point the user at the toggle that fixes it (it covers the proxy leg too).
  const certCodes = new Set([
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
  ]);
  if (certCodes.has(code ?? '') || certCodes.has(causeCode ?? '')) {
    lines.push(
      '[request:send] hint=A self-signed or untrusted TLS certificate was rejected. ' +
      'Uncheck "Reject unauthorized / self-signed certificates" in Collection or Workspace settings, ' +
      'which also relaxes verification for the proxy connection, or add the CA certificate under TLS settings.',
    );
  }

  if (stack) {
    const preview = stack.split('\n').slice(0, 6).join('\n');
    lines.push('[request:send] stack:');
    lines.push(preview);
  }

  return lines.join('\n');
}

// ─── Streaming ────────────────────────────────────────────────────────────────
// Live-abort handles for in-flight streamed reads, keyed by the streamId the
// renderer minted. The Stop button aborts through this map.
const streamControllers = new Map<string, AbortController>();

// ─── IPC handler ─────────────────────────────────────────────────────────────

export function registerRequestHandler(ipc: IpcMain): void {
  // Stop an in-flight streamed read (the response viewer's Stop button).
  handleIpc(ipc, IPC.request.stopStream, async (_e, streamId: string) => {
    streamControllers.get(streamId)?.abort();
  });

  handleIpc(ipc, IPC.request.send, async (
    _e,
    payload: SendRequestPayload,
  ): Promise<RequestExecutionResult> => {
    // Reject malformed payloads before they reach any IO. Throws an Error
    // with a useful path → reason mapping that ipcRenderer.invoke surfaces
    // to the renderer.
    validateSendRequestPayload(payload);
    const {
      request: req,
      environment,
      collectionVars,
      globals: payloadGlobals,
      proxy,
      tls,
      piiMaskPatterns = [],
      streamId,
      forceStream,
    } = payload;
    applyRequestDefaults(req);

    // ── Streaming plumbing ─────────────────────────────────────────────────────
    // Frames are coalesced and flushed on a short timer so a fast token stream
    // can't flood IPC or thrash React. Masking is applied here too, so live and
    // final frames are redacted identically to the buffered body.
    const maskEvent = (ev: StreamEvent): StreamEvent =>
      piiMaskPatterns.length ? { ...ev, data: maskPii(ev.data, piiMaskPatterns), json: undefined } : ev;
    let abortController: AbortController | undefined;
    let flushTimer: ReturnType<typeof setInterval> | undefined;
    const pending: StreamEvent[] = [];
    const flushStream = () => {
      if (pending.length) _e.sender.send(IPC.request.streamEvent, { streamId, events: pending.splice(0) });
    };
    if (streamId) {
      abortController = new AbortController();
      streamControllers.set(streamId, abortController);
      flushTimer = setInterval(flushStream, 40);
    }

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
      const result = await runScript(interpolate(req.preRequestScript, vars), {
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
    /** Unmasked response handed to the post-request script. The displayed
     *  `response` has PII patterns + the always-mask headers (Authorization,
     *  Cookie, Set-Cookie) replaced with `[REDACTED]` — but the *script*
     *  needs the real bytes so it can extract real tokens via
     *  `sp.response.json().access_token` and friends. */
    let scriptResponse: ResponsePayload;
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

      const exchange = await performHttpExchange({
        req,
        vars,
        resolvedUrl,
        dispatcher,
        proxy,
        tls,
        onSent: sent => { sentRequest = sent; },
        forceStream,
        signal: abortController?.signal,
        onStreamEvent: streamId
          ? ev => { pending.push(maskEvent(ev)); if (pending.length >= 50) flushStream(); }
          : undefined,
      });

      // ── PII masking ────────────────────────────────────────────────────────
      const maskedBody    = maskPii(exchange.responseBody, piiMaskPatterns);
      const maskedHeaders = maskHeaders(exchange.rawHeaders, piiMaskPatterns);
      const bodySize      = Buffer.byteLength(exchange.responseBody, 'utf8');
      const maskedEvents  = exchange.events?.map(maskEvent);
      // Stream frames displayed in the viewer (masked, like the body).
      const streamFields = exchange.streamed
        ? { streamed: true as const, events: maskedEvents, streamClose: exchange.streamClose, firstEventMs: exchange.firstEventMs }
        : {};

      response = {
        status:     exchange.status,
        statusText: exchange.statusText,
        headers:    maskedHeaders,
        body:       maskedBody,
        bodySize,
        durationMs: exchange.durationMs,
        ...streamFields,
      };
      // Same shape but with the unmasked bytes — used only for feeding the
      // post-request script so `sp.response.json().access_token` returns the
      // real value, not "[REDACTED]". Unmasked events back the future sp.stream.
      scriptResponse = {
        status:     exchange.status,
        statusText: exchange.statusText,
        headers:    exchange.rawHeaders,
        body:       exchange.responseBody,
        bodySize,
        durationMs: exchange.durationMs,
        ...(exchange.streamed ? { streamed: true as const, events: exchange.events } : {}),
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
      // Mirror for the script — same empty payload either way.
      scriptResponse = response;
    } finally {
      // Flush any buffered frames and release the abort handle.
      if (streamId) {
        if (flushTimer) clearInterval(flushTimer);
        flushStream();
        streamControllers.delete(streamId);
      }
    }

    // ── Schema validation ─────────────────────────────────────────────────────
    // If the request has a standalone JSON Schema defined (Schema tab),
    // validate the response body against it and surface the result as
    // TestResults so it shows up in the runner output alongside post-script
    // tests. Independent of `req.contract`. Run against the unmasked body —
    // PII patterns can include keys the schema requires; masking would
    // produce a false negative.
    const schemaTestResults = !response.error
      ? buildSchemaTestResults(req.schema, scriptResponse.body)
      : [];

    // ── Post-request script ───────────────────────────────────────────────────
    let postTestResults: TestResult[] = [];
    let postConsole: string[] = [];
    let postError: string | undefined;

    if (req.postRequestScript?.trim() && !response.error) {
      const result = await runScript(interpolate(req.postRequestScript, vars), {
        envVars:        { ...updatedEnvVars },
        collectionVars: { ...updatedCollectionVars },
        globals:        { ...updatedGlobals },
        localVars:      { ...localVars },
        // Pass the *unmasked* response so the script can extract real values
        // (tokens, ids, …). The displayed `response` keeps the redacted copy.
        response: scriptResponse,
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

    // If the HTTP response was a 4xx/5xx and the user has NO tests at all,
    // surface a synthetic failed result so the user notices. But if the user
    // wrote tests and they all passed, trust them — they intentionally tested
    // for that status code (e.g. negative tests expecting 422).
    const combinedTestResults: TestResult[] = [...schemaTestResults, ...postTestResults];
    if (
      !response.error &&
      response.status >= 400 &&
      combinedTestResults.length === 0
    ) {
      combinedTestResults.push({
        name:   `HTTP status ${response.status} ${response.statusText}`.trim(),
        passed: false,
        error:  `Request returned ${response.status} - no assertion was defined to verify the status code.`,
      });
    }

    const scriptResult: ScriptExecutionMeta = {
      testResults:          combinedTestResults,
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
  handleIpc(ipc, IPC.script.runHook, async (
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
