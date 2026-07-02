// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// ─── Recorder ─────────────────────────────────────────────────────────────────

export interface RecorderConfig {
  upstream: string
  port: number
  maskHeaders?: string[]
  ignoreHeaders?: string[]
}

export interface RecordedRequest {
  method: string
  path: string
  query: Record<string, string>
  headers: Record<string, string>
  body: string | null
}

export interface RecordedResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string | null
  binary: boolean
  bodySize: number
}

export interface RecordedEntry {
  id: string
  timestamp: string
  durationMs: number
  request: RecordedRequest
  response: RecordedResponse
}

export interface RecordingSession {
  version: '1.0'
  upstream: string
  port: number
  startedAt: string
  maskedHeaders: string[]
  entries: RecordedEntry[]
}
