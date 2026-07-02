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

export interface AppTab {
  id: string
  requestId: string | null
  scriptTab: 'pre' | 'post'
  collectionId: string | null
  lastResponse: ResponsePayload | null
  lastScriptResult: ScriptExecutionMeta | null
  lastSentRequest: SentRequest | null
  lastHookResults: RunRequestResult[] | null
  isSending: boolean
  requestTab: 'params' | 'headers' | 'body' | 'auth' | 'scripts' | 'schema' | 'contract'
}

export function makeTab(requestId: string, collectionId: string, opts: { protocol?: ApiRequest['protocol'] } = {}): AppTab {
  return {
    id: uuidv4(),
    requestId,
    collectionId,
    lastResponse: null,
    lastScriptResult: null,
    lastSentRequest: null,
    lastHookResults: null,
    isSending: false,
    // SOAP requests: 'params' isn't even shown for SOAP and 'body' renders the
    // WSDL-driven SoapEditor — that's the primary surface, so jump there.
    // HTTP/WebSocket: keep the existing 'params' default.
    requestTab: opts.protocol === 'soap' ? 'body' : 'params',
    // Default to the post-response tab — that's where the typical workflow
    // (assertions, extracting tokens, saving variables) lives.
    scriptTab: 'post',
  };
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
    const existing = s.tabs.find(t => t.requestId === requestId);
    if (existing) {
      s.activeTabId = existing.id;
      s.activeCollectionId = collectionId;
    } else {
      const tab = makeTab(requestId, collectionId, { protocol: protocolFor(s, requestId) });
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

  closeAllTabs: () => set(s => {
    s.tabs = [];
    s.activeTabId = null;
    // Don't clear activeCollectionId — the sidebar selection should stay put.
  }),

  closeOtherTabs: (keepTabId) => set(s => {
    const kept = s.tabs.find(t => t.id === keepTabId);
    s.tabs = kept ? [kept] : [];
    s.activeTabId = kept?.id ?? null;
    if (kept) s.activeCollectionId = kept.collectionId;
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
