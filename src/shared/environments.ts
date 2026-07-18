// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { Environment, EnvVariable, Workspace } from './types';

// ─── Environment inheritance + default environment ────────────────────────────
//
// An environment may `extends` another by name; the child's variables win on
// key collisions. Chains work (base <- staging <- staging-eu). Everything that
// consumes an environment (request send, runner, contract runs, code
// generation, variable autocompletion) should resolve it through
// `resolveEnvironmentChain` first, so inheritance behaves identically in the
// GUI and the CLI.

/**
 * Merge an environment with its `extends` chain. Parent variables come first,
 * overridden per key (case-sensitive) by descendants; the child's own
 * variables always win. Disabled variables still participate as overrides so
 * a child can deliberately disable an inherited key. Cycles and missing
 * parents are tolerated: resolution stops at the first repeat or unknown name.
 */
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

  // Root first, child last — later entries override earlier ones per key.
  const merged = new Map<string, EnvVariable>();
  for (const link of [...chain].reverse()) {
    for (const v of link.variables) merged.set(v.key, v);
  }

  return { ...env, variables: [...merged.values()] };
}

/**
 * Pick the environment for a run: the explicitly requested name, else the
 * workspace's default environment, else none. The returned environment is
 * already inheritance-resolved. `requestedName` matching is case-insensitive,
 * like the CLI's existing --environment lookup.
 */
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
