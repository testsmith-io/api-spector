// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Workspace-agnostic UI chrome: theme, zoom, sidebar, command palette, pane
// flags. Theme/zoom mirror into workspace.settings and always into localStorage
// (so the welcome screen remembers them without a workspace open).

import type { StateCreator } from 'zustand';
import type { ResponsePayload } from '../../../../shared/types';
import type { FullState } from '../index';
import { STORAGE_KEYS } from '../../lib/storage-keys';

export type Theme = 'dark' | 'light' | 'system';

export interface UiSliceState {
  showGeneratorPanel: boolean
  theme: Theme
  zoom: number
  sidebarTab: 'collections' | 'history' | 'mocks' | 'contracts' | 'git' | 'flows' | 'perf'
  /** The selected performance test plan (perfPlans live inline in the workspace). */
  activePerfPlanId: string | null

  workspaceSettingsOpen: boolean
  /** When set, the settings modal opens on this tab (e.g. 'cloud' from a nudge). */
  workspaceSettingsTab: string | null

  // Command palette
  commandPaletteOpen: boolean

  // Pinned response for diffing
  pinnedResponse: ResponsePayload | null

  /** With sidebarTab === 'git', the main pane renders this file's diff at full
   *  width instead of the request builder. */
  activeGitDiff: { path: string; staged: boolean } | null

  /** Scripts-tab "Quick Inserts" sidebar visibility; in the store so handleAssert
   *  can collapse it after adding a snippet. */
  quickInsertsOpen: boolean

  /** Show the collection/folder data panel over an open request tab. Cleared when
   *  a request tab is (re)activated, so it's "bring to front", not a mode. */
  collectionPanelOpen: boolean
  /** Show the folder panel (docs/data/variables). Exclusive with a request tab / collection panel. */
  folderPanel: { collectionId: string; folderId: string } | null
  coverageOpen: boolean
  compareOpen: boolean

  /** Counter bumped by requestSend(); the active RequestBuilder watches it and
   *  replays the request through its normal send pipeline. */
  sendSignal: number

  /** Which editor pane sub-tab navigation targets; drives the focus ring too. */
  focusedPane: 'request' | 'response'
  /** Bumped by cycleSubTab(): the focused pane watches `nonce` and moves to the
   *  previous/next of its own visible sub-tabs. */
  subTabCycle: { nonce: number; pane: 'request' | 'response'; dir: -1 | 1 }
}

export interface UiSliceActions {
  setShowGeneratorPanel: (v: boolean) => void
  setTheme: (t: Theme) => void
  setZoom: (z: number) => void
  setSidebarTab: (tab: UiSliceState['sidebarTab']) => void
  setActivePerfPlanId: (id: string | null) => void
  setWorkspaceSettingsOpen: (open: boolean) => void
  /** Open the settings modal, optionally jumping straight to a tab. */
  openWorkspaceSettings: (tab?: string | null) => void
  setCommandPaletteOpen: (open: boolean) => void
  setPinnedResponse: (r: ResponsePayload | null) => void
  setActiveGitDiff: (d: { path: string; staged: boolean } | null) => void
  setQuickInsertsOpen: (open: boolean) => void
  /** Ask the active request builder to (re)send the current request. */
  requestSend: () => void
  /** Move keyboard focus to a pane (request / response) for sub-tab navigation. */
  setFocusedPane: (pane: 'request' | 'response') => void
  /** Ask the focused pane to move to its previous (-1) or next (1) sub-tab. */
  cycleSubTab: (dir: -1 | 1) => void
  /** Show or hide the collection/folder data panel over an open request. */
  setCollectionPanelOpen: (open: boolean) => void
  /** Bring the folder panel (docs/data/variables) to the front for a folder. */
  openFolderPanel: (collectionId: string, folderId: string) => void
  setCoverageOpen: (open: boolean) => void
  setCoverageSpec: (spec: string) => void
  setCompareOpen: (open: boolean) => void
}

export type UiSlice = UiSliceState & UiSliceActions

export const createUiSlice: StateCreator<
  FullState,
  [['zustand/immer', never]],
  [],
  UiSlice
> = (set, get) => ({
  showGeneratorPanel: false,
  theme: (localStorage.getItem(STORAGE_KEYS.theme) as Theme) ?? 'dark',
  zoom: Number(localStorage.getItem(STORAGE_KEYS.zoom) ?? '1.1'),
  sidebarTab: 'collections' as UiSliceState['sidebarTab'],
  activePerfPlanId: null,
  workspaceSettingsOpen: false,
  workspaceSettingsTab: null,
  commandPaletteOpen: false,
  pinnedResponse: null,
  activeGitDiff: null,
  quickInsertsOpen: true,
  sendSignal: 0,
  focusedPane: 'request',
  subTabCycle: { nonce: 0, pane: 'request', dir: 1 },
  collectionPanelOpen: false,
  folderPanel: null,
  coverageOpen: false,
  compareOpen: false,

  setShowGeneratorPanel: v => set(s => { s.showGeneratorPanel = v; }),

  // Theme & zoom: persisted in workspace.settings when open, else localStorage.
  setTheme: (t) => set(s => {
    s.theme = t;
    // Mirror to localStorage so the welcome screen remembers the choice.
    localStorage.setItem(STORAGE_KEYS.theme, t);
    if (s.workspace) {
      s.workspace.settings ??= {};
      s.workspace.settings.theme = t;
    }
    if (t === 'system') {
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.toggle('light', !dark);
    } else {
      document.documentElement.classList.toggle('light', t === 'light');
    }
  }),

  setZoom: (z) => set(s => {
    s.zoom = z;
    localStorage.setItem(STORAGE_KEYS.zoom, String(z));
    if (s.workspace) {
      if (!s.workspace.settings) s.workspace.settings = {};
      s.workspace.settings.zoom = z;
    }
    window.electron.setZoomFactor(z);
  }),

  setSidebarTab: (tab) => set(s => { s.sidebarTab = tab; }),
  setActivePerfPlanId: (id) => set(s => { s.activePerfPlanId = id; }),

  setWorkspaceSettingsOpen: (open) => set(s => { s.workspaceSettingsOpen = open; if (!open) s.workspaceSettingsTab = null; }),
  openWorkspaceSettings: (tab = null) => set(s => { s.workspaceSettingsOpen = true; s.workspaceSettingsTab = tab; }),

  setCommandPaletteOpen: (open) => set(s => { s.commandPaletteOpen = open; }),

  setPinnedResponse: (r) => set(s => { s.pinnedResponse = r; }),

  setActiveGitDiff: (d) => set(s => { s.activeGitDiff = d; }),

  setQuickInsertsOpen: (open) => set(s => { s.quickInsertsOpen = open; }),

  requestSend: () => set(s => { s.sendSignal += 1; }),
  setFocusedPane: pane => set(s => { s.focusedPane = pane; }),
  cycleSubTab: dir => set(s => { s.subTabCycle = { nonce: s.subTabCycle.nonce + 1, pane: s.focusedPane, dir }; }),

  // Collections/folders open as tabs now; these keep their old names but delegate
  // to the tab openers.
  setCollectionPanelOpen: (open) => {
    if (!open) { set(s => { s.collectionPanelOpen = false; }); return; }
    const collectionId = get().activeCollectionId;
    if (collectionId) get().openCollectionTab(collectionId);
    else set(s => { s.collectionPanelOpen = true; s.folderPanel = null; });
  },
  openFolderPanel: (collectionId, folderId) => get().openFolderTab(collectionId, folderId),

  setCoverageOpen: (open) => set(s => { s.coverageOpen = open; }),

  setCompareOpen: (open) => set(s => { s.compareOpen = open; }),

  // The coverage OpenAPI spec travels with the workspace, like theme/zoom.
  setCoverageSpec: (spec) => set(s => {
    if (s.workspace) {
      if (!s.workspace.settings) s.workspace.settings = {};
      s.workspace.settings.coverageSpec = spec;
    }
  }),
});
