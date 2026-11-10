// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Pure parsing for the git branch list, free of Electron/simple-git deps so it
// stays unit-testable.

import type { GitBranch } from '../shared/types';

/** The `git for-each-ref` format the branches handler uses. */
export const BRANCH_REF_FORMAT = '%(refname)|%(refname:short)|%(HEAD)|%(upstream:short)|%(upstream:track)';

/** Parse `git for-each-ref` output (BRANCH_REF_FORMAT) into GitBranch rows. Local
 *  vs remote is by ref namespace (refs/remotes/), not a '/' (local names have slashes). */
export function parseBranchRefs(raw: string, current: string): GitBranch[] {
  const branches: GitBranch[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const [fullRef, shortName, head, upstream, track] = line.split('|');
    if (!shortName || shortName.endsWith('/HEAD')) continue;
    const isRemote = fullRef.startsWith('refs/remotes/');

    // `%(upstream:track)` -> "[ahead 1, behind 2]" or empty
    let ahead: number | undefined;
    let behind: number | undefined;
    const aheadM  = /ahead (\d+)/.exec(track ?? '');
    const behindM = /behind (\d+)/.exec(track ?? '');
    if (aheadM)  ahead  = Number(aheadM[1]);
    if (behindM) behind = Number(behindM[1]);

    branches.push({
      name:     shortName,
      current:  !isRemote && (head === '*' || shortName === current),
      remote:   isRemote,
      upstream: upstream || undefined,
      ahead, behind,
    });
  }
  return branches;
}
