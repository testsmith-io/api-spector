// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// ─── Contract testing ─────────────────────────────────────────────────────────

import type { ApiRequest } from './collection';

export interface ContractExpectation {
  statusCode?: number
  headers?: { key: string; value: string; required: boolean }[]
  bodySchema?: string   // JSON Schema (draft-07) as a string
  /** Pact-style "example with matchers" (JSON string). When present it is
   *  compiled to a JSON Schema and validated alongside `bodySchema`. Lets
   *  contracts match on shape/type/regex instead of brittle exact values.
   *  See {@link compileMatcherExample} in main/contract/matchers.ts. */
  bodyMatcher?: string
  /** Provider states required for this interaction to hold (Pact `given(...)`).
   *  Used by live provider verification to seed the provider before replay. */
  providerStates?: string[]
}

// 'provider' is static analysis against an OpenAPI spec; 'provider-live'
// replays consumer expectations against a really-running provider.
export type ContractMode = 'consumer' | 'provider' | 'provider-live' | 'bidirectional'

export type ContractViolationType =
  | 'status_mismatch'
  | 'schema_violation'
  | 'missing_header'
  | 'request_body_invalid'
  | 'unknown_path'
  | 'schema_incompatible'
  | 'provider_state_failed'

export interface ContractViolation {
  type: ContractViolationType
  message: string
  path?: string
  expected?: string
  actual?: string
}

export interface ContractResult {
  requestId: string
  requestName: string
  method: string
  url: string
  passed: boolean
  violations: ContractViolation[]
  durationMs?: number
  actualStatus?: number
  /** Failing interaction whose contract has never passed before (Pact's
   *  "pending pact"). Reported but not counted as a blocking failure when the
   *  run allows pending contracts. */
  pending?: boolean
}

export interface ContractReport {
  mode: ContractMode
  total: number
  passed: number
  failed: number
  results: ContractResult[]
  durationMs: number
  /** Number of failing-but-pending interactions (excluded from `failed`). */
  pending?: number
}

// ─── Spec-driven fuzzing ──────────────────────────────────────────────────────

/** Where a fuzzed input was injected and how, so a finding is diagnosable. */
export interface FuzzMutation {
  /** e.g. "body.email", "query.limit", "path.id" */
  target: string
  /** Short label of the mutation kind, e.g. "type:string→number", "missing-required". */
  kind: string
  /** Human-readable description of what was changed. */
  description: string
}

export type FuzzOracle = 'never-5xx' | 'accepted-invalid' | 'undocumented-status' | 'response-schema'

export interface FuzzFinding {
  /** Which oracle rule the response broke. */
  oracle: FuzzOracle
  message: string
  /** HTTP status the fuzzed request produced (0 = transport error). */
  status: number
  /** The single mutation applied to the baseline for this case. */
  mutation: FuzzMutation
  /** Fully-resolved request as sent, so the case can be replayed. */
  request: { method: string; url: string; headers: Record<string, string>; body?: string }
  /** Truncated response body for context. */
  responseSample?: string
}

/** One executed case, recorded only when trace mode is on. Lets you see every
 *  malformed request the fuzzer sent, not just the ones that broke an oracle. */
export interface FuzzCaseTrace {
  mutation: FuzzMutation
  /** HTTP status produced (0 = transport error). */
  status: number
  /** Whether this case produced a finding. */
  finding: boolean
  request: { method: string; url: string; body?: string }
  /** Truncated response body the case produced. */
  responseSample?: string
}

export interface FuzzTargetResult {
  requestId: string
  requestName: string
  method: string
  url: string
  /** Number of mutated cases sent for this operation. */
  cases: number
  findings: FuzzFinding[]
  /** Every executed case (trace mode only). Undefined when trace was off. */
  trace?: FuzzCaseTrace[]
}

export interface FuzzReport {
  /** How inputs were generated and how responses were judged. */
  inputSource: 'spec' | 'request'
  oracleUsesContracts: boolean
  seed: number
  totalCases: number
  totalFindings: number
  results: FuzzTargetResult[]
  durationMs: number
  /** Requests skipped because they mutate and writes were not opted into. */
  skippedWrites: number
  /** Requests skipped because there was nothing to fuzz (no body / no schema). */
  skippedNoBody: number
}

export interface ContractRunPayload {
  mode: ContractMode
  requests: ApiRequest[]
  envVars: Record<string, string>
  collectionVars?: Record<string, string>
  specUrl?: string
  specPath?: string
  /** Run against a pinned snapshot stored in the workspace. Takes priority over
   *  `specUrl`/`specPath` so callers don't have to clear those when switching. */
  specSnapshotRelPath?: string
  /** Strip this base URL from request URLs before matching against spec paths.
   *  Useful when collection requests point at a different host than the spec's servers[]. */
  requestBaseUrl?: string
  /** provider-live mode: rebase every request onto this origin before replaying
   *  (e.g. http://localhost:3000). The path + query of each request is kept. */
  providerBaseUrl?: string
  /** provider-live mode: endpoint that seeds provider state. Before each
   *  interaction we POST `{ state, params, action: 'setup' }` here, mirroring
   *  Pact's "state change URL". */
  stateHandlerUrl?: string
}

// ─── Contract snapshots (pinned OpenAPI/spec versions) ───────────────────────
//
// A snapshot captures the exact bytes of an external spec at a point in time
// so runs can be replayed against a specific version even after the provider
// ships a new release. Stored per-workspace under `contracts/*.contract.json`.

export interface ContractSnapshot {
  version: '1.0'
  /** Stable id — used as the snapshot filename and in CLI --snapshot <id>. */
  id: string
  /** Human label (e.g. "users-api v1.3"). */
  name: string
  /** Original URL or absolute path the snapshot was captured from. Informational
   *  only — the verifier reads `spec` directly from this file. */
  source?: string
  /** ISO timestamp when the snapshot was captured. */
  capturedAt: string
  /** Wire format of the embedded spec text. */
  format: 'yaml' | 'json'
  /** Optional semantic version extracted from the spec's `info.version`. */
  specVersion?: string
  /** Raw spec text as captured (yaml or json, matches `format`). */
  spec: string
  /** SHA-256 hex of `spec`. Makes git diffs easy to sanity-check. */
  sha256: string
}
