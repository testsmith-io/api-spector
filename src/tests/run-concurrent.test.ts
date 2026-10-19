// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { runPlanConcurrent } from '../shared/run-concurrent';

// A controllable async task: records start/end and resolves after a tick count.
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

describe('runPlanConcurrent', () => {
  it('runs non-barrier items up to the concurrency limit at once', async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 6 }, (_, i) => ({ id: i, hook: false }));
    await runPlanConcurrent(3, items, it => it.hook, async () => {
      active++; peak = Math.max(peak, active);
      await Promise.resolve();   // yield
      await Promise.resolve();
      active--;
    });
    expect(peak).toBe(3);
  });

  it('never overlaps a barrier with other items', async () => {
    const order: string[] = [];
    let active = 0;
    const barrierSawActive: number[] = [];
    const items = [
      { id: 'a', hook: false }, { id: 'b', hook: false }, { id: 'c', hook: false },
      { id: 'BARRIER', hook: true },
      { id: 'd', hook: false }, { id: 'e', hook: false },
    ];
    await runPlanConcurrent(3, items, it => it.hook, async (it) => {
      if (it.hook) barrierSawActive.push(active);
      active++;
      await Promise.resolve();
      order.push(it.id);
      active--;
    });
    // When the barrier ran, nothing else was in flight.
    expect(barrierSawActive).toEqual([0]);
    // a,b,c all finish before the barrier, which finishes before d,e.
    expect(order.indexOf('BARRIER')).toBeGreaterThan(order.indexOf('a'));
    expect(order.indexOf('BARRIER')).toBeGreaterThan(order.indexOf('c'));
    expect(order.indexOf('d')).toBeGreaterThan(order.indexOf('BARRIER'));
    expect(order.indexOf('e')).toBeGreaterThan(order.indexOf('BARRIER'));
  });

  it('runs every item exactly once, in index order for the run calls', async () => {
    const seen: number[] = [];
    const items = Array.from({ length: 5 }, (_, i) => ({ i, hook: false }));
    await runPlanConcurrent(2, items, () => false, async (_it, index) => {
      seen.push(index);
      await Promise.resolve();
    });
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('with concurrency 1 behaves sequentially', async () => {
    let active = 0; let peak = 0;
    const items = Array.from({ length: 4 }, (_, i) => ({ i, hook: false }));
    await runPlanConcurrent(1, items, () => false, async () => {
      active++; peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
    });
    expect(peak).toBe(1);
  });

  it('completes a deferred-task plan only once all resolve', async () => {
    const d1 = deferred();
    const d2 = deferred();
    const items = [{ t: d1 }, { t: d2 }];
    let finished = false;
    const p = runPlanConcurrent(2, items, () => false, async (it) => { await it.t.promise; }).then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    d1.resolve(); d2.resolve();
    await p;
    expect(finished).toBe(true);
  });
});
