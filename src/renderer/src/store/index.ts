// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Workspace } from '../../../shared/types';
import { createWsSlice, type WsSlice } from './slices/ws-slice';
import { createSocketIoSlice, type SocketIoSlice } from './slices/socketio-slice';
import { createGraphqlWsSlice, type GraphqlWsSlice } from './slices/graphqlws-slice';
import { createMqttSlice, type MqttSlice } from './slices/mqtt-slice';
import { createGrpcSlice, type GrpcSlice } from './slices/grpc-slice';
import { createStreamSlice, type StreamSlice } from './slices/stream-slice';
import { createHistorySlice, type HistorySlice } from './slices/history-slice';
import { createRunnerSlice, type RunnerSlice } from './slices/runner-slice';
import { createRecorderSlice, type RecorderSlice } from './slices/recorder-slice';
import { createContractSlice, type ContractSlice } from './slices/contract-slice';
import { createTabsSlice, type TabsSlice } from './slices/tabs-slice';
import { createCollectionsSlice, type CollectionsSlice } from './slices/collections-slice';
import { createEnvironmentsSlice, type EnvironmentsSlice } from './slices/environments-slice';
import { createMocksSlice, type MocksSlice } from './slices/mocks-slice';
import { createFlowsSlice, type FlowsSlice } from './slices/flows-slice';
import { createUiSlice, type UiSlice } from './slices/ui-slice';

// Re-exports kept for backwards compatibility — components import these
// helpers from the store rather than from src/shared directly.
export { uniqueName, colRelPath } from '../../../shared/naming-utils';
export { findFolder, findFolderPath } from '../../../shared/folder-tree';
export type { AppTab } from './slices/tabs-slice';

// ─── State shape ─────────────────────────────────────────────────────────────

// `WorkspaceState`/`WorkspaceActions` only own the workspace-level parts of
// the store (workspace file, globals, session vars). Everything else comes
// from individual slices in `./slices/`:
//   • TabsSlice         — tabs/activeTabId/activeCollectionId + tab actions
//   • CollectionsSlice  — collections + collection/folder/request CRUD
//   • EnvironmentsSlice — environments + activeEnvironmentId + CRUD
//   • MocksSlice        — mocks/activeMockId/mockLogs + actions
//   • UiSlice           — theme/zoom/sidebar/commandPalette/pinnedResponse…
//   • WsSlice           — wsConnections + setWsStatus/addWsMessage/clearWsMessages
//   • HistorySlice      — history + addHistoryEntry/clearHistory
//   • RunnerSlice       — runnerModal/runnerResults/runnerRunning + actions
//   • RecorderSlice     — recorder* fields + setters
//   • ContractSlice     — lastContractReport + contractSnapshots + actions

interface WorkspaceState {
  workspace: Workspace | null
  workspacePath: string | null

  globals: Record<string, string>

  /**
   * Script writes to the *named* scopes (`sp.environment.set`,
   * `sp.collectionVariables.set`, `sp.folder.set`, `sp.globals.set`) made during
   * a manual send. They live in memory for the running session so an extracted
   * value (e.g. a token) is available to the *next* manually-sent request, but
   * are never written to the `.env.json` / `.spector` / `globals.json` files or
   * the Variables screens, and clear on workspace close / app restart. Each
   * bucket overlays its own scope at send time, at that scope's precedence.
   *
   * `sp.variables.set` (local) is deliberately NOT here: local variables are
   * request-scoped by definition, threaded only within a single send/run.
   */
  sessionScriptVars: {
    env: Record<string, string>
    collection: Record<string, string>
    folder: Record<string, string>
    globals: Record<string, string>
  }
}

/** Per-scope deltas a script produced in one send, recorded into the session. */
export interface ScriptSessionDelta {
  env?: Record<string, string>
  collection?: Record<string, string>
  folder?: Record<string, string>
  globals?: Record<string, string>
}

interface WorkspaceActions {
  setWorkspace: (ws: Workspace, path: string) => void
  closeWorkspace: () => void
  updateWorkspaceSettings: (settings: NonNullable<Workspace['settings']>) => void

  // Globals
  setGlobals: (globals: Record<string, string>) => void
  patchGlobals: (patch: Record<string, string>) => void

  /**
   * Record the script-set values from a manual send into the in-memory session
   * (see `sessionScriptVars`). Merges each scope's delta; never touches disk.
   */
  recordScriptSession: (delta: ScriptSessionDelta) => void
}

// ─── Store ────────────────────────────────────────────────────────────────────

export type FullState =
  WorkspaceState & WorkspaceActions &
  TabsSlice & CollectionsSlice & EnvironmentsSlice & MocksSlice & FlowsSlice & UiSlice &
  WsSlice & SocketIoSlice & GraphqlWsSlice & MqttSlice & GrpcSlice & StreamSlice & HistorySlice & RunnerSlice & RecorderSlice & ContractSlice

export const useStore: UseBoundStore<StoreApi<FullState>> = create<FullState>()(
  immer((set, get, api) => ({
    // ── Slice composition ─────────────────────────────────────────────────────
    ...createWsSlice(set, get, api),
    ...createSocketIoSlice(set, get, api),
    ...createGraphqlWsSlice(set, get, api),
    ...createMqttSlice(set, get, api),
    ...createGrpcSlice(set, get, api),
    ...createStreamSlice(set, get, api),
    ...createHistorySlice(set, get, api),
    ...createRunnerSlice(set, get, api),
    ...createRecorderSlice(set, get, api),
    ...createContractSlice(set, get, api),
    ...createTabsSlice(set, get, api),
    ...createCollectionsSlice(set, get, api),
    ...createEnvironmentsSlice(set, get, api),
    ...createMocksSlice(set, get, api),
    ...createFlowsSlice(set, get, api),
    ...createUiSlice(set, get, api),

    // ── Workspace-level state ─────────────────────────────────────────────────
    workspace: null,
    workspacePath: null,
    globals: {},
    sessionScriptVars: { env: {}, collection: {}, folder: {}, globals: {} },

    // ── Workspace ─────────────────────────────────────────────────────────────
    setWorkspace: (ws, path) => set(s => { s.workspace = ws; s.workspacePath = path; }),

    closeWorkspace: () => set(s => {
      s.workspace           = null;
      s.workspacePath       = null;
      s.collections         = {};
      s.environments        = {};
      s.mocks               = {};
      s.flows               = {};
      s.activeFlowId        = null;
      s.tabs                = [];
      s.activeTabId         = null;
      s.activeCollectionId  = null;
      s.globals             = {};
      s.sessionScriptVars   = { env: {}, collection: {}, folder: {}, globals: {} };
      s.runnerResults       = [];
      s.runnerRunning       = false;
      s.runnerModal         = { open: false, collectionId: null, folderId: null, filterTags: [] };
      s.history             = [];
      s.mockLogs            = {};
      s.wsConnections       = {};
      s.socketIoConnections = {};
      s.graphqlWsConnections = {};
      s.mqttConnections = {};
      s.pinnedResponse      = null;
      s.lastContractReport  = null;
      s.contractSnapshots   = {};
      s.activeContractSnapshotRelPath = null;
    }),

    updateWorkspaceSettings: (settings) => set(s => {
      if (s.workspace) s.workspace.settings = settings;
    }),

    // ── Globals ───────────────────────────────────────────────────────────────
    setGlobals: (globals) => set(s => { s.globals = globals; }),
    patchGlobals: (patch) => set(s => { s.globals = { ...s.globals, ...patch }; }),

    // ── Script session ──────────────────────────────────────────────────────
    // Session semantics for script `.set()` on the named scopes: a value a
    // script sets (e.g. `sp.environment.set('authToken', …)`) is kept in memory
    // so the NEXT manually-sent request can read it, but is never written to the
    // `.env.json` / `.spector` / `globals.json` files or shown as a change in the
    // Variables screens, and it clears on workspace close / app restart. Within a
    // single send the value is threaded locally (see RequestBuilder); this sink
    // is what carries it across separate manual sends. `sp.variables.set` (local)
    // is request-scoped and intentionally not recorded here.
    recordScriptSession: (delta) => set(s => {
      const nonEmpty = (m?: Record<string, string>) => m && Object.keys(m).length > 0;
      if (nonEmpty(delta.env))        s.sessionScriptVars.env        = { ...s.sessionScriptVars.env,        ...delta.env };
      if (nonEmpty(delta.collection)) s.sessionScriptVars.collection = { ...s.sessionScriptVars.collection, ...delta.collection };
      if (nonEmpty(delta.folder))     s.sessionScriptVars.folder     = { ...s.sessionScriptVars.folder,     ...delta.folder };
      if (nonEmpty(delta.globals))    s.sessionScriptVars.globals    = { ...s.sessionScriptVars.globals,    ...delta.globals };
    }),
  }))
);
