// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Integration: the display block path through the REAL script sandbox
// (evaluateExpression / runScript), the way the IPC handler + CLI wire it.

import { describe, it, expect } from 'vitest';
import { runFlow, type FlowEngineDeps, type FlowRunEvent, type EngineScriptInput } from '../shared/flow-engine';
import { runScript, evaluateExpression } from '../main/script-runner';
import type { Flow, FlowBlock, FlowEdge } from '../shared/types';

function realDeps(onEvent: (e: FlowRunEvent) => void): FlowEngineDeps {
  const toScriptCtx = (i: EngineScriptInput) => ({
    envVars: i.envVars, collectionVars: i.collectionVars, globals: i.globals,
    localVars: i.localVars, response: i.response ?? undefined, data: i.data,
  });
  return {
    runRequest: async (_ref, input) => ({
      envVars: input.envVars, collectionVars: input.collectionVars, globals: input.globals, localVars: input.localVars,
      response: { status: 201, statusText: 'Created', headers: {}, body: JSON.stringify({ invoice_number: 'INV-1', total: 42 }), bodySize: 40, durationMs: 1 },
      status: 'passed', httpStatus: 201, durationMs: 1, name: 'checkout', method: 'POST', resolvedUrl: '/invoices',
    }),
    runScript: async (code, input) => {
      const o = await runScript(code, toScriptCtx(input));
      return { envVars: o.updatedEnvVars, collectionVars: o.updatedCollectionVars, globals: o.updatedGlobals, localVars: o.updatedLocalVars, testResults: o.testResults, consoleOutput: o.consoleOutput, error: o.error };
    },
    evalExpression: async (code, input) => {
      const o = await evaluateExpression(code, toScriptCtx(input));
      return { envVars: o.updatedEnvVars, collectionVars: o.updatedCollectionVars, globals: o.updatedGlobals, localVars: o.updatedLocalVars, value: o.value, consoleOutput: o.consoleOutput, error: o.error };
    },
    resolveFlow: () => null,
    sleep: async () => {},
    onEvent,
  };
}

const block = (id: string, type: FlowBlock['type'], config?: FlowBlock['config']): FlowBlock => ({ id, type, position: { x: 0, y: 0 }, config });
const edge = (source: string, target: string, sourcePort?: string): FlowEdge => ({ id: `${source}-${target}`, source, target, sourcePort });

describe('display block (real sandbox)', () => {
  it('emits a display event whose value is the parsed response', async () => {
    const events: FlowRunEvent[] = [];
    const flow: Flow = {
      version: '1.0', id: 'f', name: 'f',
      nodes: [
        block('s', 'start'),
        block('r', 'request', { ref: { collectionId: 'c', requestId: 'x' } }),
        block('d', 'display', { message: 'sp.response.json()', as: 'json' }),
      ],
      edges: [edge('s', 'r'), edge('r', 'd', 'success')],
    };
    await runFlow(flow, realDeps(e => events.push(e)));

    const display = events.find(e => e.kind === 'display');
    expect(display, 'a display event should be emitted').toBeDefined();
    expect(display!.display?.value).toEqual({ invoice_number: 'INV-1', total: 42 });
  });
});
