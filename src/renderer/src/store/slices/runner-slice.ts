// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { StateCreator } from 'zustand';
import type { RunRequestResult } from '../../../../shared/types';

export interface RunnerSliceState {
  runnerModal: {
    open: boolean
    collectionId: string | null
    /** When set, scopes the run to a single folder; null means whole collection. */
    folderId: string | null
    filterTags: string[]
  }
  runnerResults: RunRequestResult[]
  runnerRunning: boolean
}

export interface RunnerSliceActions {
  openRunner: (collectionId: string, folderId?: string | null, filterTags?: string[]) => void
  closeRunner: () => void
  setRunnerResults: (results: RunRequestResult[]) => void
  patchRunnerResult: (idx: number, patch: Partial<RunRequestResult>) => void
  setRunnerRunning: (v: boolean) => void
}

export type RunnerSlice = RunnerSliceState & RunnerSliceActions

type ImmerStateCreator<T> = StateCreator<T, [['zustand/immer', never]], [], T>

export const createRunnerSlice: ImmerStateCreator<RunnerSlice> = (set) => ({
  runnerModal: { open: false, collectionId: null, folderId: null, filterTags: [] },
  runnerResults: [],
  runnerRunning: false,

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
});
