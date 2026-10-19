// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Static pre-run validation for flows. The engine only discovers problems like
// "no request selected", a dangling edge, or a recursive sub-flow once it hits
// them mid-run, which makes a failed run hard to understand. validateFlow walks
// the graph up front and returns a flat list of problems the editor surfaces
// (badge, Problems panel, per-block markers) so an author can fix a flow before
// running it. Pure — no engine, no renderer — so it is unit-tested and reused by
// the UI and, potentially, the CLI/cloud.

import type { Flow, FlowBlock, FlowRequestRef } from './types/flow';
import { BLOCK_SPECS, outputsFor } from './flow-blocks';

export type FlowProblemSeverity = 'error' | 'warning'

export interface FlowProblem {
  severity: FlowProblemSeverity
  /** Stable machine code for the kind of problem (also handy for tests). */
  code: string
  /** Human-readable, author-facing message. */
  message: string
  /** The offending block, when the problem is about one (lets the UI focus it). */
  blockId?: string
  /** The offending edge, when the problem is about a connection. */
  edgeId?: string
}

export interface FlowValidateContext {
  /** All workspace flows (including the one under validation) — for sub-flow
   *  existence and recursion checks. Omit to skip those checks. */
  flows?: Flow[]
  /** Whether a request ref still resolves to a saved request. Omit to skip. */
  requestExists?: (ref: FlowRequestRef) => boolean
}

function blockLabel(b: FlowBlock): string {
  return b.label || BLOCK_SPECS[b.type]?.label || b.type;
}

/** True if following sub-flow references from `fromId` can reach `targetId`. */
function subflowReaches(
  fromId: string,
  targetId: string,
  flowsById: Map<string, Flow>,
  stack: Set<string>,
): boolean {
  if (fromId === targetId) return true;
  if (stack.has(fromId)) return false;
  stack.add(fromId);
  const f = flowsById.get(fromId);
  if (!f) return false;
  for (const n of f.nodes ?? []) {
    if (n.type === 'subflow' && n.config?.flowId && subflowReaches(n.config.flowId, targetId, flowsById, stack)) {
      return true;
    }
  }
  return false;
}

/**
 * Validate a flow's structure and block configuration. Returns problems in a
 * stable order (errors first, then warnings), each optionally anchored to a
 * block or edge. An empty array means the flow is ready to run.
 */
export function validateFlow(flow: Flow, ctx: FlowValidateContext = {}): FlowProblem[] {
  const errors: FlowProblem[] = [];
  const warnings: FlowProblem[] = [];
  const nodes = flow.nodes ?? [];
  const edges = flow.edges ?? [];
  const byId = new Map(nodes.map(n => [n.id, n]));

  // ── Start block ────────────────────────────────────────────────────────────
  const starts = nodes.filter(n => n.type === 'start');
  if (starts.length === 0) {
    errors.push({ severity: 'error', code: 'no-start', message: 'The flow has no Start block, so it cannot run.' });
  } else {
    for (const extra of starts.slice(1)) {
      errors.push({ severity: 'error', code: 'multiple-start', blockId: extra.id, message: 'A flow can only have one Start block.' });
    }
  }

  // ── Edges: dangling targets + ports that no longer exist ────────────────────
  const outPorts = new Map<string, Set<string>>();   // source id -> ports actually wired
  const inDegree = new Map<string, number>();
  for (const e of edges) {
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (!src || !tgt) {
      errors.push({ severity: 'error', code: 'dangling-edge', edgeId: e.id, message: 'A connection points to a block that no longer exists.' });
      continue;
    }
    const ports = outputsFor(src).map(p => p.id);
    const port = e.sourcePort ?? (ports.length === 1 ? ports[0] : 'out');
    // Flag an edge leaving from a port the block no longer exposes (e.g. a
    // condition case was deleted) — it can never fire.
    if (ports.length > 0 && !ports.includes(port)) {
      warnings.push({ severity: 'warning', code: 'orphan-port', edgeId: e.id, blockId: src.id, message: `A connection leaves "${blockLabel(src)}" from a port that no longer exists; it will never fire.` });
    } else {
      const set = outPorts.get(e.source) ?? new Set<string>();
      set.add(port);
      outPorts.set(e.source, set);
    }
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  // ── Reachability from Start ─────────────────────────────────────────────────
  if (starts.length > 0) {
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      if (!byId.has(e.source) || !byId.has(e.target)) continue;
      const list = adj.get(e.source) ?? [];
      list.push(e.target);
      adj.set(e.source, list);
    }
    const seen = new Set<string>();
    const queue = starts.map(s => s.id);
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const t of adj.get(id) ?? []) queue.push(t);
    }
    for (const n of nodes) {
      if (n.type === 'start' || seen.has(n.id)) continue;
      warnings.push({ severity: 'warning', code: 'unreachable', blockId: n.id, message: `"${blockLabel(n)}" can't be reached from Start, so it never runs.` });
    }
  }

  // ── Per-block configuration ─────────────────────────────────────────────────
  const flowsById = new Map((ctx.flows ?? []).map(f => [f.id, f]));
  for (const n of nodes) {
    const cfg = n.config ?? {};
    switch (n.type) {
      case 'request':
        if (!cfg.ref || !cfg.ref.requestId) {
          errors.push({ severity: 'error', code: 'request-no-ref', blockId: n.id, message: `"${blockLabel(n)}" has no request selected.` });
        } else if (ctx.requestExists && !ctx.requestExists(cfg.ref)) {
          errors.push({ severity: 'error', code: 'request-missing', blockId: n.id, message: `"${blockLabel(n)}" points to a request that no longer exists.` });
        }
        break;
      case 'subflow':
        if (!cfg.flowId) {
          errors.push({ severity: 'error', code: 'subflow-no-flow', blockId: n.id, message: `"${blockLabel(n)}" has no flow selected.` });
        } else if (ctx.flows && !flowsById.has(cfg.flowId)) {
          errors.push({ severity: 'error', code: 'subflow-missing', blockId: n.id, message: `"${blockLabel(n)}" points to a flow that no longer exists.` });
        } else if (ctx.flows && subflowReaches(cfg.flowId, flow.id, flowsById, new Set())) {
          errors.push({ severity: 'error', code: 'subflow-recursive', blockId: n.id, message: `"${blockLabel(n)}" leads back to this flow — the run blocks infinite recursion.` });
        }
        break;
      case 'forEach':
      case 'repeat':
        if (!outPorts.get(n.id)?.has('body')) {
          warnings.push({ severity: 'warning', code: 'loop-no-body', blockId: n.id, message: `"${blockLabel(n)}" has nothing wired to its body, so the loop runs nothing.` });
        }
        break;
      case 'merge':
        if ((inDegree.get(n.id) ?? 0) < 2) {
          warnings.push({ severity: 'warning', code: 'merge-one-input', blockId: n.id, message: `"${blockLabel(n)}" merges branches but has fewer than two inputs.` });
        }
        break;
      case 'condition':
        if (!cfg.cases || cfg.cases.length === 0) {
          warnings.push({ severity: 'warning', code: 'condition-no-cases', blockId: n.id, message: `"${blockLabel(n)}" has no cases, so every run takes the else path.` });
        }
        break;
    }
  }

  return [...errors, ...warnings];
}
