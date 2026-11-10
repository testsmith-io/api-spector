// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Runner

import type { ApiRequest, Environment } from './collection';
import type { TestResult } from './execution';

export interface RunnerItem {
  request: ApiRequest
  /** Name of the collection this item belongs to (top level of the run tree). */
  collection?: string
  collectionVars: Record<string, string>
  /** Variables from this request's folder chain (root->leaf, innermost wins),
   *  readable and writable in scripts as `sp.folder`. */
  folderVars?: Record<string, string>
  /** Id of the folder that directly owns this request - where `sp.folder.set`
   *  writes land so sibling requests in the same folder see them. */
  folderId?: string
  /** Per-iteration variable values (from data-driven dataset). */
  dataRow?: Record<string, string>
  /** Human-readable label, e.g. "2/5" when data-driven. */
  iterationLabel?: string
  /** From a data-table row's reserved `expectStatus` column: the run asserts the
   *  response code is one of these (turns a data table into an access matrix). */
  expectStatus?: number[]
  /** From a data-table row's reserved `owasp` column: tags the expected-status
   *  assertion (e.g. BOLA) so it flows into the SARIF report. */
  owaspTag?: string
  // Hook metadata
  isHook?: boolean
  hookType?: 'beforeAll' | 'before' | 'afterAll' | 'after'
  /** The folder/collection this hook belongs to. */
  scopeId?: string
  /** Ancestor scope IDs from root outward (not including scopeId). */
  scopeAncestors?: string[]
  /** For before/after hooks: the main request this hook wraps. */
  mainRequestId?: string
  /** Folder names from below the root to this request/hook's folder, for
   *  grouped rendering. Empty = direct child of the root. */
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
  /** Milliseconds to wait between requests (0 = no delay). Sequential runs only. */
  requestDelay?: number
  /** Max concurrent requests (1 = sequential, default). Hooks act as barriers
   *  and concurrent requests share a variable snapshot, so parallel runs suit
   *  independent requests, not chained workflows. */
  concurrency?: number
}

/**
 * Status of a single request in a runner pass.
 * - `pending`  queued, not started
 * - `running`  in flight
 * - `passed`   2xx/3xx and every test passed
 * - `failed`   a test failed, or 4xx/5xx
 * - `error`    pre/post script crashed or transport failure
 * - `skipped`  ran (2xx/3xx) but had no assertions; distinct from `passed` so coverage gaps show
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
  /** The item's position in the run plan. Set on progress events so a parallel
   *  run (whose results arrive out of order) can be matched to the right row. */
  index?: number
  isHook?: boolean
  hookType?: 'beforeAll' | 'before' | 'afterAll' | 'after'
  scopeId?: string
  /** Name of the collection this request belongs to. Lets a workspace-wide
   *  report group results by collection (the top level of the tree). */
  collection?: string
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
