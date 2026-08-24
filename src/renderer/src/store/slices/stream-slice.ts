// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { StateCreator } from 'zustand';
import type { StreamEvent } from '../../../../shared/types';
import type { FullState } from '../index';

// Cap the live buffer so an unbounded stream can't OOM the renderer. The main
// process caps its own retained events too; this is the UI-side backstop.
const LIVE_EVENT_CAP = 5000;

export interface LiveStream {
  streamId: string
  /** The tab this stream is being shown in. */
  tabId: string
  events: StreamEvent[]
  streaming: boolean
}

export interface StreamSliceState {
  /** The one in-flight (or just-finished) streamed response, if any. Only the
   *  visible main request streams, so a single slot is enough. */
  liveStream: LiveStream | null
}

export interface StreamSliceActions {
  startLiveStream: (tabId: string, streamId: string) => void
  pushLiveStreamEvents: (streamId: string, events: StreamEvent[]) => void
  finishLiveStream: (streamId: string) => void
  clearLiveStream: (tabId: string) => void
}

export type StreamSlice = StreamSliceState & StreamSliceActions

export const createStreamSlice: StateCreator<
  FullState,
  [['zustand/immer', never]],
  [],
  StreamSlice
> = (set) => ({
  liveStream: null,

  startLiveStream: (tabId, streamId) => set(s => {
    s.liveStream = { streamId, tabId, events: [], streaming: true };
  }),

  pushLiveStreamEvents: (streamId, events) => set(s => {
    if (!s.liveStream || s.liveStream.streamId !== streamId) return;
    s.liveStream.events.push(...events);
    const overflow = s.liveStream.events.length - LIVE_EVENT_CAP;
    if (overflow > 0) s.liveStream.events.splice(0, overflow);
  }),

  finishLiveStream: (streamId) => set(s => {
    if (s.liveStream?.streamId === streamId) s.liveStream.streaming = false;
  }),

  clearLiveStream: (tabId) => set(s => {
    if (s.liveStream?.tabId === tabId) s.liveStream = null;
  }),
});
