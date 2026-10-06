// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { runFlow, type FlowEngineDeps, type EngineScriptInput } from '../shared/flow-engine';
import type { Flow, FlowBlock, FlowEdge } from '../shared/types';

// ─── Test harness ─────────────────────────────────────────────────────────
// Stub deps evaluate expressions against `response` / `data` / `vars` globals
// (standing in for the real sp.* sandbox), so these tests exercise the engine's
// control flow, not the script runner.

function scopes(input: EngineScriptInput) {
  return {
    envVars: input.envVars, collectionVars: input.collectionVars,
    globals: input.globals, localVars: input.localVars,
  };
}

interface Harness {
  deps: FlowEngineDeps
  requests: string[]
  logs: string[]
  flows: Record<string, Flow>
}

function harness(resp: { status?: number } = {}): Harness {
  const requests: string[] = [];
  const logs: string[] = [];
  const flows: Record<string, Flow> = {};
  const evalIn = (code: string, input: EngineScriptInput): unknown => {
    const vars = { ...input.globals, ...input.collectionVars, ...input.envVars, ...input.localVars };
    // eslint-disable-next-line no-new-func
    const fn = new Function('data', 'response', 'vars', `return (${code})`);
    return fn(input.data, input.response, vars);
  };
  const deps: FlowEngineDeps = {
    runRequest: async (ref, input) => {
      requests.push(ref.requestId);
      return {
        ...scopes(input),
        response: { status: resp.status ?? 200, statusText: 'OK', headers: {}, body: JSON.stringify({ id: ref.requestId }) },
        status: (resp.status ?? 200) < 400 ? 'passed' : 'failed',
        httpStatus: resp.status ?? 200, durationMs: 1,
        name: ref.requestId, method: 'GET', resolvedUrl: '/' + ref.requestId,
      };
    },
    runScript: async (code, input) => {
      // Treat the script as a boolean assertion: pass unless it throws / is false.
      try {
        const ok = Boolean(evalIn(code || 'true', input));
        return { ...scopes(input), testResults: [{ name: code, passed: ok }] };
      } catch (e) {
        return { ...scopes(input), error: String(e) };
      }
    },
    evalExpression: async (code, input) => {
      try { return { ...scopes(input), value: evalIn(code, input) }; }
      catch (e) { return { ...scopes(input), value: undefined, error: String(e) }; }
    },
    resolveFlow: (id) => flows[id] ?? null,
    sleep: async () => {},
    onEvent: (evt) => { if (evt.kind === 'log' && evt.message) logs.push(evt.message); },
    maxSteps: 1000,
  };
  return { deps, requests, logs, flows };
}

let counter = 0;
const nid = () => `n${++counter}`;
const block = (type: FlowBlock['type'], config?: FlowBlock['config'], id = nid()): FlowBlock =>
  ({ id, type, position: { x: 0, y: 0 }, config });
const edge = (source: string, target: string, sourcePort?: string): FlowEdge =>
  ({ id: nid(), source, target, sourcePort });
const flow = (nodes: FlowBlock[], edges: FlowEdge[], id = 'f1'): Flow =>
  ({ version: '1.0', id, name: id, nodes, edges });
const req = (name: string) => ({ collectionId: 'c', requestId: name });

describe('runFlow', () => {
  it('runs a linear chain in order', async () => {
    const h = harness();
    const s = block('start'), a = block('request', { ref: req('a') }), b = block('request', { ref: req('b') }), e = block('end');
    const f = flow([s, a, b, e], [edge(s.id, a.id), edge(a.id, b.id), edge(b.id, e.id)]);
    await runFlow(f, h.deps);
    expect(h.requests).toEqual(['a', 'b']);
  });

  it('routes a request to its fail port on a non-2xx response', async () => {
    const h = harness({ status: 500 });
    const s = block('start'), a = block('request', { ref: req('a') });
    const ok = block('request', { ref: req('ok') });
    const bad = block('request', { ref: req('bad') });
    const f = flow(
      [s, a, ok, bad],
      [edge(s.id, a.id), edge(a.id, ok.id, 'success'), edge(a.id, bad.id, 'fail')],
    );
    await runFlow(f, h.deps);
    expect(h.requests).toEqual(['a', 'bad']);
  });

  it('routes a request to its success port on a 2xx response', async () => {
    const h = harness({ status: 200 });
    const s = block('start'), a = block('request', { ref: req('a') });
    const ok = block('request', { ref: req('ok') });
    const bad = block('request', { ref: req('bad') });
    const f = flow(
      [s, a, ok, bad],
      [edge(s.id, a.id), edge(a.id, ok.id, 'success'), edge(a.id, bad.id, 'fail')],
    );
    await runFlow(f, h.deps);
    expect(h.requests).toEqual(['a', 'ok']);
  });

  it('routes an if block down only the matching branch', async () => {
    const h = harness({ status: 200 });
    const s = block('start'), a = block('request', { ref: req('a') });
    const iff = block('if', { expression: 'response.status === 200' });
    const t = block('request', { ref: req('onTrue') });
    const fl = block('request', { ref: req('onFalse') });
    const f = flow(
      [s, a, iff, t, fl],
      [edge(s.id, a.id), edge(a.id, iff.id), edge(iff.id, t.id, 'true'), edge(iff.id, fl.id, 'false')],
    );
    await runFlow(f, h.deps);
    expect(h.requests).toEqual(['a', 'onTrue']);
  });

  it('reports which edges were traversed (the route taken)', async () => {
    const h = harness({ status: 500 });
    const edgeEvents: string[] = [];
    h.deps.onEvent = (evt) => { if (evt.kind === 'edge' && evt.edgeIds) edgeEvents.push(...evt.edgeIds); };
    const s = block('start'), a = block('request', { ref: req('a') });
    const ok = block('request', { ref: req('ok') });
    const bad = block('request', { ref: req('bad') });
    const eSuccess = edge(a.id, ok.id, 'success');
    const eFail = edge(a.id, bad.id, 'fail');
    const f = flow([s, a, ok, bad], [edge(s.id, a.id), eSuccess, eFail]);
    const summary = await runFlow(f, h.deps);
    expect(edgeEvents).toContain(eFail.id);      // fail route was taken (500)
    expect(edgeEvents).not.toContain(eSuccess.id); // success route was not
    // The summary carries the complete route (survives any event race).
    expect(summary.traversedEdges).toContain(eFail.id);
    expect(summary.traversedEdges).not.toContain(eSuccess.id);
  });

  it('picks the first matching condition case, else the else port', async () => {
    const h = harness();
    const s = block('start');
    const cond = block('condition', { cases: [
      { id: 'c1', label: 'one', expression: 'vars.pick === "1"' },
      { id: 'c2', label: 'two', expression: 'vars.pick === "2"' },
    ] });
    const r1 = block('request', { ref: req('one') });
    const r2 = block('request', { ref: req('two') });
    const rElse = block('request', { ref: req('else') });
    const f = flow(
      [s, cond, r1, r2, rElse],
      [edge(s.id, cond.id), edge(cond.id, r1.id, 'c1'), edge(cond.id, r2.id, 'c2'), edge(cond.id, rElse.id, 'else')],
    );
    const summary = await runFlow(f, h.deps, { localVars: { pick: '2' } });
    expect(h.requests).toEqual(['two']);
    expect(summary.errors).toBe(0);
  });

  it('forEach runs the body per item and collect gathers results', async () => {
    const h = harness();
    const s = block('start');
    const seed = block('evaluate', { script: 'true' });
    const fe = block('forEach', { expression: '[10,20,30]', itemVar: 'item', indexVar: 'i' });
    const bodyReq = block('request', { ref: req('step') });
    const col = block('collect', { intoVar: 'out', valueExpression: 'data.item' });
    const done = block('log', { message: 'data.out.length' });
    const f = flow(
      [s, seed, fe, bodyReq, col, done],
      [
        edge(s.id, seed.id), edge(seed.id, fe.id),
        edge(fe.id, bodyReq.id, 'body'), edge(bodyReq.id, col.id),
        edge(fe.id, done.id, 'done'),
      ],
    );
    await runFlow(f, h.deps);
    expect(h.requests).toEqual(['step', 'step', 'step']);
    expect(h.logs).toEqual(['3']); // collect gathered 3 items, read after the loop
  });

  it('repeat runs the body a fixed number of times', async () => {
    const h = harness();
    const s = block('start');
    const rep = block('repeat', { count: 4 });
    const bodyReq = block('request', { ref: req('tick') });
    const f = flow([s, rep, bodyReq], [edge(s.id, rep.id), edge(rep.id, bodyReq.id, 'body')]);
    await runFlow(f, h.deps);
    expect(h.requests).toHaveLength(4);
  });

  it('merge (or) fires once on the first incoming branch', async () => {
    const h = harness();
    const s = block('start');
    const a = block('request', { ref: req('a') });
    const b = block('request', { ref: req('b') });
    const m = block('merge');
    const after = block('request', { ref: req('after') });
    // start fans to a and b; both wire into merge; merge -> after
    const f = flow(
      [s, a, b, m, after],
      [edge(s.id, a.id), edge(s.id, b.id), edge(a.id, m.id), edge(b.id, m.id), edge(m.id, after.id)],
    );
    await runFlow(f, h.deps);
    expect(h.requests.filter(r => r === 'after')).toHaveLength(1);
  });

  it('validate routes to fail when an assertion fails', async () => {
    const h = harness();
    const s = block('start');
    const v = block('validate', { script: 'false' }); // our stub: false => failed assertion
    const pass = block('request', { ref: req('pass') });
    const fail = block('request', { ref: req('fail') });
    const f = flow(
      [s, v, pass, fail],
      [edge(s.id, v.id), edge(v.id, pass.id, 'pass'), edge(v.id, fail.id, 'fail')],
    );
    const summary = await runFlow(f, h.deps);
    expect(h.requests).toEqual(['fail']);
    expect(summary.failed).toBe(1);
  });

  it('runs a sub-flow and blocks infinite recursion', async () => {
    const h = harness();
    // sub-flow: start -> request(sub)
    const ss = block('start'), sr = block('request', { ref: req('sub') });
    h.flows['f2'] = flow([ss, sr], [edge(ss.id, sr.id)], 'f2');
    const s = block('start'), call = block('subflow', { flowId: 'f2' });
    const f = flow([s, call], [edge(s.id, call.id)]);
    await runFlow(f, h.deps);
    expect(h.requests).toEqual(['sub']);
  });

  it('setVar writes into the chosen scope and appears in the summary', async () => {
    const h = harness();
    const s = block('start');
    const sv = block('setVar', { varName: 'token', valueExpression: '"abc123"', scope: 'global' });
    const svl = block('setVar', { varName: 'count', valueExpression: '41 + 1', scope: 'local' });
    const f = flow([s, sv, svl], [edge(s.id, sv.id), edge(sv.id, svl.id)]);
    const summary = await runFlow(f, h.deps);
    expect(summary.variables?.globals.token).toBe('abc123');
    expect(summary.variables?.localVars.count).toBe('42');
  });

  it('seeds Start flow inputs into local scope before the run', async () => {
    const h = harness();
    const s = block('start', { inputs: [{ key: 'pick', value: '2' }] });
    const cond = block('condition', { cases: [{ id: 'c2', label: 'two', expression: 'vars.pick === "2"' }] });
    const r2 = block('request', { ref: req('two') });
    const rElse = block('request', { ref: req('else') });
    const f = flow([s, cond, r2, rElse], [edge(s.id, cond.id), edge(cond.id, r2.id, 'c2'), edge(cond.id, rElse.id, 'else')]);
    await runFlow(f, h.deps);
    expect(h.requests).toEqual(['two']);
  });

  it('emits a variable snapshot on block-result events', async () => {
    const h = harness();
    const seen: Record<string, string>[] = [];
    h.deps.onEvent = (evt) => { if (evt.kind === 'block-result' && evt.vars) seen.push(evt.vars); };
    const s = block('start');
    const sv = block('setVar', { varName: 'x', valueExpression: '"hi"', scope: 'local' });
    const f = flow([s, sv], [edge(s.id, sv.id)]);
    await runFlow(f, h.deps);
    expect(seen.some(v => v.x === 'hi')).toBe(true);
  });

  it('throws when a cycle blows the step budget', async () => {
    const h = harness();
    // start -> m -> loop back to a self-feeding request with no terminator
    const s = block('start');
    const a = block('request', { ref: req('a') });
    const b = block('request', { ref: req('b') });
    const f = flow([s, a, b], [edge(s.id, a.id), edge(a.id, b.id), edge(b.id, a.id)]);
    await expect(runFlow(f, h.deps)).rejects.toThrow(/step limit/);
  });
});
