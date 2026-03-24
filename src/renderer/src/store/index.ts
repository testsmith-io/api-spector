// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  Collection,
  Environment,
  Folder,
  Workspace,
  ApiRequest,
  AuthConfig,
  KeyValuePair,
  DataSet,
  ResponsePayload,
  SentRequest,
  HistoryEntry,
  ScriptExecutionMeta,
  RunRequestResult,
  MockServer,
  MockHit,
  WsMessage,
  ContractReport,
} from '../../../shared/types';
import { v4 as uuidv4 } from 'uuid';
import { uniqueName, colRelPath } from '../../../shared/naming-utils';

export { uniqueName, colRelPath };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(override: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: uuidv4(),
    name: 'New Request',
    method: 'GET',
    url: '',
    headers: [],
    params: [],
    auth: { type: 'none' },
    body: { mode: 'none' },
    ...override,
  };
}

function makeCollection(name: string): Collection {
  return {
    version: '1.0',
    id: uuidv4(),
    name,
    description: '',
    rootFolder: { id: uuidv4(), name: 'root', description: '', folders: [], requestIds: [] },
    requests: {},
  };
}

export function findFolder(root: Folder, id: string): Folder | null {
  if (root.id === id) return root;
  for (const sub of root.folders) {
    const found = findFolder(sub, id);
    if (found) return found;
  }
  return null;
}

function findFolderContaining(root: Folder, reqId: string): Folder | null {
  if (root.requestIds.includes(reqId)) return root;
  for (const sub of root.folders) {
    const found = findFolderContaining(sub, reqId);
    if (found) return found;
  }
  return null;
}

function removeFromFolder(root: Folder, reqId: string): void {
  root.requestIds = root.requestIds.filter(id => id !== reqId);
  root.folders.forEach(sub => removeFromFolder(sub, reqId));
}

function removeFolderById(parent: Folder, folderId: string): boolean {
  const idx = parent.folders.findIndex(f => f.id === folderId);
  if (idx !== -1) { parent.folders.splice(idx, 1); return true; }
  for (const sub of parent.folders) {
    if (removeFolderById(sub, folderId)) return true;
  }
  return false;
}

// ─── Folder path helper (exported for use in components) ─────────────────────

/** Returns the path of folders from root to the folder containing requestId, inclusive of the containing folder. */
export function findFolderPath(root: Folder, requestId: string): Folder[] {
  if (root.requestIds.includes(requestId)) return [root];
  for (const sub of root.folders) {
    const path = findFolderPath(sub, requestId);
    if (path.length > 0) return [root, ...path];
  }
  return [];
}

// ─── Tab model ───────────────────────────────────────────────────────────────

export interface AppTab {
  id: string
  requestId: string | null
  scriptTab: 'pre' | 'post'
  collectionId: string | null
  lastResponse: ResponsePayload | null
  lastScriptResult: ScriptExecutionMeta | null
  lastSentRequest: SentRequest | null
  isSending: boolean
  requestTab: 'params' | 'headers' | 'body' | 'auth' | 'scripts' | 'schema' | 'contract'
}

function makeTab(requestId: string, collectionId: string): AppTab {
  return {
    id: uuidv4(),
    requestId,
    collectionId,
    lastResponse: null,
    lastScriptResult: null,
    lastSentRequest: null,
    isSending: false,
    requestTab: 'params',
    scriptTab: 'pre',
  };
}

// ─── State shape ─────────────────────────────────────────────────────────────

interface AppState {
  workspace: Workspace | null
  workspacePath: string | null
  collections: Record<string, { relPath: string; data: Collection; dirty: boolean }>
  environments: Record<string, { relPath: string; data: Environment }>

  // Multi-tab
  tabs: AppTab[]
  activeTabId: string | null

  // Derived convenience (still exposed for components that read them directly)
  activeCollectionId: string | null
  activeEnvironmentId: string | null

  globals: Record<string, string>

  showGeneratorPanel: boolean
  theme: 'dark' | 'light' | 'system'
  zoom: number
  history: HistoryEntry[]           // newest first, capped at 200
  sidebarTab: 'collections' | 'history' | 'mocks' | 'contracts'

  workspaceSettingsOpen: boolean

  mocks: Record<string, { relPath: string; data: MockServer; running: boolean }>
  activeMockId: string | null
  mockLogs: Record<string, MockHit[]>    // serverId → hits, newest first, capped at 100

  // Command palette
  commandPaletteOpen: boolean

  // Pinned response for diffing
  pinnedResponse: ResponsePayload | null

  // Contract testing
  lastContractReport: ContractReport | null

  // Runner
  runnerModal: {
    open: boolean
    collectionId: string | null
    /** folderId scopes to a folder; null means whole collection */
    folderId: string | null
    /** Pre-selected tag filter */
    filterTags: string[]
  }
  runnerResults: RunRequestResult[]
  runnerRunning: boolean

  // WebSocket connections
  wsConnections: Record<string, {
    status: 'disconnected' | 'connecting' | 'connected' | 'error'
    messages: WsMessage[]
    error?: string
  }>
}

interface AppActions {
  // Workspace
  setWorkspace: (ws: Workspace, path: string) => void
  closeWorkspace: () => void
  updateWorkspaceSettings: (settings: NonNullable<Workspace['settings']>) => void
  setWorkspaceSettingsOpen: (open: boolean) => void
  loadCollection: (relPath: string, data: Collection) => void
  loadEnvironment: (relPath: string, data: Environment) => void
  markCollectionClean: (id: string) => void

  // Tab management
  openInTab: (requestId: string, collectionId: string) => void
  closeTab: (tabId: string) => void
  setActiveTabId: (id: string) => void
  setTabResponse: (tabId: string, response: ResponsePayload | null, scriptResult: ScriptExecutionMeta | null, sentRequest?: SentRequest | null) => void
  setTabSending: (tabId: string, sending: boolean) => void
  setTabRequestTab: (tabId: string, tab: AppTab['requestTab']) => void
  setTabScriptTab: (tabId: string, scriptTab: 'pre' | 'post') => void

  // Navigation
  setActiveCollection: (id: string) => void
  /** @deprecated use openInTab — kept for backwards compat */
  setActiveRequest: (id: string) => void
  setActiveEnvironment: (id: string | null) => void
  /** Operates on the active tab */
  setLastResponse: (r: ResponsePayload | null) => void
  /** Operates on the active tab */
  setLastScriptResult: (r: ScriptExecutionMeta | null) => void
  /** Operates on the active tab */
  setIsSending: (v: boolean) => void
  /** Operates on the active tab */
  setActiveTab: (t: AppTab['requestTab']) => void
  setShowGeneratorPanel: (v: boolean) => void

  // Collection CRUD
  addCollection: (name: string) => void
  renameCollection: (id: string, name: string) => void
  deleteCollection: (id: string) => void

  // Folder CRUD
  addFolder: (collectionId: string, parentFolderId: string, name: string) => void
  renameFolder: (collectionId: string, folderId: string, name: string) => void
  deleteFolder: (collectionId: string, folderId: string) => void

  // Request CRUD
  addRequest: (collectionId: string, folderId: string) => void
  updateRequest: (id: string, patch: Partial<ApiRequest>) => void
  renameRequest: (id: string, name: string) => void
  deleteRequest: (collectionId: string, id: string) => void
  duplicateRequest: (collectionId: string, id: string) => void

  // Tags
  updateFolderTags: (collectionId: string, folderId: string, tags: string[]) => void
  updateRequestTags: (requestId: string, tags: string[]) => void

  // Folder settings (auth & headers)
  updateFolder: (collectionId: string, folderId: string, patch: Partial<Folder>) => void

  // Command palette
  setCommandPaletteOpen: (open: boolean) => void

  // Pinned response
  setPinnedResponse: (r: ResponsePayload | null) => void

  // Contract testing
  setLastContractReport: (r: ContractReport | null) => void

  // Inherited auth/headers selector
  getInheritedAuthAndHeaders: (requestId: string) => { auth: AuthConfig | null; headers: KeyValuePair[] }

  // Environment CRUD
  updateEnvironment: (id: string, data: Environment) => void
  addEnvironment: () => void
  deleteEnvironment: (id: string) => void

  // Collection dataset
  updateCollectionDataSet: (id: string, ds: DataSet) => void

  // Globals
  setGlobals: (globals: Record<string, string>) => void
  patchGlobals: (patch: Record<string, string>) => void

  // Runner modal
  openRunner: (collectionId: string, folderId?: string | null, filterTags?: string[]) => void
  closeRunner: () => void
  setRunnerResults: (results: RunRequestResult[]) => void
  patchRunnerResult: (idx: number, patch: Partial<RunRequestResult>) => void
  setRunnerRunning: (v: boolean) => void

  // Apply script result back into store (env/collection vars + globals)
  applyScriptUpdates: (result: ScriptExecutionMeta) => void

  // Theme & zoom
  setTheme: (t: 'dark' | 'light' | 'system') => void
  setZoom: (z: number) => void

  // History
  addHistoryEntry: (entry: HistoryEntry) => void
  clearHistory: () => void
  setSidebarTab: (tab: AppState['sidebarTab']) => void

  // Mock servers
  loadMock: (relPath: string, data: MockServer) => void
  addMock: () => void
  updateMock: (id: string, data: MockServer) => void
  deleteMock: (id: string) => void
  setMockRunning: (id: string, running: boolean) => void
  setActiveMockId: (id: string | null) => void
  addMockHit: (hit: MockHit) => void
  clearMockLogs: (serverId: string) => void

  // WebSocket actions
  setWsStatus: (requestId: string, status: 'disconnected' | 'connecting' | 'connected' | 'error', error?: string) => void
  addWsMessage: (requestId: string, message: WsMessage) => void
  clearWsMessages: (requestId: string) => void
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useStore = create<AppState & AppActions>()(
  immer((set) => ({
    workspace: null,
    workspacePath: null,
    collections: {},
    environments: {},
    tabs: [],
    activeTabId: null,
    activeCollectionId: null,
    activeEnvironmentId: localStorage.getItem('activeEnvironmentId') ?? null,
    globals: {},
    showGeneratorPanel: false,
    theme: (localStorage.getItem('theme') as 'dark' | 'light' | 'system') ?? 'dark',
    zoom: Number(localStorage.getItem('zoom') ?? '1'),
    history: [],
    sidebarTab: 'collections',
    workspaceSettingsOpen: false,
    mocks: {},
    activeMockId: null,
    mockLogs: {},
    runnerModal: { open: false, collectionId: null, folderId: null, filterTags: [] },
    runnerResults: [],
    runnerRunning: false,
    commandPaletteOpen: false,
    pinnedResponse: null,
    lastContractReport: null,
    wsConnections: {},

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
      s.runnerResults       = [];
      s.runnerRunning       = false;
      s.runnerModal         = { open: false, collectionId: null, folderId: null, filterTags: [] };
      s.history             = [];
      s.mockLogs            = {};
      s.wsConnections       = {};
      s.pinnedResponse      = null;
      s.lastContractReport  = null;
    }),

    updateWorkspaceSettings: (settings) => set(s => {
      if (s.workspace) s.workspace.settings = settings;
    }),

    setWorkspaceSettingsOpen: (open) => set(s => { s.workspaceSettingsOpen = open; }),

    loadCollection: (relPath, data) => set(s => {
      s.collections[data.id] = { relPath, data, dirty: false };
    }),

    loadEnvironment: (relPath, data) => set(s => {
      s.environments[data.id] = { relPath, data };
    }),

    markCollectionClean: (id) => set(s => {
      if (s.collections[id]) s.collections[id].dirty = false;
    }),

    // ── Tab management ────────────────────────────────────────────────────────
    openInTab: (requestId, collectionId) => set(s => {
      const existing = s.tabs.find(t => t.requestId === requestId);
      if (existing) {
        s.activeTabId = existing.id;
        s.activeCollectionId = collectionId;
      } else {
        const tab = makeTab(requestId, collectionId);
        s.tabs.push(tab);
        s.activeTabId = tab.id;
        s.activeCollectionId = collectionId;
      }
    }),

    closeTab: (tabId) => set(s => {
      const idx = s.tabs.findIndex(t => t.id === tabId);
      if (idx === -1) return;
      s.tabs.splice(idx, 1);
      if (s.activeTabId === tabId) {
        // Activate adjacent tab: prefer right, then left, then null
        const next = s.tabs[idx] ?? s.tabs[idx - 1] ?? null;
        s.activeTabId = next?.id ?? null;
        s.activeCollectionId = next?.collectionId ?? null;
      }
    }),

    setActiveTabId: (id) => set(s => {
      s.activeTabId = id;
      const tab = s.tabs.find(t => t.id === id);
      if (tab) s.activeCollectionId = tab.collectionId;
    }),

    setTabResponse: (tabId, response, scriptResult, sentRequest) => set(s => {
      const tab = s.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.lastResponse = response;
        tab.lastScriptResult = scriptResult;
        if (sentRequest !== undefined) tab.lastSentRequest = sentRequest ?? null;
      }
    }),

    setTabSending: (tabId, sending) => set(s => {
      const tab = s.tabs.find(t => t.id === tabId);
      if (tab) tab.isSending = sending;
    }),

    setTabRequestTab: (tabId, tab) => set(s => {
      const t = s.tabs.find(x => x.id === tabId);
      if (t) t.requestTab = tab;
    }),

    setTabScriptTab: (tabId, scriptTab) => set(s => {
      const t = s.tabs.find(x => x.id === tabId);
      if (t) t.scriptTab = scriptTab;
    }),

    // ── Navigation ────────────────────────────────────────────────────────────
    setActiveCollection: id => set(s => {
      s.activeCollectionId = id;
      // If active tab has a request in a different collection, clear it
      const activeTab = s.tabs.find(t => t.id === s.activeTabId);
      if (activeTab && activeTab.collectionId !== id) {
        activeTab.lastResponse = null;
        activeTab.lastScriptResult = null;
      }
    }),

    // Backwards compat: opens or switches to a tab for this request
    setActiveRequest: (id) => set(s => {
      // Find which collection owns this request
      const colEntry = Object.values(s.collections).find(c => c.data.requests[id]);
      const collectionId = colEntry?.data.id ?? s.activeCollectionId ?? '';
      const existing = s.tabs.find(t => t.requestId === id);
      if (existing) {
        s.activeTabId = existing.id;
        s.activeCollectionId = existing.collectionId;
      } else {
        const tab = makeTab(id, collectionId);
        s.tabs.push(tab);
        s.activeTabId = tab.id;
        s.activeCollectionId = collectionId;
      }
    }),

    setActiveEnvironment: id => set(s => {
      s.activeEnvironmentId = id;
      if (id) localStorage.setItem('activeEnvironmentId', id);
      else localStorage.removeItem('activeEnvironmentId');
    }),

    // These operate on the active tab for backwards compat
    setLastResponse: r => set(s => {
      const tab = s.tabs.find(t => t.id === s.activeTabId);
      if (tab) tab.lastResponse = r;
    }),
    setLastScriptResult: r => set(s => {
      const tab = s.tabs.find(t => t.id === s.activeTabId);
      if (tab) tab.lastScriptResult = r;
    }),
    setIsSending: v => set(s => {
      const tab = s.tabs.find(t => t.id === s.activeTabId);
      if (tab) tab.isSending = v;
    }),
    setActiveTab: t => set(s => {
      const tab = s.tabs.find(x => x.id === s.activeTabId);
      if (tab) tab.requestTab = t;
    }),
    setShowGeneratorPanel: v => set(s => { s.showGeneratorPanel = v; }),

    // ── Collection CRUD ───────────────────────────────────────────────────────
    addCollection: (name) => set(s => {
      const existingNames = Object.values(s.collections).map(c => c.data.name);
      const safeName = uniqueName(name, existingNames);
      const col = makeCollection(safeName);
      const relPath = colRelPath(safeName, col.id);
      s.collections[col.id] = { relPath, data: col, dirty: true };
      s.activeCollectionId = col.id;
      if (s.workspace) s.workspace.collections.push(relPath);
    }),

    renameCollection: (id, name) => set(s => {
      if (!s.collections[id]) return;
      const oldRelPath = s.collections[id].relPath;
      const newRelPath = colRelPath(name, id);
      s.collections[id].data.name = name;
      s.collections[id].relPath = newRelPath;
      s.collections[id].dirty = true;
      if (s.workspace && oldRelPath !== newRelPath) {
        s.workspace.collections = s.workspace.collections.map(p => p === oldRelPath ? newRelPath : p);
      }
    }),

    deleteCollection: (id) => set(s => {
      const relPath = s.collections[id]?.relPath;
      delete s.collections[id];
      if (s.workspace && relPath) {
        s.workspace.collections = s.workspace.collections.filter(p => p !== relPath);
      }
      // Close any tabs belonging to this collection
      s.tabs = s.tabs.filter(t => t.collectionId !== id);
      if (s.activeCollectionId === id) {
        s.activeCollectionId = Object.keys(s.collections)[0] ?? null;
        const activeTab = s.tabs.find(t => t.id === s.activeTabId);
        if (!activeTab) s.activeTabId = s.tabs[0]?.id ?? null;
      }
    }),

    updateCollectionDataSet: (id, ds) => set(s => {
      if (!s.collections[id]) return;
      s.collections[id].data.dataSet = ds;
      s.collections[id].dirty = true;
    }),

    // ── Folder CRUD ───────────────────────────────────────────────────────────
    addFolder: (collectionId, parentFolderId, name) => set(s => {
      const col = s.collections[collectionId]?.data;
      if (!col) return;
      const parent = findFolder(col.rootFolder, parentFolderId);
      if (!parent) return;
      parent.folders.push({ id: uuidv4(), name, description: '', folders: [], requestIds: [] });
      s.collections[collectionId].dirty = true;
    }),

    renameFolder: (collectionId, folderId, name) => set(s => {
      const col = s.collections[collectionId]?.data;
      if (!col) return;
      const folder = findFolder(col.rootFolder, folderId);
      if (folder) { folder.name = name; s.collections[collectionId].dirty = true; }
    }),

    deleteFolder: (collectionId, folderId) => set(s => {
      const col = s.collections[collectionId]?.data;
      if (!col) return;
      function collectIds(f: Folder): string[] {
        return [...f.requestIds, ...f.folders.flatMap(collectIds)];
      }
      const folder = findFolder(col.rootFolder, folderId);
      if (folder) {
        collectIds(folder).forEach(rid => delete col.requests[rid]);
      }
      removeFolderById(col.rootFolder, folderId);
      s.collections[collectionId].dirty = true;
    }),

    // ── Request CRUD ──────────────────────────────────────────────────────────
    addRequest: (collectionId, folderId) => set(s => {
      const col = s.collections[collectionId]?.data;
      if (!col) return;
      const req = makeRequest();
      col.requests[req.id] = req;
      const folder = findFolder(col.rootFolder, folderId) ?? col.rootFolder;
      folder.requestIds.push(req.id);
      s.activeCollectionId = collectionId;
      s.collections[collectionId].dirty = true;
      // Open in a new tab
      const tab = makeTab(req.id, collectionId);
      s.tabs.push(tab);
      s.activeTabId = tab.id;
    }),

    updateRequest: (id, patch) => set(s => {
      const entry = Object.values(s.collections).find(c => c.data.requests[id]);
      if (!entry) return;
      Object.assign(entry.data.requests[id], patch);
      entry.dirty = true;
    }),

    renameRequest: (id, name) => set(s => {
      const entry = Object.values(s.collections).find(c => c.data.requests[id]);
      if (!entry) return;
      entry.data.requests[id].name = name;
      entry.dirty = true;
    }),

    deleteRequest: (collectionId, id) => set(s => {
      const col = s.collections[collectionId]?.data;
      if (!col) return;
      delete col.requests[id];
      removeFromFolder(col.rootFolder, id);
      // Close any tab that had this request open
      const tabIdx = s.tabs.findIndex(t => t.requestId === id);
      if (tabIdx !== -1) {
        const wasActive = s.tabs[tabIdx].id === s.activeTabId;
        s.tabs.splice(tabIdx, 1);
        if (wasActive) {
          const next = s.tabs[tabIdx] ?? s.tabs[tabIdx - 1] ?? null;
          s.activeTabId = next?.id ?? null;
          s.activeCollectionId = next?.collectionId ?? null;
        }
      }
      s.collections[collectionId].dirty = true;
    }),

    duplicateRequest: (collectionId, id) => set(s => {
      const col = s.collections[collectionId]?.data;
      if (!col || !col.requests[id]) return;
      const orig = col.requests[id];
      const copy: ApiRequest = { ...JSON.parse(JSON.stringify(orig)), id: uuidv4(), name: orig.name + ' (copy)' };
      col.requests[copy.id] = copy;
      const folder = findFolderContaining(col.rootFolder, id);
      if (folder) {
        const idx = folder.requestIds.indexOf(id);
        folder.requestIds.splice(idx + 1, 0, copy.id);
      }
      s.collections[collectionId].dirty = true;
      // Open copy in a new tab
      const tab = makeTab(copy.id, collectionId);
      s.tabs.push(tab);
      s.activeTabId = tab.id;
    }),

    // ── Tags ──────────────────────────────────────────────────────────────────
    updateFolderTags: (collectionId, folderId, tags) => set(s => {
      const col = s.collections[collectionId]?.data;
      if (!col) return;
      const folder = findFolder(col.rootFolder, folderId);
      if (folder) { folder.tags = tags; s.collections[collectionId].dirty = true; }
    }),

    updateRequestTags: (requestId, tags) => set(s => {
      const entry = Object.values(s.collections).find(c => c.data.requests[requestId]);
      if (!entry) return;
      const req = entry.data.requests[requestId];
      req.meta = { ...(req.meta ?? {}), tags };
      entry.dirty = true;
    }),

    // ── Folder settings ───────────────────────────────────────────────────────
    updateFolder: (collectionId, folderId, patch) => set(s => {
      const col = s.collections[collectionId]?.data;
      if (!col) return;
      const folder = findFolder(col.rootFolder, folderId);
      if (folder) {
        Object.assign(folder, patch);
        s.collections[collectionId].dirty = true;
      }
    }),

    // ── Command palette ───────────────────────────────────────────────────────
    setCommandPaletteOpen: (open) => set(s => { s.commandPaletteOpen = open; }),

    // ── Pinned response ───────────────────────────────────────────────────────
    setPinnedResponse: (r) => set(s => { s.pinnedResponse = r; }),

    // ── Contract testing ──────────────────────────────────────────────────────
    setLastContractReport: (r) => set(s => { s.lastContractReport = r; }),

    // ── Inherited auth/headers ────────────────────────────────────────────────
    getInheritedAuthAndHeaders: (requestId) => {
      const state = useStore.getState();
      // Find which collection owns this request
      const colEntry = Object.values(state.collections).find(c => c.data.requests[requestId]);
      if (!colEntry) return { auth: null, headers: [] };
      const path = findFolderPath(colEntry.data.rootFolder, requestId);
      // Remove the root folder from the path since it has no auth/headers by convention
      // Walk from root to deepest, collecting auth and headers
      let inheritedAuth: AuthConfig | null = null;
      let inheritedHeaders: KeyValuePair[] = [];
      for (const folder of path) {
        if (folder.auth && folder.auth.type !== 'none') {
          inheritedAuth = folder.auth;
        }
        if (folder.headers && folder.headers.length > 0) {
          inheritedHeaders = [...inheritedHeaders, ...folder.headers];
        }
      }
      return { auth: inheritedAuth, headers: inheritedHeaders };
    },

    // ── Environment CRUD ──────────────────────────────────────────────────────
    updateEnvironment: (id, data) => set(s => {
      if (s.environments[id]) s.environments[id].data = data;
    }),

    addEnvironment: () => set(s => {
      const existingNames = Object.values(s.environments).map(e => e.data.name);
      const envName = uniqueName('New Environment', existingNames);
      const env: Environment = {
        version: '1.0',
        id: uuidv4(),
        name: envName,
        variables: [],
      };
      const relPath = `environments/new-environment.env.json`;
      s.environments[env.id] = { relPath, data: env };
      s.activeEnvironmentId = env.id;
      if (s.workspace) s.workspace.environments.push(relPath);
    }),

    deleteEnvironment: (id) => set(s => {
      const relPath = s.environments[id]?.relPath;
      delete s.environments[id];
      if (s.activeEnvironmentId === id) s.activeEnvironmentId = null;
      if (relPath && s.workspace) {
        s.workspace.environments = s.workspace.environments.filter(p => p !== relPath);
      }
    }),

    // ── Globals ───────────────────────────────────────────────────────────────
    setGlobals: (globals) => set(s => { s.globals = globals; }),
    patchGlobals: (patch) => set(s => { s.globals = { ...s.globals, ...patch }; }),

    // ── Apply script results back to store ────────────────────────────────────
    applyScriptUpdates: (result) => set(s => {
      // Patch collection vars on the active collection
      const activeColId = s.activeCollectionId;
      if (activeColId && s.collections[activeColId]) {
        const col = s.collections[activeColId].data;
        col.collectionVariables = {
          ...(col.collectionVariables ?? {}),
          ...result.updatedCollectionVars,
        };
        s.collections[activeColId].dirty = true;
      }
      // Patch env vars back into the active environment
      const activeEnvId = s.activeEnvironmentId;
      if (activeEnvId && s.environments[activeEnvId]) {
        const env = s.environments[activeEnvId].data;
        for (const [key, value] of Object.entries(result.updatedEnvVars)) {
          const v = env.variables.find(v => v.key === key);
          if (v && !v.secret) v.value = value;
        }
      }
      // Patch globals
      s.globals = { ...s.globals, ...result.updatedGlobals };
    }),

    // ── Theme & zoom ──────────────────────────────────────────────────────────
    setTheme: (t) => set(s => {
      s.theme = t;
      localStorage.setItem('theme', t);
      if (t === 'system') {
        const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.classList.toggle('light', !dark);
      } else {
        document.documentElement.classList.toggle('light', t === 'light');
      }
    }),

    setZoom: (z) => set(s => {
      s.zoom = z;
      localStorage.setItem('zoom', String(z));
      document.documentElement.style.zoom = String(z);
    }),

    // ── Runner modal ──────────────────────────────────────────────────────────
    openRunner: (collectionId, folderId = null, filterTags = []) => set(s => {
      s.runnerModal = { open: true, collectionId, folderId, filterTags };
      s.runnerResults = [];
    }),
    closeRunner: () => set(s => { s.runnerModal.open = false; s.runnerRunning = false; }),
    setRunnerResults: (results) => set(s => { s.runnerResults = results; }),
    patchRunnerResult: (idx, patch) => set(s => {
      if (s.runnerResults[idx]) Object.assign(s.runnerResults[idx], patch);
    }),
    setRunnerRunning: (v) => set(s => { s.runnerRunning = v; }),

    // ── History ───────────────────────────────────────────────────────────────
    addHistoryEntry: (entry) => set(s => {
      s.history.unshift(entry);
      if (s.history.length > 200) s.history.length = 200;
    }),
    clearHistory: () => set(s => { s.history = []; }),
    setSidebarTab: (tab) => set(s => { s.sidebarTab = tab; }),

    // ── Mock servers ──────────────────────────────────────────────────────────
    loadMock: (relPath, data) => set(s => {
      s.mocks[data.id] = { relPath, data, running: false };
    }),

    addMock: () => set(s => {
      const mock: MockServer = {
        version: '1.0',
        id: uuidv4(),
        name: 'New Mock Server',
        port: 3900,
        routes: [],
      };
      const relPath = `mocks/${mock.id}.mock.json`;
      s.mocks[mock.id] = { relPath, data: mock, running: false };
      s.activeMockId = mock.id;
      if (s.workspace) {
        if (!s.workspace.mocks) s.workspace.mocks = [];
        s.workspace.mocks.push(relPath);
      }
    }),

    updateMock: (id, data) => set(s => {
      if (s.mocks[id]) s.mocks[id].data = data;
    }),

    deleteMock: (id) => set(s => {
      const relPath = s.mocks[id]?.relPath;
      delete s.mocks[id];
      if (s.workspace?.mocks && relPath) {
        s.workspace.mocks = s.workspace.mocks.filter(p => p !== relPath);
      }
      if (s.activeMockId === id) s.activeMockId = null;
    }),

    setMockRunning: (id, running) => set(s => {
      if (s.mocks[id]) s.mocks[id].running = running;
    }),

    setActiveMockId: (id) => set(s => { s.activeMockId = id; }),

    addMockHit: (hit) => set(s => {
      if (!s.mockLogs[hit.serverId]) s.mockLogs[hit.serverId] = [];
      s.mockLogs[hit.serverId].unshift(hit);
      if (s.mockLogs[hit.serverId].length > 100) s.mockLogs[hit.serverId].length = 100;
    }),

    clearMockLogs: (serverId) => set(s => { s.mockLogs[serverId] = []; }),

    // ── WebSocket ─────────────────────────────────────────────────────────────
    setWsStatus: (requestId, status, error) => set(s => {
      if (!s.wsConnections[requestId]) {
        s.wsConnections[requestId] = { status, messages: [], error };
      } else {
        s.wsConnections[requestId].status = status;
        s.wsConnections[requestId].error = error;
      }
    }),

    addWsMessage: (requestId, message) => set(s => {
      if (!s.wsConnections[requestId]) {
        s.wsConnections[requestId] = { status: 'connected', messages: [message] };
      } else {
        s.wsConnections[requestId].messages.push(message);
      }
    }),

    clearWsMessages: (requestId) => set(s => {
      if (s.wsConnections[requestId]) {
        s.wsConnections[requestId].messages = [];
      }
    }),
  }))
);
