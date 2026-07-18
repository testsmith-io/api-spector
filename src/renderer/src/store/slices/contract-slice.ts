// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { StateCreator } from 'zustand';
import type { ContractReport, ContractSnapshot } from '../../../../shared/types';
import type { FullState } from '../index';

/** Context of the last run, used to fill in the exported HTML report header. */
export interface ContractRunMeta {
  spec?: string
  provider?: string
}

export interface ContractSlice {
  /** Latest run only — there is no run history. */
  lastContractReport: ContractReport | null
  /** Spec/provider labels from the run that produced lastContractReport. */
  lastContractRunMeta: ContractRunMeta | null
  /** Pinned spec snapshots, keyed by their workspace-relative path. */
  contractSnapshots: Record<string, ContractSnapshot>
  /** When set, contract runs use this snapshot's spec instead of a live URL. */
  activeContractSnapshotRelPath: string | null

  setLastContractReport: (r: ContractReport | null, meta?: ContractRunMeta) => void
  loadContractSnapshot: (relPath: string, snapshot: ContractSnapshot) => void
  removeContractSnapshot: (relPath: string) => void
  setActiveContractSnapshot: (relPath: string | null) => void
}

// This slice mutates `workspace.contracts` when snapshots are added/removed,
// so its `set` callback is typed against the full store state.
export const createContractSlice: StateCreator<
  FullState,
  [['zustand/immer', never]],
  [],
  ContractSlice
> = (set) => ({
  lastContractReport: null,
  lastContractRunMeta: null,
  contractSnapshots: {},
  activeContractSnapshotRelPath: null,

  setLastContractReport: (r, meta) => set(s => {
    s.lastContractReport = r;
    s.lastContractRunMeta = r ? (meta ?? null) : null;
  }),

  loadContractSnapshot: (relPath, snapshot) => set(s => {
    s.contractSnapshots[relPath] = snapshot;
    if (s.workspace) {
      if (!s.workspace.contracts) s.workspace.contracts = [];
      if (!s.workspace.contracts.includes(relPath)) s.workspace.contracts.push(relPath);
    }
  }),

  removeContractSnapshot: (relPath) => set(s => {
    delete s.contractSnapshots[relPath];
    if (s.activeContractSnapshotRelPath === relPath) s.activeContractSnapshotRelPath = null;
    if (s.workspace?.contracts) {
      s.workspace.contracts = s.workspace.contracts.filter(p => p !== relPath);
    }
  }),

  setActiveContractSnapshot: (relPath) => set(s => { s.activeContractSnapshotRelPath = relPath; }),
});
