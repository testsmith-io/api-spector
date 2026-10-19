// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Schedule a run plan with bounded concurrency while respecting barriers.
// Non-barrier items run up to `concurrency` at a time; a barrier item waits for
// every in-flight item to finish, runs alone, then scheduling resumes. The
// collection runner uses this so lifecycle hooks (beforeAll/before/after/
// afterAll) stay ordered relative to the requests around them while independent
// requests still run in parallel. `run` performs the item's work (and records
// its result); this function only orders the calls.

export async function runPlanConcurrent<T>(
  concurrency: number,
  items: T[],
  isBarrier: (item: T) => boolean,
  run: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const n = Math.max(1, Math.floor(concurrency));
  const pool: { p: Promise<number>; i: number }[] = [];

  const settleOne = async (): Promise<void> => {
    const done = await Promise.race(pool.map(x => x.p));
    const pi = pool.findIndex(x => x.i === done);
    if (pi >= 0) pool.splice(pi, 1);
  };
  const drain = async (): Promise<void> => { while (pool.length) await settleOne(); };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (isBarrier(item)) {
      await drain();
      await run(item, i);          // runs alone
    } else {
      const idx = i;
      pool.push({ p: run(item, idx).then(() => idx), i: idx });
      if (pool.length >= n) await settleOne();
    }
  }
  await drain();
}
