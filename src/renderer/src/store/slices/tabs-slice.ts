// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type {
  ApiRequest,
  Collection,
  ResponsePayload,
  RunRequestResult,
  ScriptExecutionMeta,
  SentRequest,
} from '../../../../shared/types';
import type { FullState } from '../index';

// ─── Tab model ───────────────────────────────────────────────────────────────

/** What a tab shows. A collection and a folder now open as tabs too (not a
 *  separate panel that drew over the request tabs), so the whole main area is
 *  one consistent tab strip. */
export type TabKind = 'request' | 'folder' | 'collection'

export interface AppTab {
  id: string
  kind: TabKind
  requestId: string | null
  /** Set on a folder tab — the folder it shows. */
  folderId?: string | null
  /** When set, this tab is editing an EXAMPLE of `requestId` (its overrides +
   *  saved response), not the base request. Null/undefined = the base request. */
  exampleId?: string | null
  scriptTab: 'pre' | 'post'
  collectionId: string | null
  lastResponse: ResponsePayload | null
  lastScriptResult: ScriptExecutionMeta | null
  lastSentRequest: SentRequest | null
  lastHookResults: RunRequestResult[] | null
  isSending: boolean
  requestTab: 'params' | 'headers' | 'body' | 'auth' | 'scripts' | 'schema' | 'contract' | 'stream' | 'docs' | 'variables'
}

function baseTab(collectionId: string | null): Omit<AppTab, 'kind' | 'requestId' | 'folderId' | 'exampleId' | 'requestTab'> {
  return {
    id: uuidv4(),
    collectionId,
    lastResponse: null,
    lastScriptResult: null,
    lastSentRequest: null,
    lastHookResults: null,
    isSending: false,
    scriptTab: 'post',
  };
}

export function makeTab(requestId: string, collectionId: string, opts: { protocol?: ApiRequest['protocol']; exampleId?: string | null; defaultTab?: AppTab['requestTab'] } = {}): AppTab {
  return {
    ...baseTab(collectionId),
    kind: 'request',
    requestId,
    folderId: null,
    exampleId: opts.exampleId ?? null,
    // Examples have no Docs tab and fall back to Body (see RequestBuilder).
    // Otherwise open on the workspace's configured default sub-tab (Docs unless
    // the workspace overrides it).
    requestTab: opts.exampleId ? 'body' : (opts.defaultTab ?? 'docs'),
  };
}

export function makeFolderTab(collectionId: string, folderId: string): AppTab {
  return { ...baseTab(collectionId), kind: 'folder', requestId: null, folderId, exampleId: null, requestTab: 'docs' };
}

export function makeCollectionTab(collectionId: string): AppTab {
  return { ...baseTab(collectionId), kind: 'collection', requestId: null, folderId: null, exampleId: null, requestTab: 'docs' };
}

/** Keep the legacy panel flags (`folderPanel`, `collectionPanelOpen`) and
 *  `activeCollectionId` in lockstep with whatever the active tab is, so the
 *  main area (which still switches on those flags) shows the active tab's
 *  content and nothing overlaps. Call this anywhere `activeTabId` changes. */
export function syncPanelsToActiveTab(s: {
  tabs: AppTab[]
  activeTabId: string | null
  activeCollectionId: string | null
  collectionPanelOpen: boolean
  folderPanel: { collectionId: string; folderId: string } | null
}): void {
  const tab = s.tabs.find(t => t.id === s.activeTabId);
  if (!tab) { s.collectionPanelOpen = false; s.folderPanel = null; return; }
  if (tab.collectionId) s.activeCollectionId = tab.collectionId;
  if (tab.kind === 'folder' && tab.collectionId && tab.folderId) {
    s.folderPanel = { collectionId: tab.collectionId, folderId: tab.folderId };
    s.collectionPanelOpen = false;
  } else if (tab.kind === 'collection') {
    s.collectionPanelOpen = true;
    s.folderPanel = null;
  } else {
    s.folderPanel = null;
    s.collectionPanelOpen = false;
  }
}

/** Look up a request's protocol by id across all loaded collections.
 *  Returns undefined for unknown ids — caller defaults to HTTP behavior. */
export function protocolFor(
  state: { collections: Record<string, { relPath: string; data: Collection; dirty: boolean }> },
  requestId: string,
): ApiRequest['protocol'] {
  for (const c of Object.values(state.collections)) {
    const r = c.data.requests[requestId];
    if (r) return r.protocol;
  }
  return undefined;
}

// ─── Slice ───────────────────────────────────────────────────────────────────

export interface TabsSliceState {
  tabs: AppTab[]
  activeTabId: string | null

  // Derived convenience (still exposed for components that read it directly)
  activeCollectionId: string | null
}

export interface TabsSliceActions {
  openInTab: (requestId: string, collectionId: string) => void
  /** Open (or focus) a tab showing a folder's data panel. */
  openFolderTab: (collectionId: string, folderId: string) => void
  /** Open (or focus) a tab showing a collection's data panel. */
  openCollectionTab: (collectionId: string) => void
  closeTab: (tabId: string) => void
  closeAllTabs: () => void
  closeOtherTabs: (keepTabId: string) => void
  setActiveTabId: (id: string) => void
  setTabResponse: (tabId: string, response: ResponsePayload | null, scriptResult: ScriptExecutionMeta | null, sentRequest?: SentRequest | null) => void
  setTabHookResults: (tabId: string, results: RunRequestResult[] | null) => void
  setTabSending: (tabId: string, sending: boolean) => void
  setTabRequestTab: (tabId: string, tab: AppTab['requestTab']) => void
  setTabScriptTab: (tabId: string, scriptTab: 'pre' | 'post') => void

  // Navigation
  setActiveCollection: (id: string) => void
  /** @deprecated use openInTab — kept for backwards compat */
  setActiveRequest: (id: string) => void
  /** Operates on the active tab */
  setLastResponse: (r: ResponsePayload | null) => void
  /** Operates on the active tab */
  setLastScriptResult: (r: ScriptExecutionMeta | null) => void
  /** Operates on the active tab */
  setIsSending: (v: boolean) => void
  /** Operates on the active tab */
  setActiveTab: (t: AppTab['requestTab']) => void
}

export type TabsSlice = TabsSliceState & TabsSliceActions

export const createTabsSlice: StateCreator<
  FullState,
  [['zustand/immer', never]],
  [],
  TabsSlice
> = (set, get) => ({
  tabs: [],
  activeTabId: null,
  activeCollectionId: null,

  openInTab: (requestId, collectionId) => set(s => {
    const existing = s.tabs.find(t => t.kind === 'request' && t.requestId === requestId && !t.exampleId);
    if (existing) {
      s.activeTabId = existing.id;
    } else {
      const tab = makeTab(requestId, collectionId, { protocol: protocolFor(s, requestId), defaultTab: s.workspace?.settings?.defaultRequestTab });
      s.tabs.push(tab);
      s.activeTabId = tab.id;
    }
    s.activeCollectionId = collectionId;
    syncPanelsToActiveTab(s);
  }),

  openFolderTab: (collectionId, folderId) => set(s => {
    const existing = s.tabs.find(t => t.kind === 'folder' && t.folderId === folderId && t.collectionId === collectionId);
    if (existing) s.activeTabId = existing.id;
    else { const tab = makeFolderTab(collectionId, folderId); s.tabs.push(tab); s.activeTabId = tab.id; }
    syncPanelsToActiveTab(s);
  }),

  openCollectionTab: (collectionId) => set(s => {
    const existing = s.tabs.find(t => t.kind === 'collection' && t.collectionId === collectionId);
    if (existing) s.activeTabId = existing.id;
    else { const tab = makeCollectionTab(collectionId); s.tabs.push(tab); s.activeTabId = tab.id; }
    syncPanelsToActiveTab(s);
  }),

  closeTab: (tabId) => set(s => {
    const idx = s.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;
    s.tabs.splice(idx, 1);
    if (s.activeTabId === tabId) {
      // Activate adjacent tab: prefer right, then left, then null
      const next = s.tabs[idx] ?? s.tabs[idx - 1] ?? null;
      s.activeTabId = next?.id ?? null;
      syncPanelsToActiveTab(s);
    }
  }),

  closeAllTabs: () => set(s => {
    s.tabs = [];
    s.activeTabId = null;
    s.collectionPanelOpen = false;
    s.folderPanel = null;
    // Don't clear activeCollectionId — the sidebar selection should stay put.
  }),

  closeOtherTabs: (keepTabId) => set(s => {
    const kept = s.tabs.find(t => t.id === keepTabId);
    s.tabs = kept ? [kept] : [];
    s.activeTabId = kept?.id ?? null;
    syncPanelsToActiveTab(s);
  }),

  setActiveTabId: (id) => set(s => {
    s.activeTabId = id;
    syncPanelsToActiveTab(s);
  }),

  setTabResponse: (tabId, response, scriptResult, sentRequest) => set(s => {
    const tab = s.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.lastResponse = response;
      tab.lastScriptResult = scriptResult;
      if (sentRequest !== undefined) tab.lastSentRequest = sentRequest ?? null;
    }
  }),

  setTabHookResults: (tabId, results) => set(s => {
    const tab = s.tabs.find(t => t.id === tabId);
    if (tab) tab.lastHookResults = results;
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

  // ── Navigation ──────────────────────────────────────────────────────────────
  setActiveCollection: id => set(s => {
    s.activeCollectionId = id;
    // If active tab has a request in a different collection, clear it
    const activeTab = s.tabs.find(t => t.id === s.activeTabId);
    if (activeTab && activeTab.collectionId !== id) {
      activeTab.lastResponse = null;
      activeTab.lastScriptResult = null;
    }
  }),

  // Backwards compat: opens or switches to a tab for this request.
  // Delegates to openInTab after resolving which collection owns the request.
  setActiveRequest: (id) => {
    const state = get();
    const colEntry = Object.values(state.collections).find(c => c.data.requests[id]);
    const collectionId = colEntry?.data.id ?? state.activeCollectionId ?? '';
    get().openInTab(id, collectionId);
  },

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
});
