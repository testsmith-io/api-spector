// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useMemo } from 'react';
import { useStore } from '../store';
import { resolveEnvironmentChain } from '../../../shared/environments';
import type { Environment } from '../../../shared/types';

type EnvironmentsMap = Record<string, { relPath: string; data: Environment }>

/**
 * Overlay session / in-run script env writes (`sp.environment.set`) onto a
 * resolved environment for the next send, without touching the store or the
 * `.env.json` file. Existing non-secret vars are updated in place; new keys are
 * appended as enabled plain values; secret vars are left untouched (their
 * ciphertext is never overwritten with a plaintext).
 *
 * When there is NO active environment, a synthetic one is created to carry the
 * overrides — otherwise a value a script set (e.g. a token) would have nowhere
 * to live and would silently vanish on the next send. Returns the input
 * unchanged when there are no overrides.
 */
export function withEnvOverrides(
  env: Environment | null,
  overrides: Record<string, string>,
): Environment | null {
  if (Object.keys(overrides).length === 0) return env;
  if (!env) {
    return {
      version: '1.0',
      id: '__session__',
      name: '',
      variables: Object.entries(overrides).map(([key, value]) => ({ key, value, enabled: true })),
    };
  }
  const variables = env.variables.map(v =>
    (v.key in overrides && !v.secret) ? { ...v, value: overrides[v.key] } : v,
  );
  for (const [key, value] of Object.entries(overrides)) {
    if (!env.variables.some(v => v.key === key)) {
      variables.push({ key, value, enabled: true });
    }
  }
  return { ...env, variables };
}

/**
 * Resolve an environment (by store id) through its `extends` inheritance
 * chain. Non-hook helper so send-time code paths that re-read the store via
 * `useStore.getState()` can resolve fresh snapshots the same way.
 */
export function resolveEnvironmentById(
  environments: EnvironmentsMap,
  id: string | null,
): Environment | null {
  if (!id) return null;
  const env = environments[id]?.data;
  if (!env) return null;
  const all = Object.values(environments).map(e => e.data);
  return resolveEnvironmentChain(env, all);
}

/**
 * The ACTIVE environment with its `extends` inheritance chain resolved
 * (parent variables merged in, child wins per key). Null when no environment
 * is active.
 */
export function useActiveEnvironment(): Environment | null {
  const activeEnvironmentId = useStore(s => s.activeEnvironmentId);
  const environments        = useStore(s => s.environments);

  return useMemo(
    () => resolveEnvironmentById(environments, activeEnvironmentId),
    [environments, activeEnvironmentId],
  );
}
