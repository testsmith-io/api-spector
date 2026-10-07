// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Headless flow runner — wires the shared flow engine to the real request /
// script primitives, resolving request blocks from a pre-baked requests map
// (keyed "collectionId:requestId"). Node-only, no Electron: this is what the
// cloud `runtime/flow` worker imports via @testsmith/api-spector/engine to run
// an uploaded flow with semantics identical to the desktop app and CLI.

import { runFlow } from '../shared/flow-engine';
import type { FlowEngineDeps, FlowRunSummary, FlowRunEvent } from '../shared/flow-engine';
import { normalizeFlow } from '../shared/flow-blocks';
import { executeRunnerRequest, buildDispatcher, type ProxyConfig, type TlsConfig } from './request-exec';
import { runScript, evaluateExpression } from './script-runner';
import type { ApiRequest, Flow, FlowRequestRef } from '../shared/types';

export interface HeadlessFlowInput {
  flow: Flow
  /** Resolved requests keyed "collectionId:requestId" (inherited auth/headers
   *  already merged; {{templates}} left intact for run-time interpolation). */
  requests: Record<string, ApiRequest>
  /** Referenced sub-flows (graphs). */
  flows?: Flow[]
  envVars?: Record<string, string>
  collectionVars?: Record<string, string>
  globals?: Record<string, string>
  proxy?: ProxyConfig
  tls?: TlsConfig
  onEvent?: (evt: FlowRunEvent) => void
}

const refKey = (ref: FlowRequestRef): string => `${ref.collectionId}:${ref.requestId}`;

export async function runFlowHeadless(input: HeadlessFlowInput): Promise<FlowRunSummary> {
  const flow = normalizeFlow(input.flow);
  const flows = (input.flows ?? []).map(normalizeFlow);
  const requests = input.requests ?? {};
  const dispatcher = await buildDispatcher(input.proxy, input.tls);

  const deps: FlowEngineDeps = {
    runRequest: async (ref, i) => {
      const original = requests[refKey(ref)];
      if (!original) return null;
      const req = JSON.parse(JSON.stringify(original)) as ApiRequest;
      const { result, updatedEnvVars, updatedCollectionVars, updatedGlobals, updatedLocalVars } =
        await executeRunnerRequest({
          req,
          collectionVars: i.collectionVars,
          envVars: i.envVars,
          globals: i.globals,
          localVars: i.localVars,
          dispatcher,
          piiMaskPatterns: [],
          proxy: input.proxy,
          tls: input.tls,
        });
      const rr = result.receivedResponse;
      const response = rr
        ? { status: rr.status, statusText: rr.statusText, headers: rr.headers, body: rr.body, bodySize: rr.body?.length ?? 0, durationMs: result.durationMs ?? 0 }
        : null;
      return {
        envVars: updatedEnvVars, collectionVars: updatedCollectionVars, globals: updatedGlobals, localVars: updatedLocalVars,
        response, status: result.status, httpStatus: result.httpStatus, durationMs: result.durationMs,
        error: result.error, testResults: result.testResults, name: result.name, method: result.method, resolvedUrl: result.resolvedUrl,
        sentRequest: {
          method: result.method,
          url: result.resolvedUrl,
          headers: result.sentRequest?.headers ?? {},
          body: result.sentRequest?.body,
        },
      };
    },
    runScript: async (code, i) => {
      const o = await runScript(code, { envVars: i.envVars, collectionVars: i.collectionVars, globals: i.globals, localVars: i.localVars, response: i.response ?? undefined, data: i.data, piiMaskPatterns: [] });
      return { envVars: o.updatedEnvVars, collectionVars: o.updatedCollectionVars, globals: o.updatedGlobals, localVars: o.updatedLocalVars, testResults: o.testResults, consoleOutput: o.consoleOutput, error: o.error };
    },
    evalExpression: async (code, i) => {
      const o = await evaluateExpression(code, { envVars: i.envVars, collectionVars: i.collectionVars, globals: i.globals, localVars: i.localVars, response: i.response ?? undefined, data: i.data, piiMaskPatterns: [] });
      return { envVars: o.updatedEnvVars, collectionVars: o.updatedCollectionVars, globals: o.updatedGlobals, localVars: o.updatedLocalVars, value: o.value, consoleOutput: o.consoleOutput, error: o.error };
    },
    resolveFlow: (id) => flows.find(f => f.id === id) ?? null,
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    onEvent: input.onEvent,
  };

  return runFlow(flow, deps, { envVars: input.envVars, collectionVars: input.collectionVars, globals: input.globals });
}
