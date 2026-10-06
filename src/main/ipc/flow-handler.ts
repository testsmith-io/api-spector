// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Runs a flow for the desktop UI. The renderer passes its in-memory
// collections/flows/environment (main doesn't hold the store), and this handler
// injects the real request/script primitives into the shared flow engine, then
// streams per-block progress back over IPC. The engine itself (and therefore
// the flow semantics) is identical to what the `flow` CLI command runs.

import { type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import type { RunFlowPayload, Collection, ApiRequest } from '../../shared/types';
import { runFlow, type FlowEngineDeps, type FlowRunSummary } from '../../shared/flow-engine';
import { normalizeFlow } from '../../shared/flow-blocks';
import { resolveInheritedAuthAndHeaders, authIsConfigured } from '../../shared/request-collection';
import { executeRunnerRequest, buildDispatcher } from '../request-exec';
import { runScript, evaluateExpression } from '../script-runner';
import { buildEnvVars, interpolate } from '../interpolation';
import { getGlobals } from '../globals-store';

export function registerFlowHandler(ipc: IpcMain): void {
  handleIpc(ipc, IPC.flow.run, async (event: IpcMainInvokeEvent, payload: RunFlowPayload): Promise<FlowRunSummary> => {
    const { collections, environment, globals: payloadGlobals, proxy, tls, piiMaskPatterns = [] } = payload;

    const flow = normalizeFlow(payload.flow);
    const flows = (payload.flows ?? []).map(normalizeFlow);

    const envVars = await buildEnvVars(environment);
    const globals = { ...payloadGlobals, ...getGlobals() };
    const dispatcher = await buildDispatcher(proxy, tls);

    const colById = new Map<string, Collection>(collections.map(c => [c.id, c]));

    const deps: FlowEngineDeps = {
      runRequest: async (ref, input) => {
        const col = colById.get(ref.collectionId);
        const original = col?.requests[ref.requestId];
        if (!col || !original) return null;

        // Clone (store objects may be frozen) + merge inherited auth/headers so
        // the request runs with its effective collection/folder settings.
        const req = JSON.parse(JSON.stringify(original)) as ApiRequest;
        const inherited = resolveInheritedAuthAndHeaders(original.id, col);
        if (!authIsConfigured(req.auth) && inherited.auth && inherited.auth.type !== 'none') {
          req.auth = inherited.auth;
        }
        const inheritedHeaders = inherited.headers.filter(h => h.enabled && h.key);
        if (inheritedHeaders.length) req.headers = [...inheritedHeaders, ...(req.headers ?? [])];

        const { result, updatedEnvVars, updatedCollectionVars, updatedGlobals, updatedLocalVars } =
          await executeRunnerRequest({
            req,
            collectionVars: { ...(col.collectionVariables ?? {}), ...input.collectionVars },
            envVars: input.envVars,
            globals: input.globals,
            localVars: input.localVars,
            dispatcher,
            // Flows chain on the real response (e.g. extracting an access_token
            // the next block sends as a Bearer), so the body must NOT be PII-
            // masked here — masking would feed downstream blocks a sentinel.
            piiMaskPatterns: [],
            proxy,
            tls,
          });

        const rr = result.receivedResponse;
        const response = rr
          ? { status: rr.status, statusText: rr.statusText, headers: rr.headers, body: rr.body, bodySize: rr.body?.length ?? 0, durationMs: result.durationMs ?? 0 }
          : null;

        return {
          envVars: updatedEnvVars,
          collectionVars: updatedCollectionVars,
          globals: updatedGlobals,
          localVars: updatedLocalVars,
          response,
          status: result.status,
          httpStatus: result.httpStatus,
          durationMs: result.durationMs,
          error: result.error,
          testResults: result.testResults,
          name: result.name,
          method: result.method,
          resolvedUrl: result.resolvedUrl,
        };
      },

      runScript: async (code, input) => {
        const out = await runScript(code, {
          envVars: input.envVars, collectionVars: input.collectionVars,
          globals: input.globals, localVars: input.localVars,
          response: input.response ?? undefined, piiMaskPatterns, data: input.data,
        });
        return {
          envVars: out.updatedEnvVars, collectionVars: out.updatedCollectionVars,
          globals: out.updatedGlobals, localVars: out.updatedLocalVars,
          testResults: out.testResults, consoleOutput: out.consoleOutput, error: out.error,
        };
      },

      evalExpression: async (code, input) => {
        const out = await evaluateExpression(code, {
          envVars: input.envVars, collectionVars: input.collectionVars,
          globals: input.globals, localVars: input.localVars,
          response: input.response ?? undefined, piiMaskPatterns, data: input.data,
        });
        return {
          envVars: out.updatedEnvVars, collectionVars: out.updatedCollectionVars,
          globals: out.updatedGlobals, localVars: out.updatedLocalVars,
          value: out.value, consoleOutput: out.consoleOutput, error: out.error,
        };
      },

      resolveFlow: (flowId) => flows.find(f => f.id === flowId) ?? null,
      sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
      interpolate: (str, vars) => interpolate(str, vars),
      onEvent: (evt) => event.sender.send(IPC.flow.progress, evt),
    };

    return runFlow(flow, deps, { envVars, globals });
  });
}
