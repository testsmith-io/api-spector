// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Scoped git mode translates paths at the git boundary: the renderer always
// sees workspace-relative paths, while git commands run at the enclosing repo
// root and need repo-root-relative pathspecs. These pure helpers do that
// translation; getting the prefix math wrong would stage/commit/diff the wrong
// files (or files outside the workspace), so they are worth pinning down.

import { describe, it, expect } from 'vitest';
import {
  toRepoPath, fromRepoPath, scopePathspec, isWithinScope, resolveFromRoot,
} from '../main/ipc/git-scope-paths';

describe('git scope path translation', () => {
  describe('own mode (empty scope) is a no-op', () => {
    it('toRepoPath/fromRepoPath leave the path unchanged', () => {
      expect(toRepoPath('', 'collections/products.json')).toBe('collections/products.json');
      expect(fromRepoPath('', 'collections/products.json')).toBe('collections/products.json');
    });
    it('scopePathspec is "." so `add .` keeps working', () => {
      expect(scopePathspec('')).toBe('.');
    });
    it('everything is within an empty scope', () => {
      expect(isWithinScope('', 'anything/at/all.json')).toBe(true);
    });
  });

  describe('scoped mode (subfolder) prefixes and strips correctly', () => {
    const scope = 'api-tests';
    it('adds the scope prefix on the way to git', () => {
      expect(toRepoPath(scope, 'collections/products.json'))
        .toBe('api-tests/collections/products.json');
    });
    it('strips the scope prefix on the way back to the renderer', () => {
      expect(fromRepoPath(scope, 'api-tests/collections/products.json'))
        .toBe('collections/products.json');
    });
    it('round-trips', () => {
      const ws = 'environments/good.env.json';
      expect(fromRepoPath(scope, toRepoPath(scope, ws))).toBe(ws);
    });
    it('leaves a path outside the scope untouched when stripping', () => {
      // A repo-root path from a sibling subtree should not be mangled.
      expect(fromRepoPath(scope, 'src/app.ts')).toBe('src/app.ts');
    });
    it('scopePathspec limits operations to the subtree', () => {
      expect(scopePathspec(scope)).toBe('api-tests');
    });
  });

  describe('nested scope', () => {
    const scope = 'qa/api-tests';
    it('prefixes and strips a multi-segment scope', () => {
      expect(toRepoPath(scope, 'collections/a.json')).toBe('qa/api-tests/collections/a.json');
      expect(fromRepoPath(scope, 'qa/api-tests/collections/a.json')).toBe('collections/a.json');
    });
  });

  describe('isWithinScope guards the commit isolation check', () => {
    const scope = 'api-tests';
    it('accepts the scope dir itself and its descendants', () => {
      expect(isWithinScope(scope, 'api-tests')).toBe(true);
      expect(isWithinScope(scope, 'api-tests/collections/a.json')).toBe(true);
    });
    it('rejects siblings and prefix-collisions', () => {
      expect(isWithinScope(scope, 'src/app.ts')).toBe(false);
      // "api-tests-helpers" must not count as inside "api-tests".
      expect(isWithinScope(scope, 'api-tests-helpers/x.json')).toBe(false);
    });
  });

  describe('resolveFromRoot', () => {
    it('joins a relative path onto the repo root', () => {
      expect(resolveFromRoot('/repo', '.git/rebase-merge')).toBe('/repo/.git/rebase-merge');
    });
    it('returns an absolute path unchanged', () => {
      expect(resolveFromRoot('/repo', '/var/git/worktrees/x')).toBe('/var/git/worktrees/x');
    });
  });
});
