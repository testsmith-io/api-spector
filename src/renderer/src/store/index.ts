// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Workspace, ScriptExecutionMeta } from '../../../shared/types';
import { uniqueName, colRelPath } from '../../../shared/naming-utils';
import { findFolder, findFolderPath } from '../../../shared/folder-tree';
import { createWsSlice, type WsSlice } from './slices/ws-slice';
import { createGrpcSlice, type GrpcSlice } from './slices/grpc-slice';
import { createStreamSlice, type StreamSlice } from './slices/stream-slice';
import { createHistorySlice, type HistorySlice } from './slices/history-slice';
import { createRunnerSlice, type RunnerSlice } from './slices/runner-slice';
import { createRecorderSlice, type RecorderSlice } from './slices/recorder-slice';
import { createContractSlice, type ContractSlice } from './slices/contract-slice';
import { createTabsSlice, type TabsSlice, type AppTab } from './slices/tabs-slice';
import { createCollectionsSlice, type CollectionsSlice } from './slices/collections-slice';
import { createEnvironmentsSlice, type EnvironmentsSlice } from './slices/environments-slice';
import { createMocksSlice, type MocksSlice } from './slices/mocks-slice';
import { createUiSlice, type UiSlice } from './slices/ui-slice';

// Re-exports kept for backwards compatibility — components import these
// helpers from the store rather than from src/shared directly.
export { uniqueName, colRelPath };
export { findFolder, findFolderPath };
export type { AppTab };

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

  /** Variables set via sp.variables.set() — in-memory session, never saved to disk */
  sessionVars: Record<string, string>
}

interface WorkspaceActions {
  setWorkspace: (ws: Workspace, path: string) => void
  closeWorkspace: () => void
  updateWorkspaceSettings: (settings: NonNullable<Workspace['settings']>) => void

  // Globals
  setGlobals: (globals: Record<string, string>) => void
  patchGlobals: (patch: Record<string, string>) => void

  // Apply script result back into store (env/collection vars + globals)
  applyScriptUpdates: (result: ScriptExecutionMeta) => void
}

// ─── Store ────────────────────────────────────────────────────────────────────

export type FullState =
  WorkspaceState & WorkspaceActions &
  TabsSlice & CollectionsSlice & EnvironmentsSlice & MocksSlice & UiSlice &
  WsSlice & GrpcSlice & StreamSlice & HistorySlice & RunnerSlice & RecorderSlice & ContractSlice

export const useStore: UseBoundStore<StoreApi<FullState>> = create<FullState>()(
  immer((set, get, api) => ({
    // ── Slice composition ─────────────────────────────────────────────────────
    ...createWsSlice(set, get, api),
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
    ...createUiSlice(set, get, api),

    // ── Workspace-level state ─────────────────────────────────────────────────
    workspace: null,
    workspacePath: null,
    globals: {},
    sessionVars: {},

    // ── Workspace ─────────────────────────────────────────────────────────────
    setWorkspace: (ws, path) => set(s => { s.workspace = ws; s.workspacePath = path; }),

    closeWorkspace: () => set(s => {
      s.workspace           = null;
      s.workspacePath       = null;
      s.collections         = {};
      s.environments        = {};
      s.mocks               = {};
      s.tabs                = [];
      s.activeTabId         = null;
      s.activeCollectionId  = null;
      s.globals             = {};
      s.sessionVars         = {};
      s.runnerResults       = [];
      s.runnerRunning       = false;
      s.runnerModal         = { open: false, collectionId: null, folderId: null, filterTags: [] };
      s.history             = [];
      s.mockLogs            = {};
      s.wsConnections       = {};
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

    // ── Apply script results back to store ────────────────────────────────────
    applyScriptUpdates: (result) => set(s => {
      // Defensive filter: never persist mask sentinels into the workspace
      // even if a script accidentally extracted one (e.g. from a redacted
      // response on an older build). Storing `[REDACTED]` as a token would
      // poison every later request that interpolates the variable.
      const isMaskSentinel = (v: string) => v === '[REDACTED]' || v === '[*****]';
      const safeFilter = (m: Record<string, string>): Record<string, string> => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(m)) {
          if (!isMaskSentinel(v)) out[k] = v;
          else console.warn(`applyScriptUpdates: refusing to persist mask sentinel into "${k}"`);
        }
        return out;
      };
      const safeColVars  = safeFilter(result.updatedCollectionVars);
      const safeEnvVars  = safeFilter(result.updatedEnvVars);
      const safeGlobals  = safeFilter(result.updatedGlobals);
      const safeLocalVars = safeFilter(result.updatedLocalVars);

      // Patch collection vars on the active collection
      const activeColId = s.activeCollectionId;
      if (activeColId && s.collections[activeColId]) {
        const col = s.collections[activeColId].data;
        col.collectionVariables = {
          ...(col.collectionVariables ?? {}),
          ...safeColVars,
        };
        s.collections[activeColId].dirty = true;
      }
      // Patch env vars back into the active environment. If the script created
      // a variable that doesn't exist yet in the environment definition, add it
      // so subsequent requests (including the main request after a before-hook)
      // can see it.
      const activeEnvId = s.activeEnvironmentId;
      if (activeEnvId && s.environments[activeEnvId]) {
        const env = s.environments[activeEnvId].data;
        for (const [key, value] of Object.entries(safeEnvVars)) {
          const existing = env.variables.find(v => v.key === key);
          if (existing && !existing.secret) {
            existing.value = value;
          } else if (!existing) {
            env.variables.push({ key, value, enabled: true });
          }
        }
      }
      // Patch globals
      s.globals = { ...s.globals, ...safeGlobals };
      // Persist local vars (sp.variables.set) in session — in-memory only
      s.sessionVars = { ...s.sessionVars, ...safeLocalVars };
    }),
  }))
);
