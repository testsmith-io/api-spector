// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { StateCreator } from 'zustand';
import type { GraphQlWsMessage } from '../../../../shared/types';
import type { FullState } from '../index';

const GQLWS_MESSAGE_CAP = 1000;

export interface GraphqlWsSliceState {
  graphqlWsConnections: Record<string, {
    status: 'disconnected' | 'connecting' | 'connected' | 'error'
    messages: GraphQlWsMessage[]
    error?: string
  }>
}

export interface GraphqlWsSliceActions {
  setGraphqlWsStatus: (requestId: string, status: GraphqlWsSliceState['graphqlWsConnections'][string]['status'], error?: string) => void
  addGraphqlWsMessage: (requestId: string, message: GraphQlWsMessage) => void
  clearGraphqlWsMessages: (requestId: string) => void
}

export type GraphqlWsSlice = GraphqlWsSliceState & GraphqlWsSliceActions

export const createGraphqlWsSlice: StateCreator<
  FullState,
  [['zustand/immer', never]],
  [],
  GraphqlWsSlice
> = (set) => ({
  graphqlWsConnections: {},

  setGraphqlWsStatus: (requestId, status, error) => set(s => {
    if (!s.graphqlWsConnections[requestId]) {
      s.graphqlWsConnections[requestId] = { status, messages: [], error };
    } else {
      s.graphqlWsConnections[requestId].status = status;
      s.graphqlWsConnections[requestId].error = error;
    }
  }),

  addGraphqlWsMessage: (requestId, message) => set(s => {
    const conn = s.graphqlWsConnections[requestId];
    if (!conn) {
      s.graphqlWsConnections[requestId] = { status: 'connected', messages: [message] };
      return;
    }
    conn.messages.push(message);
    if (conn.messages.length > GQLWS_MESSAGE_CAP) {
      conn.messages.splice(0, conn.messages.length - GQLWS_MESSAGE_CAP);
    }
  }),

  clearGraphqlWsMessages: (requestId) => set(s => {
    if (s.graphqlWsConnections[requestId]) s.graphqlWsConnections[requestId].messages = [];
  }),
});
