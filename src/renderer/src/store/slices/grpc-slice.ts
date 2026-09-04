// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { StateCreator } from 'zustand';
import type { GrpcMessage, GrpcServiceInfo } from '../../../../shared/types';
import type { FullState } from '../index';

// Cap a streaming call's buffer so a long server-stream can't OOM the renderer.
const GRPC_MESSAGE_CAP = 1000;

export type GrpcCallStatus = 'idle' | 'running' | 'completed' | 'error';

export interface GrpcCallState {
  status: GrpcCallStatus
  code?: number
  codeName?: string
  error?: string
  messages: GrpcMessage[]
  /** Services discovered from the loaded proto. */
  services: GrpcServiceInfo[]
  /** Last proto-load error, if any. */
  protoError?: string
}

export interface GrpcSliceState {
  grpcCalls: Record<string, GrpcCallState>
}

export interface GrpcSliceActions {
  setGrpcStatus: (requestId: string, status: GrpcCallStatus, extra?: { code?: number; codeName?: string; error?: string }) => void
  addGrpcMessage: (requestId: string, message: GrpcMessage) => void
  clearGrpcMessages: (requestId: string) => void
  setGrpcServices: (requestId: string, services: GrpcServiceInfo[]) => void
  setGrpcProtoError: (requestId: string, error?: string) => void
}

export type GrpcSlice = GrpcSliceState & GrpcSliceActions

const blank = (): GrpcCallState => ({ status: 'idle', messages: [], services: [] });

export const createGrpcSlice: StateCreator<
  FullState,
  [['zustand/immer', never]],
  [],
  GrpcSlice
> = (set) => ({
  grpcCalls: {},

  setGrpcStatus: (requestId, status, extra) => set(s => {
    const c = (s.grpcCalls[requestId] ??= blank());
    c.status = status;
    c.code = extra?.code;
    c.codeName = extra?.codeName;
    c.error = extra?.error;
  }),

  addGrpcMessage: (requestId, message) => set(s => {
    const c = (s.grpcCalls[requestId] ??= blank());
    c.messages.push(message);
    if (c.messages.length > GRPC_MESSAGE_CAP) {
      c.messages.splice(0, c.messages.length - GRPC_MESSAGE_CAP);
    }
  }),

  clearGrpcMessages: (requestId) => set(s => {
    if (s.grpcCalls[requestId]) s.grpcCalls[requestId].messages = [];
  }),

  setGrpcServices: (requestId, services) => set(s => {
    const c = (s.grpcCalls[requestId] ??= blank());
    c.services = services;
    c.protoError = undefined;
  }),

  setGrpcProtoError: (requestId, error) => set(s => {
    const c = (s.grpcCalls[requestId] ??= blank());
    c.protoError = error;
    if (error) c.services = [];
  }),
});
