// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { simpleGit, type SimpleGit } from 'simple-git';
import { relative, basename } from 'node:path';
import type { GitRepoInfo } from '../../shared/types';
import { getWorkspaceDir, getGitScopePref } from './file-handler';
import { toPosix } from './git-scope-paths';

// Re-export the pure pathspec helpers so handlers import everything from here.
export { toRepoPath, fromRepoPath, scopePathspec, isWithinScope, resolveFromRoot } from './git-scope-paths';

// Scoped git resolution: picks which repo to operate on and which subtree to scope
// file operations to. mode 'own' = workspace dir is the repo root (scope ''); mode
// 'scoped' = workspace is a subfolder of an enclosing repo and the user opted in
// (scope = path relative to root). Scoped mode is OPT-IN, so a workspace under an
// unrelated ancestor repo is never silently touched.

export interface GitScope {
  /** simple-git bound to the repository root (NOT the workspace dir). */
  git: SimpleGit
  /** '' in own mode; the workspace subtree (posix, no trailing slash) when scoped. */
  scope: string
  /** Absolute path of the repository working-tree root. */
  repoRoot: string
  mode: 'own' | 'scoped'
}

// Cache the toplevel lookup per workspace dir. The preference is read live, so
// toggling scoped mode needs no bust; only a change to whether the dir is in a
// repo (e.g. after `git init`) does, and callers invalidate explicitly.
const toplevelCache = new Map<string, string | null>();

async function repoToplevel(wsDir: string): Promise<string | null> {
  if (toplevelCache.has(wsDir)) return toplevelCache.get(wsDir) ?? null;
  let top: string | null = null;
  try {
    const out = await simpleGit(wsDir).revparse(['--show-toplevel']);
    top = out.trim() || null;
  } catch {
    top = null;
  }
  toplevelCache.set(wsDir, top);
  return top;
}

/** Drop cached repo-root lookups. Call after `git init` or on workspace change. */
export function clearGitScopeCache(): void {
  toplevelCache.clear();
}

/** Resolve the active git scope. Throws when there's no workspace, no repo, or
 *  the workspace is inside an enclosing repo with scoped mode off. */
export async function resolveGitScope(): Promise<GitScope> {
  const wsDir = getWorkspaceDir();
  if (!wsDir) throw new Error('No workspace open');
  const top = await repoToplevel(wsDir);
  if (!top) throw new Error('Not a git repository');
  const rel = relative(top, wsDir);
  if (rel === '') {
    return { git: simpleGit(top), scope: '', repoRoot: top, mode: 'own' };
  }
  if (getGitScopePref()) {
    return { git: simpleGit(top), scope: toPosix(rel), repoRoot: top, mode: 'scoped' };
  }
  throw new Error('Workspace is inside a repository but scoped git mode is not enabled');
}

/** Describe the repo situation for the UI without any working-tree command (so
 *  it can't wedge on a huge ancestor tree). Never throws. */
export async function detectRepoInfo(): Promise<GitRepoInfo> {
  const wsDir = getWorkspaceDir();
  if (!wsDir) return { state: 'none' };
  const top = await repoToplevel(wsDir);
  if (!top) return { state: 'none' };
  const rel = relative(top, wsDir);
  if (rel === '') return { state: 'own' };
  const scope = toPosix(rel);
  const repoName = basename(top);
  return { state: getGitScopePref() ? 'scoped' : 'enclosing-available', repoName, scope };
}
