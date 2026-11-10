// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workspace, ApiRequest } from '../../shared/types';
import { importPact } from './pact-format';
import { designContractToPact } from './design-pact';

/** Design-first consumer contracts as runnable requests (no manual pact-import).
 *  Merges + de-dupes the workspace's inline `designContracts` and `pacts/*.json` in `dir`. */
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
    files.sort((a, b) => a.localeCompare(b));
    for (const f of files) {
      try {
        add(importPact(await readFile(join(dir, 'pacts', f), 'utf8')).requests);
      } catch {
        // skip an unreadable / invalid pact file
      }
    }
  }

  return out;
}
