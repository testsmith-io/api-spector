// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import type { ApiRequest, ContractReport } from '../../shared/types';

// ─── Pending contracts (Pact's "pending pacts") ───────────────────────────────
//
// A contract that has never passed provider verification is "pending": it runs
// and its failures are reported, but they do not fail the build. Once an
// interaction passes for the first time, it stops being pending and future
// failures block. This lets consumers add new expectations without breaking
// the provider's CI before the provider implements them.
//
// The store is a plain file, `contracts/pending.json`, committed to git like
// everything else. The key includes a hash of the contract content, so
// changing an interaction's expectations makes it pending again (same rule
// Pact applies to changed pact content).

const PENDING_FILE = 'contracts/pending.json';

export interface PendingStore {
  /** interaction key → ISO timestamp of the first successful verification */
  firstPassed: Record<string, string>
}

/** Stable identity for an interaction: the request plus its contract content.
 *  Changing the contract produces a new key, which resets pending status. */
export function interactionKey(req: ApiRequest): string {
  const contractHash = createHash('sha256')
    .update(JSON.stringify(req.contract ?? {}))
    .digest('hex')
    .slice(0, 16);
  return `${req.id}:${contractHash}`;
}

export async function loadPendingStore(dir: string): Promise<PendingStore> {
  try {
    return JSON.parse(await readFile(join(dir, PENDING_FILE), 'utf8')) as PendingStore;
  } catch {
    return { firstPassed: {} };
  }
}

export async function savePendingStore(dir: string, store: PendingStore): Promise<void> {
  const file = join(dir, PENDING_FILE);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(store, null, 2), 'utf8');
}

/**
 * Apply pending semantics to a finished report, in place:
 * - failures of interactions that never passed before → marked `pending` and
 *   moved out of the `failed` count into `report.pending`
 * - passing interactions get their first-pass timestamp recorded in the store
 *
 * Returns the keys that passed for the first time (caller persists the store).
 */
export function applyPendingSemantics(
  report: ContractReport,
  requests: ApiRequest[],
  store: PendingStore,
  now: string,
): { newlyPassed: string[] } {
  const byId = new Map(requests.map(r => [r.id, r]));
  const newlyPassed: string[] = [];
  let pendingCount = 0;

  for (const result of report.results) {
    const req = byId.get(result.requestId);
    if (!req) continue;
    const key = interactionKey(req);

    if (result.passed) {
      if (!store.firstPassed[key]) {
        store.firstPassed[key] = now;
        newlyPassed.push(key);
      }
      continue;
    }
    if (!store.firstPassed[key]) {
      result.pending = true;
      pendingCount++;
    }
  }

  if (pendingCount > 0) {
    report.failed -= pendingCount;
    report.pending = pendingCount;
  }
  return { newlyPassed };
}
