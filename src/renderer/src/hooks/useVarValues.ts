// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { useStore } from '../store';

/**
 * Returns a map of varName → resolved display value for the current scope.
 * Encrypted secrets show ••••••••, env-ref vars show $VARNAME.
 */
export function useVarValues(): Record<string, string> {
  const activeEnvironmentId = useStore(s => s.activeEnvironmentId);
  const activeCollectionId  = useStore(s => s.activeCollectionId);
  const environments        = useStore(s => s.environments);
  const collections         = useStore(s => s.collections);
  const globals             = useStore(s => s.globals);

  const result: Record<string, string> = { ...globals };

  if (activeCollectionId) {
    const colVars = collections[activeCollectionId]?.data.collectionVariables ?? {};
    Object.assign(result, colVars);
  }

  if (activeEnvironmentId) {
    for (const v of environments[activeEnvironmentId]?.data.variables ?? []) {
      if (!v.enabled || !v.key) continue;
      if (v.secret && v.secretEncrypted) {
        result[v.key] = '••••••••';
      } else if (v.envRef) {
        result[v.key] = `$${v.envRef}`;
      } else {
        result[v.key] = v.value;
      }
    }
  }

  return result;
}
