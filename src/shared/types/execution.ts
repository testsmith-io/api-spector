// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// ─── Scripting & request execution (IPC payloads) ───────────────────────────

import type { ApiRequest, Environment, TlsSettings } from './collection';

export interface TestResult {
  name: string
  passed: boolean
  error?: string
}

export interface ScriptExecutionMeta {
  testResults: TestResult[]
  consoleOutput: string[]
  updatedEnvVars: Record<string, string>
  updatedCollectionVars: Record<string, string>
  updatedGlobals: Record<string, string>
  updatedLocalVars: Record<string, string>
  resolvedUrl: string
  preScriptError?: string
  postScriptError?: string
}

// ─── IPC payloads ─────────────────────────────────────────────────────────────

export interface SendRequestPayload {
  request: ApiRequest
  environment: Environment | null
  collectionVars: Record<string, string>
  globals: Record<string, string>
  proxy?: {
    url: string
    auth?: { username: string; password: string }
  }
  tls?: TlsSettings
  piiMaskPatterns?: string[]
  /** When set, the main process streams frames back on IPC.request.streamEvent
   *  tagged with this id, and IPC.request.stopStream can abort the read. Only
   *  the main (visible) request sets this; hooks are always buffered. */
  streamId?: string
  /** Force streaming regardless of Content-Type (the "Stream response" toggle). */
  forceStream?: boolean
}

/** One frame from a streamed response (SSE / NDJSON / json-seq / raw chunk).
 *  Emitted live over IPC as it arrives and also collected on the final
 *  ResponsePayload so the viewer can re-render a completed stream. */
export interface StreamEvent {
  /** 0-based receive order. */
  seq: number
  /** Milliseconds since request start when this event was received. */
  tMs: number
  kind: 'sse' | 'ndjson' | 'chunk'
  /** SSE event name (defaults to "message"); absent for ndjson/chunk. */
  name?: string
  /** SSE id, for Last-Event-ID resume (phase 3). */
  id?: string
  /** Raw payload text. */
  data: string
  /** Parsed payload when `data` is valid JSON. */
  json?: unknown
}

export type StreamClose = 'complete' | 'stopped' | 'error' | 'timeout'

export interface ResponsePayload {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  bodySize: number
  durationMs: number
  error?: string
  /** True when the body was consumed as a stream rather than buffered. */
  streamed?: boolean
  /** Parsed stream frames, in receive order (present when `streamed`). */
  events?: StreamEvent[]
  /** How the stream ended (present when `streamed`). */
  streamClose?: StreamClose
  /** Time-to-first-event in ms (present when `streamed`). */
  firstEventMs?: number
}

export interface SentRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

export interface RequestExecutionResult {
  response: ResponsePayload
  scriptResult: ScriptExecutionMeta
  sentRequest: SentRequest
}

export interface HistoryEntry {
  id: string
  timestamp: number
  request: ApiRequest
  resolvedUrl: string
  response: ResponsePayload
  environmentName: string | null
  scriptResult?: ScriptExecutionMeta
}
