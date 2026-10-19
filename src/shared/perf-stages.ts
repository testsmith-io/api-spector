// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Turns a performance plan's pattern (basic / stepping / arrivals / custom) into
// one unified schedule: an executor plus a list of stages (target value held or
// ramped over a duration). Shared so the engine (main) schedules load from the
// exact same profile the panel (renderer) draws as a preview.

import type { PerfPlan, PerfStage, PerfExecutor, PerfResult, PerfThreshold, PerfThresholdResult } from './types';

export interface DerivedLoad {
  executor: PerfExecutor
  stages: PerfStage[]
  /** Concurrency cap for the arrival (open) executor. */
  maxVus: number
  /** Total scheduled length (sum of stage durations), seconds. */
  totalSec: number
}

const n = (v: number, min: number, max: number, dflt: number): number => {
  const x = Math.floor(Number(v));
  if (!Number.isFinite(x)) return dflt;
  return Math.max(min, Math.min(max, x));
};

export function deriveLoad(plan: PerfPlan): DerivedLoad {
  let executor: PerfExecutor = 'vus';
  let stages: PerfStage[] = [];
  let maxVus = 0;

  if (plan.pattern === 'basic') {
    const b = plan.basic;
    const vus = n(b.vus, 1, 5000, 10);
    if (n(b.rampUpSec, 0, 36000, 0) > 0) stages.push({ durationSec: n(b.rampUpSec, 0, 36000, 0), target: vus, ramp: true });
    stages.push({ durationSec: n(b.durationSec, 1, 36000, 30), target: vus, ramp: false });
    if (n(b.rampDownSec, 0, 36000, 0) > 0) stages.push({ durationSec: n(b.rampDownSec, 0, 36000, 0), target: 0, ramp: true });
  } else if (plan.pattern === 'stepping') {
    const s = plan.stepping;
    const start = n(s.startUsers, 1, 5000, 5);
    const step = n(s.stepUsers, 1, 5000, 5);
    const max = n(s.maxUsers, start, 5000, 50);
    const stepDur = n(s.stepDurationSec, 1, 36000, 60);
    const rampStep = n(s.rampStepSec, 0, 36000, 0);
    for (let level = start; ; level = Math.min(max, level + step)) {
      if (rampStep > 0) stages.push({ durationSec: rampStep, target: level, ramp: true });
      stages.push({ durationSec: stepDur, target: level, ramp: false });
      if (level >= max) break;
    }
    const hold = n(s.holdFinalSec, 0, 36000, 0);
    if (hold > 0) stages.push({ durationSec: hold, target: max, ramp: false });
  } else if (plan.pattern === 'arrivals') {
    executor = 'arrival';
    const a = plan.arrivals;
    stages.push({ durationSec: n(a.durationSec, 1, 36000, 60), target: n(a.rate, 1, 100000, 50), ramp: false });
    maxVus = n(a.maxVus, 1, 20000, 200);
  } else {
    // custom: stages as authored (VU-based)
    stages = (plan.custom.stages ?? []).map(st => ({
      durationSec: n(st.durationSec, 1, 36000, 30),
      target: n(st.target, 0, 20000, 10),
      ramp: Boolean(st.ramp),
    }));
    if (stages.length === 0) stages.push({ durationSec: 30, target: 10, ramp: false });
  }

  const totalSec = stages.reduce((sum, st) => sum + st.durationSec, 0);
  return { executor, stages, maxVus, totalSec };
}

/** The scheduled target (VUs or iterations/sec) at elapsed time tSec. A ramp
 *  stage interpolates linearly from the previous stage's target; a hold stage
 *  stays flat. Used by the engine to schedule and by the panel to preview. */
export function targetAt(load: DerivedLoad, tSec: number): number {
  let start = 0;
  let prevTarget = 0;
  for (const st of load.stages) {
    const end = start + st.durationSec;
    if (tSec < end || st === load.stages[load.stages.length - 1]) {
      if (st.ramp && st.durationSec > 0) {
        const frac = Math.max(0, Math.min(1, (tSec - start) / st.durationSec));
        return prevTarget + (st.target - prevTarget) * frac;
      }
      return st.target;
    }
    start = end;
    prevTarget = st.target;
  }
  return 0;
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** The actual value a threshold metric takes in a finished result. */
export function thresholdActual(result: Pick<PerfResult, 'iterationLatency' | 'requestLatency' | 'iterations' | 'iterationsFailed' | 'iterationsPerSec'>, metric: PerfThreshold['metric']): number {
  switch (metric) {
    case 'iteration_p95': return result.iterationLatency.p95;
    case 'iteration_p99': return result.iterationLatency.p99;
    case 'req_p95':       return result.requestLatency.p95;
    case 'error_rate':    return result.iterations > 0 ? (result.iterationsFailed / result.iterations) * 100 : 0;
    case 'throughput':    return result.iterationsPerSec;
    default:              return 0;
  }
}

function compare(actual: number, op: PerfThreshold['op'], value: number): boolean {
  switch (op) {
    case 'lt':  return actual < value;
    case 'lte': return actual <= value;
    case 'gt':  return actual > value;
    case 'gte': return actual >= value;
    default:    return false;
  }
}

/** Evaluate a plan's thresholds against a result. Empty in / empty out. */
export function evaluateThresholds(
  result: Parameters<typeof thresholdActual>[0],
  thresholds: PerfThreshold[],
): PerfThresholdResult[] {
  return (thresholds ?? []).map(th => {
    const actual = thresholdActual(result, th.metric);
    return { ...th, actual, passed: compare(actual, th.op, th.value) };
  });
}

export const THRESHOLD_METRIC_LABELS: Record<PerfThreshold['metric'], string> = {
  iteration_p95: 'Iteration p95 (ms)',
  iteration_p99: 'Iteration p99 (ms)',
  req_p95: 'Request p95 (ms)',
  error_rate: 'Error rate (%)',
  throughput: 'Throughput (iter/s)',
};
export const THRESHOLD_OP_LABELS: Record<PerfThreshold['op'], string> = { lt: '<', lte: '<=', gt: '>', gte: '>=' };
