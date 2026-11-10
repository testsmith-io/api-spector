// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { Environment, EnvVariable, Workspace } from './types';

// Environment inheritance + default environment: a child `extends` a parent by
// name and wins on key collisions; chains work (base <- staging <- staging-eu).

/** Merge an environment with its `extends` chain: the child wins per key
 *  (case-sensitive). Disabled variables still override, so a child can disable
 *  an inherited key. Cycles / missing parents stop resolution. */
export function resolveEnvironmentChain(env: Environment, all: Environment[]): Environment {
  if (!env.extends) return env;

  // Walk to the root, guarding against cycles.
  const chain: Environment[] = [env];
  const seen = new Set<string>([env.name]);
  let parentName: string | undefined = env.extends;
  while (parentName && !seen.has(parentName)) {
    const parent = all.find(e => e.name === parentName);
    if (!parent) break;
    chain.push(parent);
    seen.add(parent.name);
    parentName = parent.extends;
  }
  if (chain.length === 1) return env;

  // Root first, child last - later entries override earlier ones per key.
  const merged = new Map<string, EnvVariable>();
  for (const link of [...chain].reverse()) {
    for (const v of link.variables) merged.set(v.key, v);
  }

  return { ...env, variables: [...merged.values()] };
}

/** Pick the run environment: the requested name, else the workspace default,
 *  else none; already inheritance-resolved. `requestedName` is case-insensitive. */
export function selectEnvironment(
  workspace: Workspace,
  environments: Environment[],
  requestedName?: string,
): Environment | null {
  const name = requestedName ?? workspace.settings?.defaultEnvironment;
  if (!name) return null;
  const env = environments.find(e => e.name.toLowerCase() === name.toLowerCase());
  return env ? resolveEnvironmentChain(env, environments) : null;
}
