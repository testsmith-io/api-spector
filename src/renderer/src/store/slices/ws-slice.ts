// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { StateCreator } from 'zustand';
import type { WsMessage } from '../../../../shared/types';

// Cap each connection's buffer so a long-running socket can't OOM the
// renderer. 1000 mirrors what most browsers' devtools keep around.
const WS_MESSAGE_CAP = 1000;

export interface WsSliceState {
  wsConnections: Record<string, {
    status: 'disconnected' | 'connecting' | 'connected' | 'error'
    messages: WsMessage[]
    error?: string
  }>
}

export interface WsSliceActions {
  setWsStatus: (requestId: string, status: WsSliceState['wsConnections'][string]['status'], error?: string) => void
  addWsMessage: (requestId: string, message: WsMessage) => void
  clearWsMessages: (requestId: string) => void
}

export type WsSlice = WsSliceState & WsSliceActions

// Generic enough that the parent store's full type doesn't matter — slices
// that only mutate their own state can be typed against `WsSlice` alone.
type ImmerStateCreator<T> = StateCreator<T, [['zustand/immer', never]], [], T>

export const createWsSlice: ImmerStateCreator<WsSlice> = (set) => ({
  wsConnections: {},

  setWsStatus: (requestId, status, error) => set(s => {
    if (!s.wsConnections[requestId]) {
      s.wsConnections[requestId] = { status, messages: [], error };
    } else {
      s.wsConnections[requestId].status = status;
      s.wsConnections[requestId].error = error;
    }
  }),

  addWsMessage: (requestId, message) => set(s => {
    const conn = s.wsConnections[requestId];
    if (!conn) {
      s.wsConnections[requestId] = { status: 'connected', messages: [message] };
      return;
    }
    conn.messages.push(message);
    if (conn.messages.length > WS_MESSAGE_CAP) {
      conn.messages.splice(0, conn.messages.length - WS_MESSAGE_CAP);
    }
  }),

  clearWsMessages: (requestId) => set(s => {
    if (s.wsConnections[requestId]) s.wsConnections[requestId].messages = [];
  }),
});
