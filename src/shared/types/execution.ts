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
}

export interface ResponsePayload {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  bodySize: number
  durationMs: number
  error?: string
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
