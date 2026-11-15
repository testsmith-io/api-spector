// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { StateCreator } from 'zustand';
import type { RunRequestResult } from '../../../../shared/types';
import type { FullState } from '../index';

export interface RunnerSliceState {
  runnerModal: {
    open: boolean
    collectionId: string | null
    /** When set, scopes the run to a single folder; null means whole collection. */
    folderId: string | null
    filterTags: string[]
    /** Set by "Run selected": the explicit requests (tree order) to run instead of a
     *  folder/collection scope. null for a normal scoped run. */
    selection: { collectionId: string; requestIds: string[] } | null
    /** When true (a selection run), the modal starts the run immediately on open. */
    autoRun: boolean
  }
  runnerResults: RunRequestResult[]
  runnerRunning: boolean
}

export interface RunnerSliceActions {
  openRunner: ( collectionId: string, folderId?: string | null, filterTags?: string[] ) => void
  openRunnerForSelection: ( collectionId: string, requestIds: string[] ) => void
  closeRunner: () => void
  setRunnerResults: ( results: RunRequestResult[] ) => void
  patchRunnerResult: ( idx: number, patch: Partial<RunRequestResult> ) => void
  setRunnerRunning: ( v: boolean ) => void
}

export type RunnerSlice = RunnerSliceState & RunnerSliceActions

export const createRunnerSlice: StateCreator<
  FullState,
  [['zustand/immer', never]],
  [],
  RunnerSlice
> = ( set ) => ( {
  runnerModal: { open: false, collectionId: null, folderId: null, filterTags: [], selection: null, autoRun: false },
  runnerResults: [],
  runnerRunning: false,

  openRunner: ( collectionId, folderId = null, filterTags = [] ) => set( s => {
    s.runnerModal = { open: true, collectionId, folderId, filterTags, selection: null, autoRun: false };
    s.runnerResults = [];
  } ),
  openRunnerForSelection: ( collectionId, requestIds ) => set( s => {
    s.runnerModal = {
      open: true, collectionId, folderId: null, filterTags: [],
      selection: { collectionId, requestIds }, autoRun: true,
    };
    s.runnerResults = [];
  } ),
  closeRunner: () => set( s => { s.runnerModal.open = false; s.runnerRunning = false; s.runnerModal.selection = null; s.runnerModal.autoRun = false; } ),
  setRunnerResults: ( results ) => set( s => { s.runnerResults = results; } ),
  patchRunnerResult: ( idx, patch ) => set( s => {
    if ( s.runnerResults[idx] ) Object.assign( s.runnerResults[idx], patch );
  } ),
  setRunnerRunning: ( v ) => set( s => { s.runnerRunning = v; } ),
} );
