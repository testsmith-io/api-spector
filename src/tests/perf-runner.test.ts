// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Exercises the performance scheduler with a synthetic iterate() (no network),
// plus the pattern -> schedule derivation.
import { describe, it, expect } from 'vitest';
import { runPerfTest, type PerfIterate, type PerfSchedule } from '../main/perf-runner';
import { deriveLoad, evaluateThresholds } from '../shared/perf-stages';
import type { PerfPlan, PerfResult } from '../shared/types';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function okIterate(stepMs = 5, status = 200): PerfIterate {
  return async () => {
    await sleep(stepMs);
    return { ok: status < 400, durationMs: stepMs, steps: [{ name: 'GET /thing', ok: status < 400, status, ms: stepMs, bytes: 128 }] };
  };
}

describe('runPerfTest scheduler', () => {
  it('closed model (vus) holds users and aggregates per step', async () => {
    const schedule: PerfSchedule = { executor: 'vus', stages: [{ durationSec: 1, target: 5, ramp: false }], maxVus: 0, totalSec: 1, mode: 'request', pattern: 'basic' };
    const res = await runPerfTest(schedule, okIterate(5, 200));
    expect(res.iterations).toBeGreaterThan(0);
    expect(res.iterationsFailed).toBe(0);
    expect(res.steps).toHaveLength(1);
    expect(res.statusCounts['200']).toBe(res.iterations);
    expect(res.peakVus).toBeGreaterThan(0);
    expect(res.peakVus).toBeLessThanOrEqual(6);
  });

  it('open model (arrival) starts iterations at a rate within the VU cap', async () => {
    const schedule: PerfSchedule = { executor: 'arrival', stages: [{ durationSec: 1, target: 30, ramp: false }], maxVus: 50, totalSec: 1, mode: 'request', pattern: 'arrivals' };
    const res = await runPerfTest(schedule, okIterate(5, 200));
    expect(res.iterations).toBeGreaterThan(0);
    expect(res.requestsPerSec).toBeGreaterThan(0);
    expect(res.peakVus).toBeLessThanOrEqual(50);
  });

  it('counts failures by status code', async () => {
    const schedule: PerfSchedule = { executor: 'vus', stages: [{ durationSec: 1, target: 3, ramp: false }], maxVus: 0, totalSec: 1, mode: 'request', pattern: 'basic' };
    const res = await runPerfTest(schedule, okIterate(5, 500));
    expect(res.iterationsFailed).toBe(res.iterations);
    expect(res.statusCounts['500']).toBe(res.iterations);
  });

  it('think time between iterations reduces throughput', async () => {
    const base = { stages: [{ durationSec: 1, target: 1, ramp: false }], maxVus: 0, totalSec: 1, mode: 'request' as const, pattern: 'basic' as const };
    const noThink = await runPerfTest({ executor: 'vus', ...base }, okIterate(5, 200));
    const withThink = await runPerfTest({ executor: 'vus', ...base, thinkMinMs: 80, thinkMaxMs: 80 }, okIterate(5, 200));
    expect(withThink.iterations).toBeLessThan(noThink.iterations);
  });

  it('aggregates multiple steps (flow iteration)', async () => {
    const schedule: PerfSchedule = { executor: 'vus', stages: [{ durationSec: 1, target: 2, ramp: false }], maxVus: 0, totalSec: 1, mode: 'flow', pattern: 'basic' };
    const flowIterate: PerfIterate = async () => {
      await sleep(4);
      return { ok: true, durationMs: 9, steps: [
        { name: '1. POST /login', ok: true, status: 200, ms: 4, bytes: 64 },
        { name: '2. GET /profile', ok: true, status: 200, ms: 5, bytes: 256 },
      ] };
    };
    const res = await runPerfTest(schedule, flowIterate);
    expect(res.steps).toHaveLength(2);
    expect(res.steps[0].name).toBe('1. POST /login');
    expect(res.requestLatency.max).toBeGreaterThanOrEqual(res.requestLatency.min);
    expect(res.iterationLatency.p95).toBeGreaterThanOrEqual(0);
  });
});

function plan(pattern: PerfPlan['pattern'], over: Partial<PerfPlan>): PerfPlan {
  return {
    id: 'p', name: 'p', target: { kind: 'request', requestId: 'r' }, pattern,
    basic: { vus: 10, rampUpSec: 0, durationSec: 30, rampDownSec: 0 },
    stepping: { startUsers: 5, stepUsers: 5, stepDurationSec: 10, maxUsers: 20, rampStepSec: 0, holdFinalSec: 0 },
    arrivals: { rate: 20, durationSec: 60, maxVus: 200 },
    custom: { stages: [{ durationSec: 10, target: 10, ramp: true }, { durationSec: 20, target: 10, ramp: false }] },
    timeoutSec: 0, ...over,
  };
}

describe('deriveLoad', () => {
  it('basic with ramp up/down produces three stages', () => {
    const d = deriveLoad(plan('basic', { basic: { vus: 50, rampUpSec: 30, durationSec: 300, rampDownSec: 10 } }));
    expect(d.executor).toBe('vus');
    expect(d.stages).toHaveLength(3);
    expect(d.stages[0]).toMatchObject({ target: 50, ramp: true });
    expect(d.stages[1]).toMatchObject({ target: 50, ramp: false });
    expect(d.stages[2]).toMatchObject({ target: 0, ramp: true });
    expect(d.totalSec).toBe(340);
  });

  it('stepping ramps from start to max in steps', () => {
    const d = deriveLoad(plan('stepping', { stepping: { startUsers: 5, stepUsers: 5, stepDurationSec: 10, maxUsers: 20, rampStepSec: 0, holdFinalSec: 0 } }));
    expect(d.executor).toBe('vus');
    expect(d.stages.map(s => s.target)).toEqual([5, 10, 15, 20]);
    expect(d.totalSec).toBe(40);
  });

  it('arrivals is an open-model single stage with a cap', () => {
    const d = deriveLoad(plan('arrivals', { arrivals: { rate: 50, durationSec: 120, maxVus: 300 } }));
    expect(d.executor).toBe('arrival');
    expect(d.maxVus).toBe(300);
    expect(d.stages).toEqual([{ durationSec: 120, target: 50, ramp: false }]);
  });
});

describe('evaluateThresholds', () => {
  const result = {
    iterationLatency: { min: 0, max: 0, mean: 0, p50: 0, p90: 0, p95: 420, p99: 800 },
    requestLatency: { min: 0, max: 0, mean: 0, p50: 0, p90: 0, p95: 300, p99: 0 },
    iterations: 100, iterationsFailed: 3, iterationsPerSec: 45,
  } as unknown as PerfResult;

  it('passes and fails each gate against the actual value', () => {
    const r = evaluateThresholds(result, [
      { metric: 'iteration_p95', op: 'lt', value: 500 },   // 420 < 500 → pass
      { metric: 'iteration_p99', op: 'lt', value: 500 },   // 800 < 500 → fail
      { metric: 'error_rate', op: 'lte', value: 2 },        // 3% <= 2 → fail
      { metric: 'throughput', op: 'gte', value: 40 },       // 45 >= 40 → pass
    ]);
    expect(r.map(x => x.passed)).toEqual([true, false, false, true]);
    expect(r[2].actual).toBeCloseTo(3, 5);
  });

  it('returns empty for no thresholds', () => {
    expect(evaluateThresholds(result, [])).toEqual([]);
  });
});
