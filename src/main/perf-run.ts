// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Shared performance-run orchestration: resolve a plan's target (single
// request, a collection/folder sequence, or a visual flow) into a per-iteration
// iterate(), derive the load schedule, run the scheduler, and evaluate
// thresholds. Used by both the desktop IPC handler and the `perf` CLI, so a run
// behaves identically in the app and in CI.

import type { ApiRequest, Collection, Environment, Flow, PerfPlan, PerfProgress, PerfResult, SecretsSettings } from '../shared/types';
import { runPerfTest, type PerfIterate, type PerfSchedule, type PerfStepSample } from './perf-runner';
import { deriveLoad, evaluateThresholds } from '../shared/perf-stages';
import { performHttpExchange, buildDispatcher, applyRequestDefaults, executeRunnerRequest, type ProxyConfig, type TlsConfig } from './request-exec';
import { interpolate, buildUrl, mergeVars, buildDynamicVars, buildEnvVars } from './interpolation';
import { createGrpcInvoker, type GrpcInvoker } from './grpc-invoke';
import { runFlow, type FlowEngineDeps } from '../shared/flow-engine';
import { normalizeFlow } from '../shared/flow-blocks';
import { resolveInheritedAuthAndHeaders, authIsConfigured, buildRunPlan } from '../shared/request-collection';
import { runScript, evaluateExpression } from './script-runner';
import { getGlobals } from './globals-store';

export interface PerfRunPayload {
  plan: PerfPlan
  // request target
  request?: ApiRequest
  vars?: Record<string, string>
  // sequence target (collection / folder run in order)
  collection?: Collection
  // flow target
  flow?: Flow
  flows?: Flow[]
  collections?: Collection[]
  environment?: Environment | null
  globals?: Record<string, string>
  proxy?: ProxyConfig
  tls?: TlsConfig
  /** Env vars already resolved in the main process (so a worker that runs this
   *  never has to touch the OS keychain). When set, buildEnvVars is skipped. */
  resolvedEnvVars?: Record<string, string>
  /** External secret-manager config, so a worker can resolve inline {{vault:…}}
   *  references (HTTP-based providers) without the main process. */
  secretsConfig?: SecretsSettings
}

async function buildFlowDeps(payload: PerfRunPayload): Promise<{ deps: FlowEngineDeps; flow: Flow; envVars: Record<string, string>; globals: Record<string, string> }> {
  const envVars = payload.resolvedEnvVars ?? await buildEnvVars(payload.environment ?? null);
  const globals = { ...payload.globals, ...getGlobals() };
  const dispatcher = await buildDispatcher(payload.proxy, payload.tls);
  const flow = normalizeFlow(payload.flow!);
  const flows = (payload.flows ?? []).map(normalizeFlow);
  const colById = new Map<string, Collection>((payload.collections ?? []).map(c => [c.id, c]));

  const deps: FlowEngineDeps = {
    runRequest: async (ref, input) => {
      const col = colById.get(ref.collectionId);
      const original = col?.requests[ref.requestId];
      if (!col || !original) return null;
      const req = JSON.parse(JSON.stringify(original)) as ApiRequest;
      const inherited = resolveInheritedAuthAndHeaders(original.id, col);
      if (!authIsConfigured(req.auth) && inherited.auth && inherited.auth.type !== 'none') req.auth = inherited.auth;
      const inheritedHeaders = inherited.headers.filter(h => h.enabled && h.key);
      if (inheritedHeaders.length) req.headers = [...inheritedHeaders, ...(req.headers ?? [])];
      const { result, updatedEnvVars, updatedCollectionVars, updatedGlobals, updatedLocalVars } = await executeRunnerRequest({
        req,
        collectionVars: { ...(col.collectionVariables ?? {}), ...input.collectionVars },
        envVars: input.envVars, globals: input.globals, localVars: input.localVars,
        dispatcher, piiMaskPatterns: [], proxy: payload.proxy, tls: payload.tls,
      });
      const rr = result.receivedResponse;
      const response = rr ? { status: rr.status, statusText: rr.statusText, headers: rr.headers, body: rr.body, bodySize: rr.body?.length ?? 0, durationMs: result.durationMs ?? 0 } : null;
      return {
        envVars: updatedEnvVars, collectionVars: updatedCollectionVars, globals: updatedGlobals, localVars: updatedLocalVars,
        response, status: result.status, httpStatus: result.httpStatus, durationMs: result.durationMs,
        error: result.error, testResults: result.testResults, name: result.name, method: result.method, resolvedUrl: result.resolvedUrl,
      };
    },
    runScript: async (code, input) => {
      const out = await runScript(code, { envVars: input.envVars, collectionVars: input.collectionVars, globals: input.globals, localVars: input.localVars, response: input.response ?? undefined, piiMaskPatterns: [], data: input.data });
      return { envVars: out.updatedEnvVars, collectionVars: out.updatedCollectionVars, globals: out.updatedGlobals, localVars: out.updatedLocalVars, testResults: out.testResults, consoleOutput: out.consoleOutput, error: out.error };
    },
    evalExpression: async (code, input) => {
      const out = await evaluateExpression(code, { envVars: input.envVars, collectionVars: input.collectionVars, globals: input.globals, localVars: input.localVars, response: input.response ?? undefined, piiMaskPatterns: [], data: input.data });
      return { envVars: out.updatedEnvVars, collectionVars: out.updatedCollectionVars, globals: out.updatedGlobals, localVars: out.updatedLocalVars, value: out.value, consoleOutput: out.consoleOutput, error: out.error };
    },
    resolveFlow: (flowId) => flows.find(f => f.id === flowId) ?? null,
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  };
  return { deps, flow, envVars, globals };
}

export async function runPerfPlan(payload: PerfRunPayload, onProgress?: (p: PerfProgress) => void): Promise<PerfResult> {
  const plan = payload.plan;
  const load = deriveLoad(plan);
  const schedule: PerfSchedule = {
    ...load,
    mode: plan.target.kind,
    pattern: plan.pattern,
    timeoutMs: plan.timeoutSec > 0 ? plan.timeoutSec * 1000 : undefined,
    thinkMinMs: Math.max(0, (plan.thinkTime?.minSec ?? 0)) * 1000,
    thinkMaxMs: Math.max(0, (plan.thinkTime?.maxSec ?? 0)) * 1000,
  };

  let iterate: PerfIterate;
  let grpcInvoker: GrpcInvoker | undefined;
  if (plan.target.kind === 'request') {
    if (!payload.request) throw new Error('No request selected for this plan');
    const req = payload.request;
    applyRequestDefaults(req);
    const dynamicVars = await buildDynamicVars();
    const vars = mergeVars(payload.vars ?? {}, {}, {}, {}, dynamicVars, {});

    // gRPC: each iteration is one unary call over a shared channel.
    if (req.protocol === 'grpc') {
      const g = req.body?.grpc;
      if (!g || !g.serviceName || !g.methodName) throw new Error('This gRPC request has no service/method configured');
      const ip = (s?: string) => interpolate(s ?? '', vars);
      const metadata: Record<string, string> = {};
      for (const m of g.metadata ?? []) if (m.enabled !== false && m.key) metadata[ip(m.key)] = ip(m.value);
      grpcInvoker = createGrpcInvoker({
        target: ip(req.url), protoSource: g.protoSource, protoPath: g.protoPath, importPaths: g.importPaths,
        serviceName: g.serviceName, methodName: g.methodName, message: ip(g.message ?? '{}'), metadata, plaintext: g.plaintext,
      });
      const label = `${g.serviceName}/${g.methodName}`;
      iterate = async () => {
        const t0 = Date.now();
        const r = await grpcInvoker!.invoke();
        const ms = Date.now() - t0;
        return { ok: r.ok, durationMs: ms, steps: [{ name: label, ok: r.ok, status: r.code, statusLabel: r.codeName, ms, bytes: r.bytes, error: r.error }] };
      };
    } else {
    const resolvedUrl = buildUrl(req.url, req.params, vars);
    const dispatcher = await buildDispatcher(payload.proxy, payload.tls);
    iterate = async (signal) => {
      const t0 = Date.now();
      try {
        const ex = await performHttpExchange({ req, vars, resolvedUrl, dispatcher, proxy: payload.proxy, tls: payload.tls, signal });
        return { ok: ex.status < 400, durationMs: ex.durationMs, steps: [{ name: req.name || 'request', ok: ex.status < 400, status: ex.status, ms: ex.durationMs, bytes: Buffer.byteLength(ex.responseBody ?? '', 'utf8') }] };
      } catch (e) {
        const msg = e instanceof Error ? (e.name === 'AbortError' ? 'Timeout' : e.message) : String(e);
        return { ok: false, durationMs: Date.now() - t0, steps: [{ name: req.name || 'request', ok: false, status: 0, ms: Date.now() - t0, bytes: 0, error: msg || 'Request failed' }] };
      }
    };
    }
  } else if (plan.target.kind === 'sequence') {
    if (!payload.collection) throw new Error('No collection selected for this plan');
    const collection = payload.collection;
    const envVars = payload.resolvedEnvVars ?? await buildEnvVars(payload.environment ?? null);
    const globals = { ...payload.globals, ...getGlobals() };
    const dispatcher = await buildDispatcher(payload.proxy, payload.tls);
    const items = buildRunPlan(collection, plan.target.folderId ?? null, []);
    if (items.length === 0) throw new Error('This collection or folder has no requests to run');
    iterate = async () => {
      let env = { ...envVars }; let col = { ...(collection.collectionVariables ?? {}) }; let glob = { ...globals }; let loc: Record<string, string> = {};
      const steps: PerfStepSample[] = [];
      const t0 = Date.now();
      for (const item of items) {
        const original = item.request;
        const req = JSON.parse(JSON.stringify(original)) as ApiRequest;
        const inherited = resolveInheritedAuthAndHeaders(original.id, collection);
        if (!authIsConfigured(req.auth) && inherited.auth && inherited.auth.type !== 'none') req.auth = inherited.auth;
        const inheritedHeaders = inherited.headers.filter(h => h.enabled && h.key);
        if (inheritedHeaders.length) req.headers = [...inheritedHeaders, ...(req.headers ?? [])];
        const out = await executeRunnerRequest({
          req, collectionVars: col, envVars: env, globals: glob,
          localVars: { ...loc, ...(item.dataRow ?? {}) }, folderVars: item.folderVars,
          dispatcher, piiMaskPatterns: [], proxy: payload.proxy, tls: payload.tls,
        });
        env = out.updatedEnvVars; col = out.updatedCollectionVars; glob = out.updatedGlobals; loc = out.updatedLocalVars;
        const ok = out.result.status === 'passed' || out.result.status === 'skipped';
        if (!item.isHook) steps.push({ name: original.name, ok, status: out.result.httpStatus ?? 0, ms: out.result.durationMs ?? 0, bytes: out.result.receivedResponse?.body?.length ?? 0, error: ok ? undefined : out.result.error });
      }
      const ok = steps.every(s => s.ok);
      return { ok, durationMs: Date.now() - t0, steps: steps.length ? steps : [{ name: '(sequence)', ok, status: 0, ms: Date.now() - t0, bytes: 0 }] };
    };
  } else {
    if (!payload.flow) throw new Error('No flow selected for this plan');
    const { deps, flow, envVars, globals } = await buildFlowDeps(payload);
    iterate = async () => {
      const summary = await runFlow(flow, deps, { envVars, globals });
      const steps: PerfStepSample[] = summary.blocks
        .filter(b => b.type === 'request')
        .map(b => ({
          name: b.label || b.resolvedUrl || b.blockId,
          ok: b.status === 'passed' || b.status === 'done',
          status: b.httpStatus ?? 0,
          ms: b.durationMs ?? 0,
          bytes: b.http?.bodySize ?? 0,
          error: b.status === 'error' || b.status === 'failed' ? (b.error || 'Step failed') : undefined,
        }));
      const ok = summary.failed === 0 && summary.errors === 0;
      return { ok, durationMs: summary.durationMs, steps: steps.length ? steps : [{ name: '(flow)', ok, status: 0, ms: summary.durationMs, bytes: 0, error: ok ? undefined : 'Flow failed' }] };
    };
  }

  let res;
  try {
    res = await runPerfTest(schedule, iterate, onProgress);
  } finally {
    grpcInvoker?.close();
  }
  const thresholds = evaluateThresholds(res, plan.thresholds ?? []);
  return { ...res, thresholds, passed: thresholds.length ? thresholds.every(t => t.passed) : true };
}
