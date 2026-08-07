// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Workspace-agnostic UI chrome: theme, zoom, sidebar, command palette, and the
// handful of "which pane is showing" flags. Theme/zoom mirror into
// workspace.settings when a workspace is open (persisted on save) and always
// into localStorage so the welcome screen remembers them too.

import type { StateCreator } from 'zustand';
import type { ResponsePayload } from '../../../../shared/types';
import type { FullState } from '../index';

export interface UiSliceState {
  showGeneratorPanel: boolean
  theme: 'dark' | 'light' | 'system'
  zoom: number
  sidebarTab: 'collections' | 'history' | 'mocks' | 'contracts' | 'git'

  workspaceSettingsOpen: boolean

  // Command palette
  commandPaletteOpen: boolean

  // Pinned response for diffing
  pinnedResponse: ResponsePayload | null

  /** When set + sidebarTab === 'git', the main pane renders the diff for this
   *  file instead of the request builder. Lets users see the change at full
   *  width instead of a cramped sidebar panel. */
  activeGitDiff: { path: string; staged: boolean } | null

  /** Scripts-tab "Quick Inserts" sidebar visibility. Lifted into the store so
   *  the response-tree assertion flow (handleAssert) can collapse it after
   *  adding a snippet — otherwise the user lands on the script with the now-
   *  irrelevant snippet palette still taking up half the editor width. */
  quickInsertsOpen: boolean

  /** When true, the main pane shows the collection/folder data panel even if a
   *  request tab is open. Cleared as soon as a request tab is (re)activated, so
   *  it behaves like "bring the collection to front" rather than a mode. */
  collectionPanelOpen: boolean

  /** Monotonic counter bumped by requestSend(). The active RequestBuilder
   *  watches it and fires its normal send pipeline when it changes, so history
   *  rows (and anything else) can replay the current request without
   *  duplicating the scripts/hooks/interpolation logic. */
  sendSignal: number
}

export interface UiSliceActions {
  setShowGeneratorPanel: (v: boolean) => void
  setTheme: (t: 'dark' | 'light' | 'system') => void
  setZoom: (z: number) => void
  setSidebarTab: (tab: UiSliceState['sidebarTab']) => void
  setWorkspaceSettingsOpen: (open: boolean) => void
  setCommandPaletteOpen: (open: boolean) => void
  setPinnedResponse: (r: ResponsePayload | null) => void
  setActiveGitDiff: (d: { path: string; staged: boolean } | null) => void
  setQuickInsertsOpen: (open: boolean) => void
  /** Ask the active request builder to (re)send the current request. */
  requestSend: () => void
  /** Show or hide the collection/folder data panel over an open request. */
  setCollectionPanelOpen: (open: boolean) => void
}

export type UiSlice = UiSliceState & UiSliceActions

export const createUiSlice: StateCreator<
  FullState,
  [['zustand/immer', never]],
  [],
  UiSlice
> = (set) => ({
  showGeneratorPanel: false,
  theme: (localStorage.getItem('theme') as 'dark' | 'light' | 'system') ?? 'dark',
  zoom: Number(localStorage.getItem('zoom') ?? '1.1'),
  sidebarTab: 'collections' as UiSliceState['sidebarTab'],
  workspaceSettingsOpen: false,
  commandPaletteOpen: false,
  pinnedResponse: null,
  activeGitDiff: null,
  quickInsertsOpen: true,
  sendSignal: 0,
  collectionPanelOpen: false,

  setShowGeneratorPanel: v => set(s => { s.showGeneratorPanel = v; }),

  // ── Theme & zoom ────────────────────────────────────────────────────────────
  // Persisted in workspace.settings when a workspace is open; otherwise
  // fall back to localStorage so the welcome screen still remembers the
  // user's choice across app restarts.
  setTheme: (t) => set(s => {
    s.theme = t;
    // Always mirror to localStorage so the welcome screen (no workspace open)
    // still remembers the most recent choice on next launch.
    localStorage.setItem('theme', t);
    if (s.workspace) {
      if (!s.workspace.settings) s.workspace.settings = {};
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
    localStorage.setItem('zoom', String(z));
    if (s.workspace) {
      if (!s.workspace.settings) s.workspace.settings = {};
      s.workspace.settings.zoom = z;
    }
    window.electron.setZoomFactor(z);
  }),

  setSidebarTab: (tab) => set(s => { s.sidebarTab = tab; }),

  setWorkspaceSettingsOpen: (open) => set(s => { s.workspaceSettingsOpen = open; }),

  setCommandPaletteOpen: (open) => set(s => { s.commandPaletteOpen = open; }),

  setPinnedResponse: (r) => set(s => { s.pinnedResponse = r; }),

  setActiveGitDiff: (d) => set(s => { s.activeGitDiff = d; }),

  setQuickInsertsOpen: (open) => set(s => { s.quickInsertsOpen = open; }),

  requestSend: () => set(s => { s.sendSignal += 1; }),

  setCollectionPanelOpen: (open) => set(s => { s.collectionPanelOpen = open; }),
});
