// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { StateCreator } from 'zustand';
import type { HistoryEntry } from '../../../../shared/types';
import type { FullState } from '../index';

const HISTORY_CAP = 200;

export interface HistorySliceState {
  /** Newest first, capped at {@link HISTORY_CAP}. */
  history: HistoryEntry[]
}

export interface HistorySliceActions {
  addHistoryEntry: (entry: HistoryEntry) => void
  clearHistory: () => void
  /** Replace history wholesale (used when loading persisted history on open). */
  setHistory: (entries: HistoryEntry[]) => void
}

export type HistorySlice = HistorySliceState & HistorySliceActions

/** Persist the current history to the workspace file when the workspace has
 *  persistHistory enabled. Debounced so a burst of sends writes once. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persistIfEnabled(get: () => FullState): void {
  if (!get().workspace?.settings?.persistHistory) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    window.electron.saveHistory(get().history).catch((err: unknown) => {
      console.warn('persistHistory: could not save history.json', err);
    });
  }, 800);
}

export const createHistorySlice: StateCreator<
  FullState,
  [['zustand/immer', never]],
  [],
  HistorySlice
> = (set, get) => ({
  history: [],
  addHistoryEntry: (entry) => {
    set(s => {
      s.history.unshift(entry);
      if (s.history.length > HISTORY_CAP) s.history.length = HISTORY_CAP;
    });
    persistIfEnabled(get);
  },
  clearHistory: () => {
    set(s => { s.history = []; });
    persistIfEnabled(get);
  },
  setHistory: (entries) => set(s => {
    s.history = entries.slice(0, HISTORY_CAP);
  }),
});
