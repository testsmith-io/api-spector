// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { StateCreator } from 'zustand';
import type { FullState } from '../index';

export interface RecorderSliceState {
  recorderOpen:         boolean
  recorderRunning:      boolean
  recorderUpstream:     string
  recorderPort:         number
  /** '' = create new mock server when the user imports a recording. */
  recorderTargetMockId: string
}

export interface RecorderSliceActions {
  setRecorderOpen:         (open: boolean) => void
  setRecorderRunning:      (running: boolean) => void
  setRecorderUpstream:     (url: string) => void
  setRecorderPort:         (port: number) => void
  setRecorderTargetMockId: (id: string) => void
}

export type RecorderSlice = RecorderSliceState & RecorderSliceActions

export const createRecorderSlice: StateCreator<
  FullState,
  [['zustand/immer', never]],
  [],
  RecorderSlice
> = (set) => ({
  recorderOpen:         false,
  recorderRunning:      false,
  recorderUpstream:     '',
  recorderPort:         4001,
  recorderTargetMockId: '',

  setRecorderOpen:         (open)    => set(s => { s.recorderOpen          = open;    }),
  setRecorderRunning:      (running) => set(s => { s.recorderRunning       = running; }),
  setRecorderUpstream:     (url)     => set(s => { s.recorderUpstream      = url;     }),
  setRecorderPort:         (port)    => set(s => { s.recorderPort          = port;    }),
  setRecorderTargetMockId: (id)      => set(s => { s.recorderTargetMockId  = id;      }),
});
