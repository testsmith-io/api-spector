// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Drives a flow run from the UI. It ships the workspace's in-memory
// collections/flows/environment to the main process (which runs the shared
// flow engine) and maps the streamed per-block events into live node status +
// an output log (log / display blocks) for the canvas.

import { useCallback, useState } from 'react';
import { useStore } from '../../store';
import { resolveEnvironmentById } from '../../hooks/useActiveEnvironment';
import type { Flow } from '../../../../shared/types';
import type { FlowRunEvent, FlowRunSummary, FlowBlockStatus, FlowBlockRunRecord } from '../../../../shared/flow-engine';

export interface FlowNodeStatus {
  status: FlowBlockStatus
  httpStatus?: number
  durationMs?: number
  error?: string
}

export interface FlowOutput {
  kind: 'log' | 'display'
  blockId: string
  message?: string
  value?: unknown
  as?: string
  label?: string
}

export interface FlowLogEntry {
  kind: 'block' | 'log' | 'display'
  blockId: string
  type?: string
  label?: string
  status?: FlowBlockStatus
  httpStatus?: number
  durationMs?: number
  error?: string
  iteration?: number
  atMs?: number
  message?: string
  value?: unknown
}

export interface FlowRunState {
  running: boolean
  nodeStatus: Record<string, FlowNodeStatus>
  outputs: FlowOutput[]
  /** Full chronological run log (every block result + log/display output). */
  log: FlowLogEntry[]
  /** Ids of edges traversed during the run — for highlighting the taken route. */
  traversedEdges: string[]
  summary: FlowRunSummary | null
  error: string | null
  /** Live merged variable snapshot (updated per block). */
  variables: Record<string, string>
  /** Final rich data channel (loop items, collected lists). */
  data: Record<string, unknown>
}

const { electron } = window;

export function useFlowRunner() {
  const [state, setState] = useState<FlowRunState>({
    running: false, nodeStatus: {}, outputs: [], log: [], traversedEdges: [], summary: null, error: null, variables: {}, data: {},
  });

  const reset = useCallback(() => {
    setState({ running: false, nodeStatus: {}, outputs: [], log: [], traversedEdges: [], summary: null, error: null, variables: {}, data: {} });
  }, []);

  const run = useCallback(async (flow: Flow, environmentId: string | null) => {
    const { collections, flows, environments, globals, workspace } = useStore.getState();
    const env = resolveEnvironmentById(environments, environmentId);

    setState({ running: true, nodeStatus: {}, outputs: [], log: [], traversedEdges: [], summary: null, error: null, variables: {}, data: {} });

    electron.onFlowProgress((evt: FlowRunEvent) => {
      setState(prev => {
        const next: FlowRunState = { ...prev };
        if (evt.kind === 'block-start' || evt.kind === 'block-result') {
          next.nodeStatus = {
            ...prev.nodeStatus,
            [evt.blockId]: {
              status: evt.status ?? 'running',
              httpStatus: evt.httpStatus,
              durationMs: evt.durationMs,
              error: evt.error,
            },
          };
          if (evt.vars) next.variables = evt.vars;
        }
        if (evt.kind === 'log') {
          next.outputs = [...prev.outputs, { kind: 'log', blockId: evt.blockId, message: evt.message }];
        }
        if (evt.kind === 'display') {
          next.outputs = [...prev.outputs, { kind: 'display', blockId: evt.blockId, value: evt.display?.value, as: evt.display?.as, label: evt.display?.label }];
        }
        if (evt.kind === 'edge' && evt.edgeIds?.length) {
          const seen = new Set(prev.traversedEdges);
          const added = evt.edgeIds.filter(id => !seen.has(id));
          if (added.length) next.traversedEdges = [...prev.traversedEdges, ...added];
        }
        // Run log: a chronological record of every meaningful event.
        if (evt.kind === 'block-result' || evt.kind === 'log' || evt.kind === 'display') {
          const entry: FlowLogEntry = {
            kind: evt.kind === 'block-result' ? 'block' : evt.kind,
            blockId: evt.blockId, type: evt.blockType, label: evt.label,
            status: evt.status, httpStatus: evt.httpStatus, durationMs: evt.durationMs,
            error: evt.error, iteration: evt.iteration, atMs: evt.atMs,
            message: evt.message, value: evt.display?.value,
          };
          next.log = [...prev.log, entry];
        }
        return next;
      });
    });

    try {
      const summary = await electron.runFlow({
        flow,
        collections: Object.values(collections).map(c => c.data),
        flows: Object.values(flows).map(f => f.data),
        environment: env,
        globals,
        proxy: workspace?.settings?.proxy,
        tls: workspace?.settings?.tls,
        piiMaskPatterns: workspace?.settings?.piiMaskPatterns,
      });
      const merged = summary.variables
        ? { ...summary.variables.globals, ...summary.variables.collectionVars, ...summary.variables.envVars, ...summary.variables.localVars }
        : undefined;
      // Rebuild the run log + outputs from the summary's block records: these
      // are the authoritative, complete record and recover any trailing
      // progress events (display/log near the end) that raced run completion.
      const rebuiltLog: FlowLogEntry[] = summary.blocks.map((b: FlowBlockRunRecord) => ({
        kind: b.type === 'log' ? 'log' : b.type === 'display' ? 'display' : 'block',
        blockId: b.blockId, type: b.type, label: b.label, status: b.status,
        httpStatus: b.httpStatus, durationMs: b.durationMs, error: b.error,
        iteration: b.iteration, atMs: b.atMs, message: b.message, value: b.display,
      }));
      const rebuiltOutputs: FlowOutput[] = summary.blocks
        .filter((b: FlowBlockRunRecord) => b.type === "log" || b.type === "display")
        .map((b: FlowBlockRunRecord) => b.type === "log"
          ? { kind: 'log', blockId: b.blockId, message: b.message }
          : { kind: 'display', blockId: b.blockId, value: b.display, label: b.label });
      setState(prev => ({
        ...prev, summary,
        variables: merged ?? prev.variables,
        data: summary.data ?? prev.data,
        // Authoritative route from the summary — covers any streamed `edge`
        // event that raced the run's completion (e.g. the final hop).
        traversedEdges: summary.traversedEdges?.length ? summary.traversedEdges : prev.traversedEdges,
        log: rebuiltLog.length ? rebuiltLog : prev.log,
        outputs: rebuiltOutputs,
      }));
    } catch (e) {
      setState(prev => ({ ...prev, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      electron.offFlowProgress();
      setState(prev => ({ ...prev, running: false }));
    }
  }, []);

  return { ...state, run, reset };
}
