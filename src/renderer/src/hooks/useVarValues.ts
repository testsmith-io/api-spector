// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useStore } from '../store';
import { useActiveEnvironment } from './useActiveEnvironment';

/**
 * Returns a map of varName → resolved display value for the current scope.
 * Encrypted secrets show ••••••••, env-ref vars show $VARNAME.
 */
export function useVarValues(): Record<string, string> {
  const activeCollectionId  = useStore(s => s.activeCollectionId);
  const collections         = useStore(s => s.collections);
  const globals             = useStore(s => s.globals);
  // Active environment resolved through its extends chain, so inherited
  // variables display exactly like the environment's own.
  const activeEnv           = useActiveEnvironment();

  const result: Record<string, string> = { ...globals };

  if (activeCollectionId) {
    const colVars = collections[activeCollectionId]?.data.collectionVariables ?? {};
    Object.assign(result, colVars);
  }

  for (const v of activeEnv?.variables ?? []) {
    if (!v.enabled || !v.key) continue;
    if (v.secret && v.secretEncrypted) {
      result[v.key] = '••••••••';
    } else if (v.envRef) {
      result[v.key] = `$${v.envRef}`;
    } else {
      result[v.key] = v.value;
    }
  }

  return result;
}
