// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { validateFlow } from '../shared/flow-validate';
import type { Flow, FlowBlock, FlowEdge } from '../shared/types/flow';

let seq = 0;
const blk = (type: FlowBlock['type'], extra: Partial<FlowBlock> = {}): FlowBlock => ({
  id: extra.id ?? `b${seq++}`, type, position: { x: 0, y: 0 }, ...extra,
});
const edge = (source: string, target: string, sourcePort?: string): FlowEdge => ({
  id: `e${seq++}`, source, target, sourcePort,
});
const flow = (nodes: FlowBlock[], edges: FlowEdge[], id = 'flow1'): Flow => ({
  version: '1.0', id, name: id, nodes, edges,
});

const codes = (f: Flow, ctx = {}) => validateFlow(f, ctx).map(p => p.code);

describe('validateFlow', () => {
  it('passes a well-formed flow with no problems', () => {
    const s = blk('start', { id: 's' });
    const r = blk('request', { id: 'r', config: { ref: { collectionId: 'c', requestId: 'q' } } });
    const e = blk('end', { id: 'e' });
    const f = flow([s, r, e], [edge('s', 'r'), edge('r', 'e', 'success')]);
    expect(validateFlow(f, { requestExists: () => true })).toEqual([]);
  });

  it('flags a missing and a duplicate Start block', () => {
    expect(codes(flow([blk('end', { id: 'e' })], []))).toContain('no-start');
    const f = flow([blk('start', { id: 's1' }), blk('start', { id: 's2' })], []);
    expect(codes(f)).toContain('multiple-start');
  });

  it('errors on a request block with no request selected', () => {
    const f = flow([blk('start', { id: 's' }), blk('request', { id: 'r' })], [edge('s', 'r')]);
    expect(codes(f)).toContain('request-no-ref');
  });

  it('errors when a request ref no longer resolves', () => {
    const r = blk('request', { id: 'r', config: { ref: { collectionId: 'c', requestId: 'gone' } } });
    const f = flow([blk('start', { id: 's' }), r], [edge('s', 'r')]);
    expect(codes(f, { requestExists: () => false })).toContain('request-missing');
  });

  it('handles sub-flow: no flow, missing flow, and recursion', () => {
    const noFlow = flow([blk('start', { id: 's' }), blk('subflow', { id: 'sf' })], [edge('s', 'sf')]);
    expect(codes(noFlow, { flows: [noFlow] })).toContain('subflow-no-flow');

    const missing = flow([blk('start', { id: 's' }), blk('subflow', { id: 'sf', config: { flowId: 'nope' } })], [edge('s', 'sf')]);
    expect(codes(missing, { flows: [missing] })).toContain('subflow-missing');

    const selfRef = flow([blk('start', { id: 's' }), blk('subflow', { id: 'sf', config: { flowId: 'flow1' } })], [edge('s', 'sf')], 'flow1');
    expect(codes(selfRef, { flows: [selfRef] })).toContain('subflow-recursive');

    const a = flow([blk('start', { id: 'as' }), blk('subflow', { id: 'asf', config: { flowId: 'B' } })], [edge('as', 'asf')], 'A');
    const b = flow([blk('start', { id: 'bs' }), blk('subflow', { id: 'bsf', config: { flowId: 'A' } })], [edge('bs', 'bsf')], 'B');
    expect(codes(a, { flows: [a, b] })).toContain('subflow-recursive');
  });

  it('errors on a dangling edge to a removed block', () => {
    const f = flow([blk('start', { id: 's' })], [edge('s', 'ghost')]);
    expect(codes(f)).toContain('dangling-edge');
  });

  it('warns on an edge leaving a port that no longer exists', () => {
    // condition exposes its case ids + 'else'; an edge from a deleted case id orphans.
    const c = blk('condition', { id: 'c', config: { cases: [{ id: 'case1', label: 'ok', expression: 'true' }] } });
    const f = flow([blk('start', { id: 's' }), c, blk('end', { id: 'e' })], [edge('s', 'c'), edge('c', 'e', 'deletedCase')]);
    expect(codes(f)).toContain('orphan-port');
  });

  it('warns about an unreachable block', () => {
    const f = flow(
      [blk('start', { id: 's' }), blk('log', { id: 'reachable' }), blk('log', { id: 'island' })],
      [edge('s', 'reachable')],
    );
    const found = validateFlow(f);
    expect(found.find(p => p.code === 'unreachable')?.blockId).toBe('island');
  });

  it('warns when a loop has nothing wired to its body', () => {
    const fe = blk('forEach', { id: 'fe', config: { expression: '[]' } });
    const f = flow([blk('start', { id: 's' }), fe, blk('end', { id: 'e' })], [edge('s', 'fe'), edge('fe', 'e', 'done')]);
    expect(codes(f)).toContain('loop-no-body');
  });

  it('warns on a merge with fewer than two inputs', () => {
    const m = blk('merge', { id: 'm' });
    const f = flow([blk('start', { id: 's' }), m], [edge('s', 'm')]);
    expect(codes(f)).toContain('merge-one-input');
  });

  it('warns on a condition with no cases', () => {
    const c = blk('condition', { id: 'c', config: { cases: [] } });
    const f = flow([blk('start', { id: 's' }), c], [edge('s', 'c')]);
    expect(codes(f)).toContain('condition-no-cases');
  });

  it('orders errors before warnings', () => {
    // request-no-ref (error) + unreachable (warning) in one flow.
    const f = flow(
      [blk('start', { id: 's' }), blk('request', { id: 'r' }), blk('log', { id: 'island' })],
      [edge('s', 'r')],
    );
    const sevs = validateFlow(f).map(p => p.severity);
    const firstWarning = sevs.indexOf('warning');
    const lastError = sevs.lastIndexOf('error');
    expect(lastError).toBeLessThan(firstWarning);
  });
});
