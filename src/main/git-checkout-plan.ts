// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Pure decision logic for `git checkout <branch>`, free of simple-git so it stays
// unit-testable. The caller never tells us local vs remote, and branch names
// routinely contain slashes (feat/…, fix/…), so we must NOT guess "remote" from a
// '/': we decide against the actual local-branch list instead.

export type CheckoutPlan =
  /** `git checkout <name>` - switch to an existing local branch. */
  | { kind: 'switch'; name: string }
  /** `git checkout -b <name> <startPoint>` - create a local branch tracking a remote ref. */
  | { kind: 'track'; name: string; startPoint: string };

/** Decide how to check out `branch` given the current local branch names.
 *  - An existing local branch (even a slashed one like `feat/foo`) is switched to.
 *  - A remote-tracking ref (`origin/x`) with a matching local branch switches to
 *    the local one; with none, it creates a tracking branch from the remote ref.
 *  - Anything else (a tag or SHA) is handed to `git checkout` as-is. */
export function planCheckout(branch: string, localBranches: string[]): CheckoutPlan {
  if (localBranches.includes(branch)) return { kind: 'switch', name: branch };

  // Looks like "<remote>/<name>" (name may itself contain slashes).
  const m = /^([^/]+)\/(.+)$/.exec(branch);
  if (m) {
    const localName = m[2];
    if (localBranches.includes(localName)) return { kind: 'switch', name: localName };
    return { kind: 'track', name: localName, startPoint: branch };
  }

  return { kind: 'switch', name: branch };
}
