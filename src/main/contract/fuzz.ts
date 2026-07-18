// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// ─── Spec-driven fuzzing orchestrator ─────────────────────────────────────────
//
// Generates malformed variants of each request's JSON body (from the OpenAPI
// spec's requestBody schema, or from the request's own body when no spec is
// given), sends them to the provider, and judges the responses. Single-fault:
// each case mutates exactly one field, so a finding names one cause.
//
// Reuses the shared request-execution core (auth, proxy, TLS, interpolation)
// and the provider-verifier's spec loading + operation matching, so a fuzz run
// behaves like the rest of the contract stack.

import Ajv from 'ajv';
import type { ProxyAgent, Agent } from 'undici';
import type {
  ApiRequest, FuzzReport, FuzzTargetResult, FuzzFinding, FuzzOracle, FuzzCaseTrace, KeyValuePair,
} from '../../shared/types';
import { interpolate, buildUrl, buildDynamicVars, mergeVars } from '../interpolation';
import { buildDispatcher, performHttpExchange } from '../request-exec';
import { loadSpec, findOperation, resolveSchema } from './provider-verifier';
import { rebaseUrl } from './provider-live-verifier';
import {
  buildBaseline, mutate, inferSchema, makeRng, mutateQueryParams,
  type JsonSchema, type QueryParamSchema,
} from './fuzz-gen';

/** Deterministic shuffle + take, so a seed reproduces the same sampled cases. */
function sampleApplied<T>(arr: T[], n: number, rng: () => number): T[] {
  if (arr.length <= n) return arr;
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

const ajv = new Ajv({ allErrors: true, strict: false });

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface FuzzOptions {
  requests: ApiRequest[]
  envVars: Record<string, string>
  collectionVars?: Record<string, string>
  specUrl?: string
  specPath?: string
  /** Rebase every request onto this origin before sending. */
  providerBaseUrl?: string
  /** Strip this base URL from request URLs before matching spec paths. */
  requestBaseUrl?: string
  casesPerOperation?: number
  seed?: number
  /** Fuzz POST/PUT/PATCH/DELETE. Off by default: those send malformed writes. */
  includeWrites?: boolean
  /** Flag any response whose status the spec does not document. Noisy; opt-in. */
  strictStatus?: boolean
  /** Validate 2xx response bodies against the spec's documented schema. Opt-in. */
  checkResponses?: boolean
  /** Record every executed case (not just findings) in each target's `trace`. */
  trace?: boolean
  /** Progress callback (per operation), for the GUI. */
  onProgress?: (done: number, total: number, name: string) => void
}

interface SpecContext {
  requestBodySchema?: JsonSchema
  queryParams: QueryParamSchema[]
  documentedStatuses: number[]
  responseSchemas: Record<string, JsonSchema>
}

/** Pull the request-body schema and documented responses for an operation. */
function specContextFor(
  spec: Record<string, unknown> | null,
  req: ApiRequest,
  vars: Record<string, string>,
  requestBaseUrl?: string,
): SpecContext | null {
  if (!spec) return null;
  const url = req.url.replace(/\{\{([^}]+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`);
  const match = findOperation(spec, req.method, url, requestBaseUrl);
  if (!match) return null;

  const op = match.operation;
  const requestBody = resolveSchema(spec, op['requestBody']) as Record<string, unknown> | null;
  const jsonContent = (requestBody?.['content'] as Record<string, unknown>)?.['application/json'] as Record<string, unknown> | undefined;
  const requestBodySchema = jsonContent?.['schema']
    ? resolveSchema(spec, jsonContent['schema']) as JsonSchema
    : undefined;

  // Declared query parameters (with their schemas) for query fuzzing.
  const parameters = resolveSchema(spec, op['parameters'] ?? []) as unknown[];
  const queryParams: QueryParamSchema[] = [];
  for (const param of parameters) {
    const p = resolveSchema(spec, param) as Record<string, unknown>;
    if (p['in'] !== 'query' || typeof p['name'] !== 'string') continue;
    queryParams.push({
      name: p['name'],
      required: p['required'] === true,
      schema: p['schema'] ? resolveSchema(spec, p['schema']) as JsonSchema : undefined,
    });
  }

  const responses = (op['responses'] as Record<string, unknown>) ?? {};
  const documentedStatuses: number[] = [];
  const responseSchemas: Record<string, JsonSchema> = {};
  for (const [code, respVal] of Object.entries(responses)) {
    const n = Number(code);
    if (!Number.isNaN(n)) documentedStatuses.push(n);
    const resp = resolveSchema(spec, respVal) as Record<string, unknown> | null;
    const schema = ((resp?.['content'] as Record<string, unknown>)?.['application/json'] as Record<string, unknown> | undefined)?.['schema'];
    if (schema) responseSchemas[code] = resolveSchema(spec, schema) as JsonSchema;
  }
  return { requestBodySchema, queryParams, documentedStatuses, responseSchemas };
}

function statusDocumented(status: number, documented: number[]): boolean {
  if (documented.includes(status)) return true;
  // OpenAPI range codes like "2XX" are stored as NaN-filtered out; also accept
  // the common "default" catch-all by treating an empty list as "documented".
  if (documented.length === 0) return true;
  return false;
}

/** Judge one fuzzed response. Returns a finding, or null when it behaved.
 *  `bodyIsSchemaInvalid` is whether the mutated body actually violates the
 *  request schema (checked with ajv) — only then is a 2xx a validation gap. */
function judge(
  status: number,
  responseBody: string,
  bodyIsSchemaInvalid: boolean,
  spec: SpecContext | null,
  opts: FuzzOptions,
): { oracle: FuzzOracle; message: string } | null {
  // 1. Server error on malformed input — the gold-standard finding. Always on.
  if (status >= 500) {
    return { oracle: 'never-5xx', message: `Server returned ${status} on a malformed request (should reject with 4xx, not crash)` };
  }
  // 2. Server accepted input that provably violates the schema. Only fires when
  //    ajv confirms the body is invalid, so valid-but-unusual inputs (empty or
  //    unicode strings with no minLength/pattern) are not false positives.
  if (spec && bodyIsSchemaInvalid && status >= 200 && status < 300) {
    return { oracle: 'accepted-invalid', message: `Server accepted a schema-invalid request with ${status} (missing input validation)` };
  }
  // 3. Undocumented status. Opt-in: many specs under-document error codes.
  if (opts.strictStatus && spec && !statusDocumented(status, spec.documentedStatuses)) {
    return { oracle: 'undocumented-status', message: `Response status ${status} is not documented in the spec for this operation` };
  }
  // 4. 2xx body must match the documented schema. Opt-in.
  if (opts.checkResponses && spec && status >= 200 && status < 300) {
    const schema = spec.responseSchemas[String(status)] ?? spec.responseSchemas['default'];
    if (schema) {
      try {
        const validate = ajv.compile(schema);
        if (!validate(JSON.parse(responseBody))) {
          return { oracle: 'response-schema', message: `2xx response body does not match the documented schema: ${ajv.errorsText(validate.errors)}` };
        }
      } catch { /* non-JSON 2xx against a JSON schema — ignore, not our finding */ }
    }
  }
  return null;
}

export type FuzzRunResult = FuzzReport;

export async function runFuzz(opts: FuzzOptions): Promise<FuzzRunResult> {
  const spec = (opts.specUrl || opts.specPath)
    ? await loadSpec(opts.specUrl, opts.specPath) as Record<string, unknown>
    : null;
  const seed = opts.seed ?? 1;
  const casesPerOp = opts.casesPerOperation ?? 40;
  const vars = mergeVars(opts.envVars, opts.collectionVars ?? {}, {}, {}, await buildDynamicVars());

  const dispatcher: ProxyAgent | Agent | undefined = await buildDispatcher(undefined, undefined);

  const start = Date.now();
  const results: FuzzTargetResult[] = [];
  let totalCases = 0;
  let totalFindings = 0;
  let skippedWrites = 0;
  let skippedNoBody = 0;

  const active = opts.requests.filter(r => !r.disabled);
  let done = 0;

  for (const req of active) {
    opts.onProgress?.(done++, active.length, req.name);

    if (WRITE_METHODS.has(req.method) && !opts.includeWrites) {
      skippedWrites++;
      continue;
    }

    // Baseline body + schema: spec first, else the request's own JSON body.
    // Absent for GET-style requests, which are still fuzzed on their query params.
    const specCtx = specContextFor(spec, req, vars, opts.requestBaseUrl);
    let baselineBody: unknown;
    let bodySchema: JsonSchema | undefined;

    if (specCtx?.requestBodySchema) {
      bodySchema = specCtx.requestBodySchema;
      baselineBody = buildBaseline(bodySchema, makeRng(seed));
    } else if (req.body.mode === 'json' && req.body.json?.trim()) {
      try {
        baselineBody = JSON.parse(interpolate(req.body.json, vars));
        bodySchema = inferSchema(baselineBody);
      } catch { /* unparseable body: fall through to query-only fuzzing */ }
    }
    const hasBody = bodySchema !== undefined;
    const baselineBodyJson = hasBody ? JSON.stringify(baselineBody) : undefined;

    // Baseline query params: the request's enabled params, plus any required
    // spec query params that are missing (generated valid), so the "omit
    // required" mutation has something to omit.
    const baselineParams: KeyValuePair[] = req.params.filter(p => p.enabled && p.key).map(p => ({ ...p }));
    for (const qp of specCtx?.queryParams ?? []) {
      if (qp.required && !baselineParams.some(p => p.key === qp.name)) {
        baselineParams.push({ key: qp.name, value: String(buildBaseline(qp.schema, makeRng(seed)) ?? '1'), enabled: true });
      }
    }
    const canFuzzQuery = baselineParams.length > 0 || (specCtx?.queryParams.length ?? 0) > 0;

    if (!hasBody && !canFuzzQuery) {
      skippedNoBody++;
      continue;
    }

    // One applied case = one single-fault mutation, of either the body or the
    // query string. The other half stays at its valid baseline.
    interface Applied { mutation: FuzzFinding['mutation']; bodyJson?: string; params: KeyValuePair[]; bodyValue?: unknown; isBody: boolean }
    const applied: Applied[] = [];
    if (hasBody) {
      for (const c of mutate(baselineBody, bodySchema, 'body')) {
        applied.push({ mutation: c.mutation, bodyJson: JSON.stringify(c.value), bodyValue: c.value, params: baselineParams, isBody: true });
      }
    }
    for (const c of mutateQueryParams(baselineParams, specCtx?.queryParams ?? [], 'query')) {
      applied.push({ mutation: c.mutation, bodyJson: baselineBodyJson, params: c.params, isBody: false });
    }

    const cases = sampleApplied(applied, casesPerOp, makeRng(seed + 1));
    const findings: FuzzFinding[] = [];
    const trace: FuzzCaseTrace[] | undefined = opts.trace ? [] : undefined;

    // Validate mutated bodies against the request schema (spec mode only) so the
    // accepted-invalid oracle fires only on provably-invalid input.
    const validateBody = (specCtx?.requestBodySchema)
      ? (() => { try { return ajv.compile(specCtx.requestBodySchema); } catch { return null; } })()
      : null;

    for (const c of cases) {
      const fuzzReq: ApiRequest = {
        ...req,
        params: c.params,
        body: c.bodyJson !== undefined ? { mode: 'json', json: c.bodyJson } : req.body,
      };
      const resolvedUrl = rebaseUrl(buildUrl(fuzzReq.url, fuzzReq.params, vars), opts.providerBaseUrl);

      let sentSnapshot: FuzzFinding['request'] = { method: req.method, url: resolvedUrl, headers: {} };
      try {
        const ex = await performHttpExchange({
          req: fuzzReq, vars, resolvedUrl, dispatcher,
          onSent: s => { sentSnapshot = { method: s.method, url: s.url, headers: s.headers, body: s.body }; },
        });
        // accepted-invalid only applies to body cases with a known-invalid body.
        const bodyIsSchemaInvalid = c.isBody && validateBody ? !validateBody(c.bodyValue) : false;
        const verdict = judge(ex.status, ex.responseBody, bodyIsSchemaInvalid, specCtx, opts);
        if (verdict) {
          findings.push({
            oracle: verdict.oracle,
            message: verdict.message,
            status: ex.status,
            mutation: c.mutation,
            request: sentSnapshot,
            responseSample: ex.responseBody.slice(0, 400),
          });
        }
        trace?.push({
          mutation: c.mutation,
          status: ex.status,
          finding: Boolean(verdict),
          request: { method: sentSnapshot.method, url: sentSnapshot.url, body: sentSnapshot.body },
          responseSample: ex.responseBody.slice(0, 2000),
        });
      } catch (err) {
        // Transport errors (connection refused, timeout) are not API bugs; the
        // provider might simply be down. Report as a finding only when it looks
        // like the server crashed the connection mid-response.
        const msg = err instanceof Error ? err.message : String(err);
        const dropped = /socket hang up|ECONNRESET|other side closed/i.test(msg);
        if (dropped) {
          findings.push({
            oracle: 'never-5xx',
            message: `Connection dropped on a malformed request: ${msg}`,
            status: 0,
            mutation: c.mutation,
            request: sentSnapshot,
          });
        }
        trace?.push({
          mutation: c.mutation,
          status: 0,
          finding: dropped,
          request: { method: sentSnapshot.method, url: sentSnapshot.url, body: sentSnapshot.body },
          responseSample: `(transport error) ${msg}`.slice(0, 300),
        });
      }
    }

    totalCases += cases.length;
    totalFindings += findings.length;
    results.push({
      requestId: req.id,
      requestName: req.name,
      method: req.method,
      url: rebaseUrl(buildUrl(req.url, req.params, vars), opts.providerBaseUrl),
      cases: cases.length,
      findings,
      trace,
    });
  }

  opts.onProgress?.(active.length, active.length, 'done');

  return {
    inputSource: spec ? 'spec' : 'request',
    oracleUsesContracts: false,
    seed,
    totalCases,
    totalFindings,
    results,
    durationMs: Date.now() - start,
    skippedWrites,
    skippedNoBody,
  };
}
