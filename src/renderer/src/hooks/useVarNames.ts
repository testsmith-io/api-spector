// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useMemo } from 'react';
import { useStore } from '../store';
import { useActiveEnvironment } from './useActiveEnvironment';
import { DYNAMIC_VAR_NAMES } from '../components/RequestBuilder/atCompletions';

// Regex to extract keys from sp.*.set("key", ...) calls in scripts
const SCRIPT_SET_RE = /\bsp\.(?:variables|collectionVariables|environment|globals)\.set\(\s*["']([^"']+)["']/g;

function extractScriptVarNames(script: string | undefined): string[] {
  if (!script) return [];
  const names: string[] = [];
  let m: RegExpExecArray | null;
  SCRIPT_SET_RE.lastIndex = 0;
  while ((m = SCRIPT_SET_RE.exec(script)) !== null) names.push(m[1]);
  return names;
}

/** Returns all variable names visible in the current request scope (env + collection + globals + script-defined). */
export function useVarNames(): string[] {
  const activeCollectionId  = useStore(s => s.activeCollectionId);
  const collections         = useStore(s => s.collections);
  const globals             = useStore(s => s.globals);
  const sessionVars         = useStore(s => s.sessionVars);
  // Resolved through the extends chain so inherited variables autocomplete too.
  const activeEnv           = useActiveEnvironment();

  return useMemo(() => {
    const names = new Set<string>();

    // Globals
    Object.keys(globals).forEach(k => names.add(k));

    // Session vars (sp.variables.set from previous requests this session)
    Object.keys(sessionVars).forEach(k => names.add(k));

    // Collection variables + script-defined variables
    if (activeCollectionId) {
      const col = collections[activeCollectionId]?.data;
      if (col) {
        Object.keys(col.collectionVariables ?? {}).forEach(k => names.add(k));
        // Scan every request's pre/post scripts for .set("key", ...) calls
        for (const req of Object.values(col.requests)) {
          extractScriptVarNames(req.preRequestScript).forEach(k => names.add(k));
          extractScriptVarNames(req.postRequestScript).forEach(k => names.add(k));
        }
      }
    }

    // Environment variables (including ones inherited via extends)
    const envVars = activeEnv?.variables ?? [];
    envVars.filter(v => v.enabled && v.key).forEach(v => names.add(v.key));

    return [...DYNAMIC_VAR_NAMES, ...Array.from(names).sort()];
  }, [
    activeEnv, activeCollectionId,
    collections, globals, sessionVars,
  ]);
}
