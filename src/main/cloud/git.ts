// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Resolve the contract "version" — the git SHA — automatically, so publishing
// and gating key off the exact commit without anyone typing it. Prefers the CI
// provider's env var, then falls back to the local git checkout.

import { execSync } from 'child_process';

/** The commit SHA to key a publish/gate on. Override wins, then CI env, then git. */
export function resolveVersion(override?: string): string {
  if (override) return override;

  const env = process.env['GITHUB_SHA']
    || process.env['CI_COMMIT_SHA']       // GitLab
    || process.env['GIT_COMMIT']          // Jenkins
    || process.env['CIRCLE_SHA1']         // CircleCI
    || process.env['BUILD_SOURCEVERSION'] // Azure Pipelines
    || process.env['BITBUCKET_COMMIT'];
  if (env) return env.trim();

  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error('Could not resolve a version. Pass --version <sha>, or run inside a git repo / CI.');
  }
}

/** The current branch, best-effort (used for tagging; not required). */
export function resolveBranch(override?: string): string | undefined {
  if (override) return override;

  const env = process.env['GITHUB_REF_NAME'] || process.env['CI_COMMIT_BRANCH'] || process.env['GIT_BRANCH'];
  if (env) return env.trim();

  try {
    const b = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return b && b !== 'HEAD' ? b : undefined;
  } catch {
    return undefined;
  }
}
