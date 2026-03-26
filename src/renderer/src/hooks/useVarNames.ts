// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

import { useMemo } from 'react';
import { useStore } from '../store';
import { DYNAMIC_VAR_NAMES } from '../components/RequestBuilder/atCompletions';

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

    return [...DYNAMIC_VAR_NAMES, ...Array.from(names).sort()];
  }, [
    activeEnvironmentId, activeCollectionId,
    environments, collections, globals,
  ]);
}
