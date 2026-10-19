// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Shared types for the Performance (load) testing feature, used by the engine
// (main), the preload bridge, and the Performance panel (renderer).
//
// A plan targets either a single request or a Flow (so authenticated, multi
// step scenarios can be load tested). The load profile is described by one of
// four patterns (basic / stepping / arrivals / custom), each of which derives a
// unified schedule of stages (see shared/perf-stages.ts).

export type PerfPattern = 'basic' | 'stepping' | 'arrivals' | 'custom';

/** vus = closed model (hold N concurrent users). arrival = open model (start N
 *  iterations per second, spawning users as needed up to a cap). */
export type PerfExecutor = 'vus' | 'arrival';

export interface PerfStage {
  durationSec: number
  /** VUs (vus executor) or iterations/sec (arrival executor) at the end of the stage. */
  target: number
  /** Ramp linearly from the previous stage's target; otherwise hold at `target`. */
  ramp: boolean
}

export interface PerfBasic { vus: number; rampUpSec: number; durationSec: number; rampDownSec: number }
export interface PerfStepping { startUsers: number; stepUsers: number; stepDurationSec: number; maxUsers: number; rampStepSec: number; holdFinalSec: number }
export interface PerfArrivals { rate: number; durationSec: number; maxVus: number }
export interface PerfCustom { stages: PerfStage[] }

export type PerfTarget =
  | { kind: 'request'; requestId: string }
  /** A collection or folder run in order, variables carrying between requests
   *  (log in, then act). folderId omitted = the whole collection. */
  | { kind: 'sequence'; collectionId: string; folderId?: string }
  | { kind: 'flow'; flowId: string }

/** A pass/fail gate checked against the aggregate result. */
export type PerfThresholdMetric = 'iteration_p95' | 'iteration_p99' | 'req_p95' | 'error_rate' | 'throughput';
export type PerfThresholdOp = 'lt' | 'lte' | 'gt' | 'gte';
export interface PerfThreshold {
  metric: PerfThresholdMetric
  op: PerfThresholdOp
  /** ms for latency metrics, percent for error_rate, iter/s for throughput. */
  value: number
}
export interface PerfThresholdResult extends PerfThreshold {
  actual: number
  passed: boolean
}

/** A pause each virtual user takes between iterations (models user think time).
 *  A random value is picked in [minSec, maxSec]; 0/0 disables it. */
export interface PerfThinkTime { minSec: number; maxSec: number }

/** A saved performance test plan. Stored inline in the workspace (.spector), so
 *  plans travel with the project and are git-diffable, like design contracts. */
export interface PerfPlan {
  id: string
  name: string
  target: PerfTarget
  pattern: PerfPattern
  basic: PerfBasic
  stepping: PerfStepping
  arrivals: PerfArrivals
  custom: PerfCustom
  /** Per-request timeout in seconds; 0 = none. Applies to request targets. */
  timeoutSec: number
  /** Optional pass/fail gates checked against the result. */
  thresholds: PerfThreshold[]
  /** Pause each user takes between iterations. */
  thinkTime: PerfThinkTime
}

export interface PerfLatency {
  min: number; max: number; mean: number
  p50: number; p90: number; p95: number; p99: number
}

/** Aggregate for one step of the iteration (the single request, or each request
 *  block in a Flow, in order). */
export interface PerfStepStat {
  name: string
  count: number
  failed: number
  latency: PerfLatency
  statusCounts: Record<string, number>
}

/** Live progress streamed while a run is in flight. */
export interface PerfProgress {
  running: boolean
  elapsedMs: number
  iterations: number
  iterationsFailed: number
  /** Users currently active. */
  activeVus: number
  /** The scheduled target right now (VUs or iterations/sec). */
  targetNow: number
  /** Completed iterations per second over the whole run so far. */
  iterationsPerSec: number
  /** Rolling p95 iteration latency (ms). */
  p95: number
}

export interface PerfResult {
  mode: 'request' | 'sequence' | 'flow'
  pattern: PerfPattern
  executor: PerfExecutor
  /** Completed iterations (one target run = one iteration). */
  iterations: number
  iterationsFailed: number
  durationMs: number
  iterationsPerSec: number
  /** Individual HTTP requests per second (for a Flow, several per iteration). */
  requestsPerSec: number
  /** Whole-iteration latency. */
  iterationLatency: PerfLatency
  /** Latency across all individual requests. */
  requestLatency: PerfLatency
  bytes: number
  bytesPerSec: number
  statusCounts: Record<string, number>
  errors: Record<string, number>
  /** Per-step breakdown (one entry for a request target; one per request block for a Flow). */
  steps: PerfStepStat[]
  /** Per-second time series: completed iterations/sec and iteration p95. */
  series: { second: number; rps: number; p95: number }[]
  /** Highest number of users active at once. */
  peakVus: number
  /** Arrivals that could not start because the VU cap was reached (open model). */
  droppedArrivals: number
  stopped: boolean
  /** Evaluated thresholds (empty if none were set). */
  thresholds: PerfThresholdResult[]
  /** Overall pass: every threshold met (true when none were set). */
  passed: boolean
}
