// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { StateCreator } from 'zustand';
import type { MqttMessage } from '../../../../shared/types';
import type { FullState } from '../index';

// Per-connection session-log cap, mirroring the WebSocket / Socket.IO slices.
const MQTT_MESSAGE_CAP = 1000;

export interface MqttSliceState {
  mqttConnections: Record<string, {
    status: 'disconnected' | 'connecting' | 'connected' | 'error'
    messages: MqttMessage[]
    error?: string
  }>
}

export interface MqttSliceActions {
  setMqttStatus: (requestId: string, status: MqttSliceState['mqttConnections'][string]['status'], error?: string) => void
  addMqttMessage: (requestId: string, message: MqttMessage) => void
  clearMqttMessages: (requestId: string) => void
}

export type MqttSlice = MqttSliceState & MqttSliceActions

export const createMqttSlice: StateCreator<
  FullState,
  [['zustand/immer', never]],
  [],
  MqttSlice
> = (set) => ({
  mqttConnections: {},

  setMqttStatus: (requestId, status, error) => set(s => {
    if (!s.mqttConnections[requestId]) {
      s.mqttConnections[requestId] = { status, messages: [], error };
    } else {
      s.mqttConnections[requestId].status = status;
      s.mqttConnections[requestId].error = error;
    }
  }),

  addMqttMessage: (requestId, message) => set(s => {
    const conn = s.mqttConnections[requestId];
    if (!conn) {
      s.mqttConnections[requestId] = { status: 'connected', messages: [message] };
      return;
    }
    conn.messages.push(message);
    if (conn.messages.length > MQTT_MESSAGE_CAP) {
      conn.messages.splice(0, conn.messages.length - MQTT_MESSAGE_CAP);
    }
  }),

  clearMqttMessages: (requestId) => set(s => {
    if (s.mqttConnections[requestId]) s.mqttConnections[requestId].messages = [];
  }),
});
