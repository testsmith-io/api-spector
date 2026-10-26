// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Performance (load) testing engine. A pattern-agnostic scheduler: it is given
// an iterate() that runs the target once (a single request, or a whole Flow),
// plus a derived load schedule (executor + stages), and it drives that iterate
// over time. Two executors:
//   vus     — closed model: hold target(t) concurrent users; each user runs
//             iterations back to back.
//   arrival — open model: start target(t) iterations per second, spawning users
//             as needed up to maxVus; arrivals that exceed the cap are dropped.
//
// It aggregates whole-iteration latency and per-step (per request) latency,
// status codes, errors and a per-second series. One run at a time; stopPerfRun
// aborts it.

import type { PerfLatency, PerfPattern, PerfProgress, PerfResult, PerfStepStat } from '../shared/types';
import { targetAt, type DerivedLoad } from '../shared/perf-stages';

export interface PerfStepSample { name: string; ok: boolean; status: number; ms: number; bytes: number; error?: string; /** Overrides the status-count key (e.g. a gRPC status name like "OK"). */ statusLabel?: string }
export interface PerfIterationSample { ok: boolean; durationMs: number; steps: PerfStepSample[] }
export type PerfIterate = (signal?: AbortSignal) => Promise<PerfIterationSample>

export interface PerfSchedule extends DerivedLoad {
  mode: 'request' | 'sequence' | 'flow'
  pattern: PerfPattern
  timeoutMs?: number
  /** Think time between iterations (closed model), ms. */
  thinkMinMs?: number
  thinkMaxMs?: number
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
function latency(values: number[]): PerfLatency {
  const s = [...values].sort((a, b) => a - b);
  return {
    min: s[0] ?? 0,
    max: s[s.length - 1] ?? 0,
    mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0,
    p50: percentile(s, 50), p90: percentile(s, 90), p95: percentile(s, 95), p99: percentile(s, 99),
  };
}
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

let active: { stop: () => void } | null = null;
export function stopPerfRun(): void { active?.stop(); }

export async function runPerfTest(
  schedule: PerfSchedule,
  iterate: PerfIterate,
  onProgress?: (p: PerfProgress) => void,
  progressMs = 500,
): Promise<PerfResult> {
  const totalMs = Math.max(100, schedule.totalSec * 1000);
  const maxVus = Math.max(1, schedule.maxVus || 100000);

  // Aggregates
  const iterLat: number[] = [];
  const reqLat: number[] = [];
  const statusCounts: Record<string, number> = {};
  const errors: Record<string, number> = {};
  const stepOrder: string[] = [];
  const stepMap = new Map<string, { count: number; failed: number; lat: number[]; status: Record<string, number> }>();
  const buckets = new Map<number, { count: number; lat: number[] }>();
  let iterations = 0;
  let iterationsFailed = 0;
  let bytes = 0;
  let activeVus = 0;
  let peakVus = 0;
  let dropped = 0;
  // `stopped` is the internal wind-down signal — it is also set on normal
  // completion to drain the workers, so it does NOT mean "the user stopped it".
  // `stoppedEarly` is the real indicator: only a stop() call (the Stop button)
  // sets it, so the result reflects an actual early stop, not a finished run.
  let stopped = false;
  let stoppedEarly = false;

  const start = Date.now();
  active = { stop: () => { stopped = true; stoppedEarly = true; } };

  const record = (s: PerfIterationSample): void => {
    iterations += 1;
    if (!s.ok) iterationsFailed += 1;
    iterLat.push(s.durationMs);
    const sec = Math.floor((Date.now() - start) / 1000);
    let b = buckets.get(sec);
    if (!b) { b = { count: 0, lat: [] }; buckets.set(sec, b); }
    b.count += 1;
    b.lat.push(s.durationMs);
    for (const step of s.steps) {
      let e = stepMap.get(step.name);
      if (!e) { e = { count: 0, failed: 0, lat: [], status: {} }; stepMap.set(step.name, e); stepOrder.push(step.name); }
      e.count += 1;
      if (!step.ok) e.failed += 1;
      e.lat.push(step.ms);
      reqLat.push(step.ms);
      bytes += step.bytes;
      const key = step.statusLabel ?? (step.status > 0 ? String(step.status) : 'error');
      e.status[key] = (e.status[key] ?? 0) + 1;
      statusCounts[key] = (statusCounts[key] ?? 0) + 1;
      if (step.error) errors[step.error] = (errors[step.error] ?? 0) + 1;
    }
  };

  const runOne = async (): Promise<void> => {
    activeVus += 1;
    if (activeVus > peakVus) peakVus = activeVus;
    const t0 = Date.now();
    let controller: AbortController | undefined;
    let to: ReturnType<typeof setTimeout> | undefined;
    if (schedule.timeoutMs) { controller = new AbortController(); to = setTimeout(() => controller!.abort(), schedule.timeoutMs); }
    try {
      record(await iterate(controller?.signal));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      record({ ok: false, durationMs: Date.now() - t0, steps: [{ name: '(iteration)', ok: false, status: 0, ms: Date.now() - t0, bytes: 0, error: msg || 'Iteration failed' }] });
    } finally {
      if (to) clearTimeout(to);
      activeVus -= 1;
    }
  };

  const emit = (): void => {
    if (!onProgress) return;
    const elapsedMs = Date.now() - start;
    onProgress({
      running: true,
      elapsedMs,
      iterations,
      iterationsFailed,
      activeVus,
      targetNow: targetAt(schedule, elapsedMs / 1000),
      iterationsPerSec: elapsedMs > 0 ? (iterations / elapsedMs) * 1000 : 0,
      p95: percentile([...iterLat].sort((a, b) => a - b), 95),
    });
  };
  const progressTimer = setInterval(emit, progressMs);

  if (schedule.executor === 'vus') {
    // Closed model: reconcile the number of workers to target(t).
    const workers: Promise<void>[] = [];
    let retire = 0;
    let settled = 0;
    const thinkMin = Math.max(0, schedule.thinkMinMs ?? 0);
    const thinkMax = Math.max(thinkMin, schedule.thinkMaxMs ?? 0);
    const worker = async (): Promise<void> => {
      while (!stopped && Date.now() - start < totalMs) {
        if (retire > 0) { retire -= 1; break; }
        await runOne();
        if (thinkMax > 0 && !stopped) await sleep(thinkMin + Math.random() * (thinkMax - thinkMin));
      }
    };
    const reconcile = (): void => {
      if (stopped) return;
      const desired = Math.max(0, Math.round(targetAt(schedule, (Date.now() - start) / 1000)));
      const effective = workers.length - settled - retire;
      if (effective < desired) {
        for (let i = 0; i < desired - effective; i++) workers.push(worker().then(() => { settled += 1; }));
      } else if (effective > desired) {
        retire += effective - desired;
      }
    };
    const tick = setInterval(reconcile, 200);
    reconcile();
    while (!stopped && Date.now() - start < totalMs) await sleep(100);
    clearInterval(tick);
    stopped = true;
    await Promise.allSettled(workers);
  } else {
    // Open model: release target(t) arrivals per second, up to maxVus at once.
    let acc = 0;
    let last = Date.now();
    const inflight: Promise<void>[] = [];
    while (!stopped && Date.now() - start < totalMs) {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;
      acc += targetAt(schedule, (now - start) / 1000) * dt;
      while (acc >= 1) {
        acc -= 1;
        if (activeVus >= maxVus) { dropped += 1; continue; }
        inflight.push(runOne());
      }
      await sleep(50);
    }
    stopped = true;
    await Promise.allSettled(inflight);
  }

  clearInterval(progressTimer);
  active = null;

  const durationMs = Date.now() - start;
  const steps: PerfStepStat[] = stepOrder.map(name => {
    const e = stepMap.get(name)!;
    return { name, count: e.count, failed: e.failed, latency: latency(e.lat), statusCounts: e.status };
  });
  const totalRequests = reqLat.length;
  const series = [...buckets.entries()].sort((a, b) => a[0] - b[0])
    .map(([second, b]) => ({ second, rps: b.count, p95: percentile([...b.lat].sort((x, y) => x - y), 95) }));

  return {
    mode: schedule.mode,
    pattern: schedule.pattern,
    executor: schedule.executor,
    iterations,
    iterationsFailed,
    durationMs,
    iterationsPerSec: durationMs > 0 ? (iterations / durationMs) * 1000 : 0,
    requestsPerSec: durationMs > 0 ? (totalRequests / durationMs) * 1000 : 0,
    iterationLatency: latency(iterLat),
    requestLatency: latency(reqLat),
    bytes,
    bytesPerSec: durationMs > 0 ? (bytes / durationMs) * 1000 : 0,
    statusCounts,
    errors,
    steps,
    series,
    peakVus,
    droppedArrivals: dropped,
    stopped: stoppedEarly,
    thresholds: [],
    passed: true,
  };
}
