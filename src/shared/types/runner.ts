// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// ─── Runner ───────────────────────────────────────────────────────────────────

import type { ApiRequest, Environment } from './collection';
import type { TestResult } from './execution';

export interface RunnerItem {
  request: ApiRequest
  collectionVars: Record<string, string>
  /** Per-iteration variable values (from data-driven dataset). */
  dataRow?: Record<string, string>
  /** Human-readable label, e.g. "2/5" when data-driven. */
  iterationLabel?: string
  // ── Hook metadata ─────────────────────────────────────────────────────────
  isHook?: boolean
  hookType?: 'beforeAll' | 'before' | 'afterAll' | 'after'
  /** The folder/collection this hook belongs to. */
  scopeId?: string
  /** Ancestor scope IDs from root outward (not including scopeId). */
  scopeAncestors?: string[]
  /** For before/after hooks: the main request this hook wraps. */
  mainRequestId?: string
  /**
   * Folder names from (just below) the root to the folder that owns this
   * request/hook. Used for grouped rendering in the runner UI and reports.
   * Empty array = direct child of the collection root.
   */
  scopePath?: string[]
}

export interface RunnerPayload {
  items: RunnerItem[]
  environment: Environment | null
  globals: Record<string, string>
  proxy?: {
    url: string
    auth?: { username: string; password: string }
  }
  tls?: {
    caCertPath?: string
    clientCertPath?: string
    clientKeyPath?: string
    rejectUnauthorized?: boolean
  }
  piiMaskPatterns?: string[]
  /** Milliseconds to wait between requests (0 = no delay) */
  requestDelay?: number
}

/**
 * Status of a single request inside a runner pass.
 *
 * - `pending`  — queued, not started yet
 * - `running`  — request in flight
 * - `passed`   — HTTP 2xx/3xx AND every test passed
 * - `failed`   — at least one test failed, OR HTTP 4xx/5xx
 * - `error`    — pre/post script crashed or transport failure
 * - `skipped`  — request completed (HTTP 2xx/3xx) but had no assertions to
 *                check; "we ran it, we didn't verify anything." Distinct
 *                from `passed` so users notice gaps in their test coverage.
 */
export type RunStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error' | 'skipped'

export interface RunRequestResult {
  requestId: string
  name: string
  method: string
  resolvedUrl: string
  status: RunStatus
  httpStatus?: number
  durationMs?: number
  error?: string
  testResults?: TestResult[]
  consoleOutput?: string[]
  preScriptError?: string
  postScriptError?: string
  /** Set when this result belongs to a data-driven iteration, e.g. "2/5". */
  iterationLabel?: string
  isHook?: boolean
  hookType?: 'beforeAll' | 'before' | 'afterAll' | 'after'
  scopeId?: string
  /** Folder names from (just below) the root to the request's owning folder.
   *  Mirror of RunnerItem.scopePath, used for grouped rendering. */
  scopePath?: string[]
  /** Actual request sent over the wire */
  sentRequest?: {
    headers: Record<string, string>
    body?: string
  }
  /** Response received */
  receivedResponse?: {
    status: number
    statusText: string
    headers: Record<string, string>
    body: string
  }
}

export interface RunSummary {
  total: number
  passed: number
  failed: number
  errors: number
  /** Requests that ran successfully (2xx/3xx) but had no assertions to check. */
  skipped: number
  durationMs: number
}
