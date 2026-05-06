// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { StateCreator } from 'zustand';
import type { HistoryEntry } from '../../../../shared/types';

const HISTORY_CAP = 200;

export interface HistorySliceState {
  /** Newest first, capped at {@link HISTORY_CAP}. */
  history: HistoryEntry[]
}

export interface HistorySliceActions {
  addHistoryEntry: (entry: HistoryEntry) => void
  clearHistory: () => void
}

export type HistorySlice = HistorySliceState & HistorySliceActions

type ImmerStateCreator<T> = StateCreator<T, [['zustand/immer', never]], [], T>

export const createHistorySlice: ImmerStateCreator<HistorySlice> = (set) => ({
  history: [],
  addHistoryEntry: (entry) => set(s => {
    s.history.unshift(entry);
    if (s.history.length > HISTORY_CAP) s.history.length = HISTORY_CAP;
  }),
  clearHistory: () => set(s => { s.history = []; }),
});
