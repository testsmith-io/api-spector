// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Pure pathspec translation for scoped git mode. Kept dependency-free (no
// electron / file-handler imports) so it is unit-testable in isolation. See
// git-scope.ts for the stateful resolution that uses these.

import { sep, isAbsolute, join } from 'node:path';

/** OS path → posix (forward-slash) path. */
export function toPosix(p: string): string {
  return p.split(sep).join('/');
}

/** Workspace-relative path → repo-root-relative pathspec. */
export function toRepoPath(scope: string, wsRelPath: string): string {
  return scope ? `${scope}/${wsRelPath}` : wsRelPath;
}

/** Repo-root-relative path → workspace-relative path. */
export function fromRepoPath(scope: string, repoRelPath: string): string {
  if (!scope) return repoRelPath;
  const prefix = `${scope}/`;
  return repoRelPath.startsWith(prefix) ? repoRelPath.slice(prefix.length) : repoRelPath;
}

/** Pathspec that limits an operation to the scope subtree ('.' in own mode). */
export function scopePathspec(scope: string): string {
  return scope || '.';
}

/** True when a repo-root-relative path lies within the scope subtree. */
export function isWithinScope(scope: string, repoRelPath: string): boolean {
  if (!scope) return true;
  return repoRelPath === scope || repoRelPath.startsWith(`${scope}/`);
}

/** Resolve a path that may be absolute or repo-root-relative to an absolute path. */
export function resolveFromRoot(repoRoot: string, maybeRel: string): string {
  return isAbsolute(maybeRel) ? maybeRel : join(repoRoot, maybeRel);
}
