// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useMemo } from 'react';
import { useStore } from '../store';
import { resolveEnvironmentChain } from '../../../shared/environments';
import type { Environment } from '../../../shared/types';

type EnvironmentsMap = Record<string, { relPath: string; data: Environment }>

/** Overlay in-run script env writes (`sp.environment.set`) onto a resolved environment:
 *  non-secret vars update in place, new keys append, secrets untouched, input returned unchanged if no overrides. */
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

/** Resolve an environment (by store id) through its `extends` chain. Non-hook so
 *  send-time code reading the store via `useStore.getState()` resolves the same way. */
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

/** The active environment with its `extends` chain resolved (child wins per key).
 *  Null when no environment is active. */
export function useActiveEnvironment(): Environment | null {
  const activeEnvironmentId = useStore(s => s.activeEnvironmentId);
  const environments        = useStore(s => s.environments);

  return useMemo(
    () => resolveEnvironmentById(environments, activeEnvironmentId),
    [environments, activeEnvironmentId],
  );
}
