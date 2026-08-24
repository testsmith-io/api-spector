// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import type { Workspace, ApiRequest } from '../../shared/types';
import { importPact } from './pact-format';
import { designContractToPact } from './design-pact';

/**
 * Design-first consumer contracts as runnable, contract-bearing requests - so a
 * contract authored in the Contract Designer is verifiable directly (in the CLI
 * and the app), with no manual `pact-import` into a collection.
 *
 * Two sources are merged and de-duplicated (the same interaction from both is
 * kept once): the workspace's inline `designContracts`, and any `pacts/*.json`
 * files in the workspace directory (read only when `dir` is given). Each is
 * normalized through the same Pact importer the CLI already uses, so the results
 * carry a `contract` and run in the consumer / provider-live / bidirectional
 * modes exactly like imported ones.
 */
export async function loadDesignContractRequests(
  workspace: Pick<Workspace, 'designContracts'>,
  dir?: string,
): Promise<ApiRequest[]> {
  const out: ApiRequest[] = [];
  const seen = new Set<string>();
  const add = (requests: ApiRequest[]): void => {
    for (const r of requests) {
      const key = `${r.method} ${r.url} ${r.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  };

  // 1. Inline design contracts authored in the Contract Designer.
  for (const cc of workspace.designContracts ?? []) {
    try {
      add(importPact(designContractToPact(cc)).requests);
    } catch {
      // skip a malformed design contract rather than failing the whole run
    }
  }

  // 2. Pact files saved into the workspace's pacts/ directory (filesystem only).
  if (dir) {
    let files: string[] = [];
    try {
      files = (await readdir(join(dir, 'pacts'))).filter(f => f.endsWith('.json'));
    } catch {
      // no pacts/ directory - nothing to add
    }
    for (const f of files.sort()) {
      try {
        add(importPact(await readFile(join(dir, 'pacts', f), 'utf8')).requests);
      } catch {
        // skip an unreadable / invalid pact file
      }
    }
  }

  return out;
}
