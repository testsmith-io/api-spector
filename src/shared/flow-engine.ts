// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// The flow execution engine — a Postman-Flows-style dataflow interpreter.
//
// It walks the graph from the `start` block, following edges out of each
// block's active output port(s): an `if` fires `true` or `false`, a `forEach`
// runs its `body` once per item then continues on `done`, a `merge` (the "or"
// block) fires on the first incoming branch to arrive. All side effects —
// sending requests, running sp.* scripts, evaluating expressions, sleeping —
// are injected via `deps`, so this module is pure orchestration: unit-testable
// with stubs, and reused verbatim by the desktop UI (IPC) and the `flow` CLI.

import type { Flow, FlowBlock, FlowBlockType, FlowRequestRef } from './types/flow';
import type { ResponsePayload, RunStatus, TestResult } from './types';
import { BLOCK_SPECS } from './flow-blocks';

// ─── Scopes + injected deps ──────────────────────────────────────────────────

export interface EngineScopes {
  envVars: Record<string, string>
  collectionVars: Record<string, string>
  globals: Record<string, string>
  localVars: Record<string, string>
}

export interface EngineScriptInput extends EngineScopes {
  response: ResponsePayload | null
  /** Rich data channel (loop items, evaluate outputs, collected lists). */
  data: Record<string, unknown>
}

export interface EngineScriptResult extends EngineScopes {
  value?: unknown
  testResults?: TestResult[]
  consoleOutput?: string[]
  error?: string
}

export interface EngineRequestResult extends EngineScopes {
  response: ResponsePayload | null
  status: RunStatus
  httpStatus?: number
  durationMs?: number
  error?: string
  testResults?: TestResult[]
  name: string
  method: string
  resolvedUrl: string
  /** The request actually sent (resolved URL/headers/body) — for the run log. */
  sentRequest?: { method: string; url: string; headers: Record<string, string>; body?: string }
}

export interface FlowEngineDeps {
  /** Resolve + send a request block; null if the ref can't be resolved. */
  runRequest(ref: FlowRequestRef, input: EngineScriptInput): Promise<EngineRequestResult | null>
  /** Run a sp.* script (evaluate / validate). */
  runScript(code: string, input: EngineScriptInput): Promise<EngineScriptResult>
  /** Evaluate a JS expression and return its value (if / condition / forEach). */
  evalExpression(code: string, input: EngineScriptInput): Promise<EngineScriptResult>
  /** Resolve another flow by id (for sub-flow blocks). */
  resolveFlow(flowId: string): Flow | null
  sleep(ms: number): Promise<void>
  /** Optional {{var}} interpolation for log/display text fallback. */
  interpolate?(str: string, vars: Record<string, string>): string
  onEvent?(evt: FlowRunEvent): void
  maxSteps?: number
}

// ─── Events + results ──────────────────────────────────────────────────────

export type FlowBlockStatus = 'running' | 'passed' | 'failed' | 'error' | 'done' | 'skipped'

export interface FlowRunEvent {
  kind: 'block-start' | 'block-result' | 'log' | 'display' | 'edge'
  blockId: string
  blockType: FlowBlockType
  /** For 'edge' events: the ids of the edges traversed out of this block. */
  edgeIds?: string[]
  status?: FlowBlockStatus
  httpStatus?: number
  durationMs?: number
  error?: string
  message?: string
  display?: { as: string; value: unknown; label?: string }
  testResults?: TestResult[]
  iteration?: number
  /** Block label (custom or default) — for the run log. */
  label?: string
  /** Milliseconds since the run started — for the run log timeline. */
  atMs?: number
  /** Merged variable snapshot after the block ran (for the live Variables panel). */
  vars?: Record<string, string>
}

export interface FlowBlockRunRecord {
  blockId: string
  type: FlowBlockType
  label: string
  status: FlowBlockStatus
  httpStatus?: number
  durationMs?: number
  error?: string
  testResults?: TestResult[]
  iteration?: number
  method?: string
  resolvedUrl?: string
  message?: string
  /** display block: the value it rendered. */
  display?: unknown
  /** Milliseconds since the run started. */
  atMs?: number
  /**
   * For request blocks: the actual HTTP request sent and response received, so
   * a run can be inspected after the fact (especially failures) in the UI / CLI
   * report / cloud. Bodies are truncated to keep the stored summary small.
   */
  http?: {
    reqHeaders?: Record<string, string>
    reqBody?: string
    statusText?: string
    resHeaders?: Record<string, string>
    resBody?: string
    bodySize?: number
    /** True when reqBody or resBody was clipped. */
    truncated?: boolean
  }
}

export interface FlowRunSummary {
  total: number
  passed: number
  failed: number
  errors: number
  durationMs: number
  blocks: FlowBlockRunRecord[]
  /** Final variable scopes after the run (for the Variables panel / CLI). */
  variables?: EngineScopes
  /** Final rich data channel (loop items, collected lists, set objects). */
  data?: Record<string, unknown>
  /** Ids of every edge traversed during the run (the route taken). */
  traversedEdges?: string[]
}

export interface FlowRunOptions {
  envVars?: Record<string, string>
  collectionVars?: Record<string, string>
  globals?: Record<string, string>
  localVars?: Record<string, string>
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function toScalar(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function parseBody(body: string | undefined): unknown {
  if (body == null) return undefined;
  try { return JSON.parse(body); } catch { return body; }
}

// Cap a captured request/response body so the stored run summary stays small.
// Returns the (possibly clipped) string and whether it was clipped.
const MAX_CAPTURED_BODY = 20_000;
function clipBody(body: string | undefined): { text?: string; clipped: boolean } {
  if (body == null) return { clipped: false };
  if (body.length <= MAX_CAPTURED_BODY) return { text: body, clipped: false };
  return { text: body.slice(0, MAX_CAPTURED_BODY) + `\n… [truncated ${body.length - MAX_CAPTURED_BODY} more chars]`, clipped: true };
}

// ─── Engine ──────────────────────────────────────────────────────────────

export async function runFlow(
  flow: Flow,
  deps: FlowEngineDeps,
  options: FlowRunOptions = {},
): Promise<FlowRunSummary> {
  const startedAt = Date.now();
  const maxSteps = deps.maxSteps ?? 10_000;

  const ctx: EngineScriptInput = {
    envVars: { ...(options.envVars ?? {}) },
    collectionVars: { ...(options.collectionVars ?? {}) },
    globals: { ...(options.globals ?? {}) },
    localVars: { ...(options.localVars ?? {}) },
    response: null,
    data: {},
  };

  const summary: FlowRunSummary = { total: 0, passed: 0, failed: 0, errors: 0, durationMs: 0, blocks: [] };
  const state = { steps: 0 };
  const relTime = (): number => Date.now() - startedAt;

  // Record + announce the edges traversed out of a block. Kept in a set as well
  // so the final summary carries the complete route even if a streamed `edge`
  // event races the run's completion on the renderer side.
  const takenEdges = new Set<string>();
  const emitEdges = (blockId: string, blockType: FlowBlockType, ids: string[]): void => {
    if (ids.length === 0) return;
    for (const id of ids) takenEdges.add(id);
    deps.onEvent?.({ kind: 'edge', blockId, blockType, edgeIds: ids, atMs: relTime() });
  };

  const scriptInput = (): EngineScriptInput => ({
    envVars: ctx.envVars,
    collectionVars: ctx.collectionVars,
    globals: ctx.globals,
    localVars: ctx.localVars,
    response: ctx.response,
    data: ctx.data,
  });

  const applyScopes = (r: EngineScopes): void => {
    ctx.envVars = r.envVars;
    ctx.collectionVars = r.collectionVars;
    ctx.globals = r.globals;
    ctx.localVars = r.localVars;
  };

  const mergedVars = (): Record<string, string> => ({
    ...ctx.globals, ...ctx.collectionVars, ...ctx.envVars, ...ctx.localVars,
  });

  const record = (
    block: FlowBlock,
    status: FlowBlockStatus,
    extra: Partial<FlowBlockRunRecord> = {},
  ): void => {
    const rec: FlowBlockRunRecord = {
      blockId: block.id,
      type: block.type,
      label: block.label || BLOCK_SPECS[block.type].label,
      status,
      atMs: relTime(),
      ...extra,
    };
    summary.blocks.push(rec);
    summary.total++;
    if (status === 'passed') summary.passed++;
    else if (status === 'failed') summary.failed++;
    else if (status === 'error') summary.errors++;
    deps.onEvent?.({
      kind: 'block-result',
      blockId: block.id,
      blockType: block.type,
      label: rec.label,
      atMs: relTime(),
      status,
      httpStatus: extra.httpStatus,
      durationMs: extra.durationMs,
      error: extra.error,
      testResults: extra.testResults,
      iteration: extra.iteration,
      vars: mergedVars(),
    });
  };

  // Resolve log/display message as a JS expression, falling back to {{var}}
  // interpolation and then the literal string.
  const renderMessage = async (msg: string): Promise<unknown> => {
    const r = await deps.evalExpression(msg, scriptInput());
    applyScopes(r);
    if (!r.error) return r.value;
    if (deps.interpolate) return deps.interpolate(msg, mergedVars());
    return msg;
  };

  // Run a single flow (invoked recursively for sub-flows). `stack` guards
  // against sub-flow recursion. nodes/edges are per-flow; ctx/summary are shared.
  async function runOne(current: Flow, stack: string[]): Promise<void> {
    const nodeById = new Map(current.nodes.map(n => [n.id, n]));
    const outEdges = (block: FlowBlock, port: string) =>
      current.edges.filter(e => {
        if (e.source !== block.id) return false;
        const sp = e.sourcePort ?? 'out';
        if (sp === port) return true;
        // A request's legacy portless/'out' edge is its success path.
        return block.type === 'request' && port === 'success' && sp === 'out';
      });

    async function execBlock(block: FlowBlock, iteration?: number): Promise<string[]> {
      const cfg = block.config ?? {};
      const label = block.label || BLOCK_SPECS[block.type].label;

      switch (block.type) {
        case 'start': return ['out'];
        case 'end': return [];
        case 'merge': return ['out'];

        case 'log': {
          const value = await renderMessage(cfg.message ?? '');
          const message = toScalar(value);
          deps.onEvent?.({ kind: 'log', blockId: block.id, blockType: block.type, label, atMs: relTime(), message });
          record(block, 'done', { iteration, message });
          return ['out'];
        }

        case 'display': {
          const value = await renderMessage(cfg.message ?? '');
          deps.onEvent?.({
            kind: 'display', blockId: block.id, blockType: block.type, label, atMs: relTime(),
            display: { as: cfg.as ?? 'json', value, label },
          });
          record(block, 'done', { iteration, display: value });
          return ['out'];
        }

        case 'delay': {
          const ms = Math.max(0, cfg.delayMs ?? 0);
          deps.onEvent?.({ kind: 'block-start', blockId: block.id, blockType: block.type, status: 'running', iteration });
          const t0 = Date.now();
          await deps.sleep(ms);
          record(block, 'done', { iteration, durationMs: Date.now() - t0 });
          return ['out'];
        }

        case 'evaluate': {
          deps.onEvent?.({ kind: 'block-start', blockId: block.id, blockType: block.type, status: 'running', iteration });
          const r = await deps.runScript(cfg.script ?? '', scriptInput());
          applyScopes(r);
          record(block, r.error ? 'error' : 'done', { iteration, error: r.error, testResults: r.testResults });
          return ['out'];
        }

        case 'validate': {
          deps.onEvent?.({ kind: 'block-start', blockId: block.id, blockType: block.type, status: 'running', iteration });
          const r = await deps.runScript(cfg.script ?? '', scriptInput());
          applyScopes(r);
          const failed = Boolean(r.error) || (r.testResults ?? []).some(t => !t.passed);
          record(block, r.error ? 'error' : failed ? 'failed' : 'passed', { iteration, error: r.error, testResults: r.testResults });
          return [failed ? 'fail' : 'pass'];
        }

        case 'setVar': {
          const r = await deps.evalExpression(cfg.valueExpression ?? 'undefined', scriptInput());
          applyScopes(r);
          const name = cfg.varName;
          if (name) {
            const scalar = toScalar(r.value);
            switch (cfg.scope ?? 'local') {
              case 'collection': ctx.collectionVars[name] = scalar; break;
              case 'environment': ctx.envVars[name] = scalar; break;
              case 'global': ctx.globals[name] = scalar; break;
              default: ctx.localVars[name] = scalar; ctx.data[name] = r.value; break;
            }
          }
          record(block, r.error ? 'error' : 'done', { iteration, error: r.error });
          return ['out'];
        }

        case 'if': {
          const r = await deps.evalExpression(cfg.expression ?? 'false', scriptInput());
          applyScopes(r);
          if (r.error) { record(block, 'error', { iteration, error: r.error }); return ['false']; }
          record(block, 'done', { iteration });
          return [r.value ? 'true' : 'false'];
        }

        case 'condition': {
          for (const c of cfg.cases ?? []) {
            const r = await deps.evalExpression(c.expression, scriptInput());
            applyScopes(r);
            if (!r.error && r.value) { record(block, 'done', { iteration }); return [c.id]; }
          }
          record(block, 'done', { iteration });
          return ['else'];
        }

        case 'request': {
          if (!cfg.ref) { record(block, 'error', { iteration, error: 'No request selected' }); return ['fail']; }
          deps.onEvent?.({ kind: 'block-start', blockId: block.id, blockType: block.type, status: 'running', iteration });
          const r = await deps.runRequest(cfg.ref, scriptInput());
          if (!r) { record(block, 'error', { iteration, error: 'Linked request not found' }); return ['fail']; }
          applyScopes(r);
          ctx.response = r.response;
          // success = ran OK (2xx/3xx, assertions passed, or nothing to assert).
          const ok = r.status === 'passed' || r.status === 'skipped';
          const reqStatus: FlowBlockStatus = r.status === 'skipped' ? 'done' : r.status === 'pending' ? 'running' : r.status;
          const reqBody = clipBody(r.sentRequest?.body);
          const resBody = clipBody(r.response?.body);
          record(block, reqStatus, {
            iteration, httpStatus: r.httpStatus, durationMs: r.durationMs,
            error: r.error, testResults: r.testResults, method: r.method, resolvedUrl: r.resolvedUrl,
            http: {
              reqHeaders: r.sentRequest?.headers,
              reqBody: reqBody.text,
              statusText: r.response?.statusText,
              resHeaders: r.response?.headers,
              resBody: resBody.text,
              bodySize: r.response?.bodySize,
              truncated: reqBody.clipped || resBody.clipped,
            },
          });
          return [ok ? 'success' : 'fail'];
        }

        case 'subflow': {
          const sub = cfg.flowId ? deps.resolveFlow(cfg.flowId) : null;
          if (!sub) { record(block, 'error', { iteration, error: 'Linked flow not found' }); return ['out']; }
          if (stack.includes(sub.id)) { record(block, 'error', { iteration, error: 'Recursive sub-flow blocked' }); return ['out']; }
          deps.onEvent?.({ kind: 'block-start', blockId: block.id, blockType: block.type, status: 'running', iteration });
          await runOne(sub, [...stack, sub.id]);
          record(block, 'done', { iteration });
          return ['out'];
        }

        case 'forEach': {
          const r = await deps.evalExpression(cfg.expression ?? '[]', scriptInput());
          applyScopes(r);
          if (r.error) { record(block, 'error', { iteration, error: r.error }); return ['done']; }
          const list = Array.isArray(r.value) ? r.value : r.value == null ? [] : [r.value];
          const itemVar = cfg.itemVar || 'item';
          const indexVar = cfg.indexVar || 'index';
          const bodyEdges = outEdges(block, 'body');
          emitEdges(block.id, block.type, bodyEdges.map(e => e.id));
          const bodyTargets = bodyEdges.map(e => e.target);
          for (let i = 0; i < list.length; i++) {
            ctx.data[itemVar] = list[i];
            ctx.data[indexVar] = i;
            ctx.localVars[itemVar] = toScalar(list[i]);
            ctx.localVars[indexVar] = String(i);
            await walk(bodyTargets, i);
          }
          record(block, 'done', { iteration });
          return ['done'];
        }

        case 'repeat': {
          const n = Math.max(0, Math.floor(cfg.count ?? 0));
          const indexVar = cfg.indexVar || 'index';
          const bodyEdges = outEdges(block, 'body');
          emitEdges(block.id, block.type, bodyEdges.map(e => e.id));
          const bodyTargets = bodyEdges.map(e => e.target);
          for (let i = 0; i < n; i++) {
            ctx.data[indexVar] = i;
            ctx.localVars[indexVar] = String(i);
            await walk(bodyTargets, i);
          }
          record(block, 'done', { iteration });
          return ['done'];
        }

        case 'collect': {
          const intoVar = cfg.intoVar || 'results';
          let value: unknown;
          if (cfg.valueExpression) {
            const r = await deps.evalExpression(cfg.valueExpression, scriptInput());
            applyScopes(r);
            value = r.value;
          } else {
            value = ctx.response ? parseBody(ctx.response.body) : undefined;
          }
          const arr = Array.isArray(ctx.data[intoVar]) ? (ctx.data[intoVar] as unknown[]) : [];
          arr.push(value);
          ctx.data[intoVar] = arr;
          ctx.localVars[intoVar] = JSON.stringify(arr);
          record(block, 'done', { iteration });
          return ['out'];
        }

        default:
          return ['out'];
      }
    }

    async function walk(startNodeIds: string[], iteration?: number): Promise<void> {
      const queue = [...startNodeIds];
      const firedMerges = new Set<string>();
      while (queue.length) {
        if (++state.steps > maxSteps) {
          throw new Error('Flow exceeded the step limit — check for an unbounded loop or merge cycle.');
        }
        const id = queue.shift()!;
        const block = nodeById.get(id);
        if (!block) continue;
        if (block.type === 'merge') {
          if (firedMerges.has(id)) continue; // first-wins
          firedMerges.add(id);
        }
        const ports = await execBlock(block, iteration);
        const takenIds: string[] = [];
        for (const port of ports) {
          for (const e of outEdges(block, port)) { queue.push(e.target); takenIds.push(e.id); }
        }
        emitEdges(id, block.type, takenIds);
      }
    }

    const startBlock = current.nodes.find(n => n.type === 'start');
    const roots = startBlock
      ? [startBlock.id]
      : current.nodes.filter(n => !current.edges.some(e => e.target === n.id)).map(n => n.id);
    await walk(roots);
  }

  // Seed the flow's declared input variables (Start block) into the local scope.
  const startInputs = flow.nodes.find(n => n.type === 'start')?.config?.inputs ?? [];
  for (const { key, value } of startInputs) {
    if (!key) continue;
    const resolved = deps.interpolate ? deps.interpolate(value, mergedVars()) : value;
    ctx.localVars[key] = resolved;
    ctx.data[key] = resolved;
  }

  await runOne(flow, [flow.id]);

  summary.durationMs = Date.now() - startedAt;
  summary.variables = {
    envVars: { ...ctx.envVars },
    collectionVars: { ...ctx.collectionVars },
    globals: { ...ctx.globals },
    localVars: { ...ctx.localVars },
  };
  summary.data = ctx.data;
  summary.traversedEdges = [...takenEdges];
  return summary;
}
