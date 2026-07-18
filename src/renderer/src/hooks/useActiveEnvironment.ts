// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useMemo } from 'react';
import { useStore } from '../store';
import { resolveEnvironmentChain } from '../../../shared/environments';
import type { Environment } from '../../../shared/types';

type EnvironmentsMap = Record<string, { relPath: string; data: Environment }>

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
