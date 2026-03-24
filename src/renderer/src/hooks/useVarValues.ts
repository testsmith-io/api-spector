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
