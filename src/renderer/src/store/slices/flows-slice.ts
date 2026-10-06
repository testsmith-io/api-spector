// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Flows: visual dataflow graphs of typed blocks, stored one-file-per-flow under
// flows/. Mirrors the collections slice — `{ relPath, data, dirty }` entries
// driven by the same debounced autosave loop, registered in the workspace
// manifest. The canvas edits the graph; running happens in the main process.

import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Flow, FlowBlock, FlowEdge, FlowBlockType, FlowBlockConfig } from '../../../../shared/types';
import { uniqueName, flowRelPath } from '../../../../shared/naming-utils';
import { BLOCK_SPECS, normalizeFlow } from '../../../../shared/flow-blocks';
import type { FullState } from '../index';

function makeFlow(name: string): Flow {
  return {
    version: '1.0',
    id: uuidv4(),
    name,
    nodes: [
      { id: uuidv4(), type: 'start', position: { x: 80, y: 170 } },
      { id: uuidv4(), type: 'end', position: { x: 680, y: 170 } },
    ],
    edges: [],
  };
}

function defaultConfig(type: FlowBlockType): FlowBlockConfig {
  const d = BLOCK_SPECS[type].defaultConfig;
  return d ? JSON.parse(JSON.stringify(d)) : {};
}

export interface FlowsSliceState {
  flows: Record<string, { relPath: string; data: Flow; dirty: boolean }>
  /** When set, the main pane renders the FlowCanvas for this flow id. */
  activeFlowId: string | null
}

export interface FlowsSliceActions {
  loadFlow: (relPath: string, data: Flow) => void
  markFlowClean: (id: string) => void

  addFlow: (name: string) => string
  /** Insert a fully-built flow (e.g. extracted subflow); registers it in the
   *  workspace and returns its id. Does NOT change the active flow. */
  addFlowObject: (data: Flow) => string
  renameFlow: (id: string, name: string) => void
  deleteFlow: (id: string) => void
  setActiveFlow: (id: string | null) => void

  /** Persist the whole node/edge set (React Flow hands us the next state). */
  setFlowGraph: (id: string, nodes: FlowBlock[], edges: FlowEdge[]) => void
  /** Add a block of the given type at a canvas position; returns its id. */
  addBlock: (id: string, type: FlowBlockType, position: { x: number; y: number }) => string
  updateBlockConfig: (id: string, blockId: string, patch: FlowBlockConfig) => void
  updateBlockLabel: (id: string, blockId: string, label: string) => void
  updateFlowDescription: (id: string, description: string) => void
}

export type FlowsSlice = FlowsSliceState & FlowsSliceActions

export const createFlowsSlice: StateCreator<
  FullState,
  [['zustand/immer', never]],
  [],
  FlowsSlice
> = (set, get) => ({
  flows: {},
  activeFlowId: null,

  loadFlow: (relPath, data) => set(s => {
    const flow = normalizeFlow(data);
    s.flows[flow.id] = { relPath, data: flow, dirty: false };
  }),

  markFlowClean: (id) => set(s => {
    if (s.flows[id]) s.flows[id].dirty = false;
  }),

  addFlow: (name) => {
    const flow = makeFlow(uniqueName(name, Object.values(get().flows).map(f => f.data.name)));
    const relPath = flowRelPath(flow.name, flow.id);
    set(s => {
      s.flows[flow.id] = { relPath, data: flow, dirty: true };
      s.activeFlowId = flow.id;
      if (s.workspace) {
        s.workspace.flows ??= [];
        s.workspace.flows.push(relPath);
      }
    });
    return flow.id;
  },

  addFlowObject: (data) => {
    const id = data.id;
    set(s => {
      data.name = uniqueName(data.name, Object.values(s.flows).map(f => f.data.name));
      const relPath = flowRelPath(data.name, data.id);
      s.flows[data.id] = { relPath, data, dirty: true };
      if (s.workspace) {
        s.workspace.flows ??= [];
        s.workspace.flows.push(relPath);
      }
    });
    return id;
  },

  renameFlow: (id, name) => set(s => {
    const entry = s.flows[id];
    if (!entry) return;
    const oldRelPath = entry.relPath;
    const newRelPath = flowRelPath(name, id);
    entry.data.name = name;
    entry.relPath = newRelPath;
    entry.dirty = true;
    if (s.workspace?.flows && oldRelPath !== newRelPath) {
      s.workspace.flows = s.workspace.flows.map(p => p === oldRelPath ? newRelPath : p);
    }
  }),

  deleteFlow: (id) => {
    const relPath = get().flows[id]?.relPath;
    if (relPath) {
      window.electron.deleteWorkspaceFile(relPath).catch((err: unknown) => {
        console.warn('deleteFlow: could not remove file', relPath, err);
      });
    }
    set(s => {
      delete s.flows[id];
      if (s.workspace?.flows && relPath) {
        s.workspace.flows = s.workspace.flows.filter(p => p !== relPath);
      }
      if (s.activeFlowId === id) s.activeFlowId = null;
    });
  },

  setActiveFlow: (id) => set(s => { s.activeFlowId = id; }),

  setFlowGraph: (id, nodes, edges) => set(s => {
    const entry = s.flows[id];
    if (!entry) return;
    entry.data.nodes = nodes;
    entry.data.edges = edges;
    entry.dirty = true;
  }),

  addBlock: (id, type, position) => {
    const blockId = uuidv4();
    set(s => {
      const entry = s.flows[id];
      if (!entry) return;
      entry.data.nodes.push({ id: blockId, type, position, config: defaultConfig(type) });
      entry.dirty = true;
    });
    return blockId;
  },

  updateBlockConfig: (id, blockId, patch) => set(s => {
    const entry = s.flows[id];
    const block = entry?.data.nodes.find(n => n.id === blockId);
    if (!entry || !block) return;
    block.config = { ...(block.config ?? {}), ...patch };
    entry.dirty = true;
  }),

  updateBlockLabel: (id, blockId, label) => set(s => {
    const entry = s.flows[id];
    const block = entry?.data.nodes.find(n => n.id === blockId);
    if (!entry || !block) return;
    block.label = label || undefined;
    entry.dirty = true;
  }),

  updateFlowDescription: (id, description) => set(s => {
    const entry = s.flows[id];
    if (!entry) return;
    entry.data.description = description;
    entry.dirty = true;
  }),
});
