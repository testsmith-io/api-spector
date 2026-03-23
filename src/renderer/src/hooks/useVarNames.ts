import { useMemo } from 'react';
import { useStore } from '../store';

/** Returns all variable names visible in the current request scope (env + collection + globals). */
export function useVarNames(): string[] {
  const activeEnvironmentId = useStore(s => s.activeEnvironmentId);
  const activeCollectionId  = useStore(s => s.activeCollectionId);
  const environments        = useStore(s => s.environments);
  const collections         = useStore(s => s.collections);
  const globals             = useStore(s => s.globals);

  return useMemo(() => {
    const names = new Set<string>();

    // Globals (lowest priority — overridden by others but still available)
    Object.keys(globals).forEach(k => names.add(k));

    // Collection variables
    if (activeCollectionId) {
      const colVars = collections[activeCollectionId]?.data.collectionVariables ?? {};
      Object.keys(colVars).forEach(k => names.add(k));
    }

    // Environment variables (highest priority)
    if (activeEnvironmentId) {
      const envVars = environments[activeEnvironmentId]?.data.variables ?? [];
      envVars.filter(v => v.enabled && v.key).forEach(v => names.add(v.key));
    }

    return Array.from(names).sort();
  }, [
    activeEnvironmentId, activeCollectionId,
    environments, collections, globals,
  ]);
}
