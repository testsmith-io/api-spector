// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { MockServer, MockHit } from '../../../../shared/types';
import type { FullState } from '../index';

/** Mock files are keyed by id, not display name — renames never move files. */
function mockRelPath(id: string): string {
  return `mocks/${id}.mock.json`;
}

/** serverId → hits, newest first, capped at this many entries. */
const MOCK_LOG_CAP = 100;

export interface MocksSliceState {
  mocks: Record<string, { relPath: string; data: MockServer; running: boolean }>
  activeMockId: string | null
  mockLogs: Record<string, MockHit[]>
}

export interface MocksSliceActions {
  loadMock: (relPath: string, data: MockServer) => void
  addMock: () => void
  updateMock: (id: string, data: MockServer) => void
  deleteMock: (id: string) => void
  setMockRunning: (id: string, running: boolean) => void
  setActiveMockId: (id: string | null) => void
  addMockHit: (hit: MockHit) => void
  clearMockLogs: (serverId: string) => void
}

export type MocksSlice = MocksSliceState & MocksSliceActions

export const createMocksSlice: StateCreator<
  FullState,
  [['zustand/immer', never]],
  [],
  MocksSlice
> = (set, get) => ({
  mocks: {},
  activeMockId: null,
  mockLogs: {},

  loadMock: (relPath, data) => set(s => {
    s.mocks[data.id] = { relPath, data, running: false };
  }),

  addMock: () => set(s => {
    const mock: MockServer = {
      version: '1.0',
      id: uuidv4(),
      name: 'New Mock Server',
      port: 3900,
      routes: [],
    };
    const relPath = mockRelPath(mock.id);
    s.mocks[mock.id] = { relPath, data: mock, running: false };
    s.activeMockId = mock.id;
    if (s.workspace) {
      if (!s.workspace.mocks) s.workspace.mocks = [];
      s.workspace.mocks.push(relPath);
    }
  }),

  updateMock: (id, data) => set(s => {
    if (s.mocks[id]) s.mocks[id].data = data;
  }),

  deleteMock: (id) => {
    const relPath = get().mocks[id]?.relPath;
    if (relPath) {
      window.electron.deleteWorkspaceFile(relPath).catch((err: unknown) => {
        console.warn('deleteMock: could not remove file', relPath, err);
      });
    }
    set(s => {
      delete s.mocks[id];
      if (s.workspace?.mocks && relPath) {
        s.workspace.mocks = s.workspace.mocks.filter(p => p !== relPath);
      }
      if (s.activeMockId === id) s.activeMockId = null;
    });
  },

  setMockRunning: (id, running) => set(s => {
    if (s.mocks[id]) s.mocks[id].running = running;
  }),

  setActiveMockId: (id) => set(s => { s.activeMockId = id; }),

  addMockHit: (hit) => set(s => {
    if (!s.mockLogs[hit.serverId]) s.mockLogs[hit.serverId] = [];
    s.mockLogs[hit.serverId].unshift(hit);
    if (s.mockLogs[hit.serverId].length > MOCK_LOG_CAP) s.mockLogs[hit.serverId].length = MOCK_LOG_CAP;
  }),

  clearMockLogs: (serverId) => set(s => { s.mockLogs[serverId] = []; }),
});
