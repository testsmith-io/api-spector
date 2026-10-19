// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { StateCreator } from 'zustand';
import type { SocketIoMessage } from '../../../../shared/types';
import type { FullState } from '../index';

// Per-connection session-log cap, mirroring the WebSocket slice.
const SOCKETIO_MESSAGE_CAP = 1000;

export interface SocketIoSliceState {
  socketIoConnections: Record<string, {
    status: 'disconnected' | 'connecting' | 'connected' | 'error'
    messages: SocketIoMessage[]
    error?: string
  }>
}

export interface SocketIoSliceActions {
  setSocketIoStatus: (requestId: string, status: SocketIoSliceState['socketIoConnections'][string]['status'], error?: string) => void
  addSocketIoMessage: (requestId: string, message: SocketIoMessage) => void
  clearSocketIoMessages: (requestId: string) => void
}

export type SocketIoSlice = SocketIoSliceState & SocketIoSliceActions

export const createSocketIoSlice: StateCreator<
  FullState,
  [['zustand/immer', never]],
  [],
  SocketIoSlice
> = (set) => ({
  socketIoConnections: {},

  setSocketIoStatus: (requestId, status, error) => set(s => {
    if (!s.socketIoConnections[requestId]) {
      s.socketIoConnections[requestId] = { status, messages: [], error };
    } else {
      s.socketIoConnections[requestId].status = status;
      s.socketIoConnections[requestId].error = error;
    }
  }),

  addSocketIoMessage: (requestId, message) => set(s => {
    const conn = s.socketIoConnections[requestId];
    if (!conn) {
      s.socketIoConnections[requestId] = { status: 'connected', messages: [message] };
      return;
    }
    conn.messages.push(message);
    if (conn.messages.length > SOCKETIO_MESSAGE_CAP) {
      conn.messages.splice(0, conn.messages.length - SOCKETIO_MESSAGE_CAP);
    }
  }),

  clearSocketIoMessages: (requestId) => set(s => {
    if (s.socketIoConnections[requestId]) s.socketIoConnections[requestId].messages = [];
  }),
});
