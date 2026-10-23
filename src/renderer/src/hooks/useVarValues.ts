// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useStore } from '../store';
import { useActiveEnvironment } from './useActiveEnvironment';
import { collectFolderVars } from '../../../shared/folder-tree';

/**
 * Returns a map of varName → resolved display value for the current scope.
 * Encrypted secrets show ••••••••, env-ref vars show $VARNAME. Assembled in
 * precedence order (higher wins): global < collection < folder < environment <
 * request, matching the runner.
 */
export function useVarValues(): Record<string, string> {
  const activeCollectionId  = useStore(s => s.activeCollectionId);
  const collections         = useStore(s => s.collections);
  const globals             = useStore(s => s.globals);
  const activeTabId         = useStore(s => s.activeTabId);
  const tabs                = useStore(s => s.tabs);
  // Active environment resolved through its extends chain, so inherited
  // variables display exactly like the environment's own.
  const activeEnv           = useActiveEnvironment();

  const result: Record<string, string> = { ...globals };

  if (activeCollectionId) {
    const colVars = collections[activeCollectionId]?.data.collectionVariables ?? {};
    Object.assign(result, colVars);
  }

  // Folder scope of the active request (below environment).
  const tab = tabs.find(x => x.id === activeTabId);
  const tabCol = tab?.collectionId ? collections[tab.collectionId]?.data : undefined;
  const activeReq = tab?.requestId && tabCol ? tabCol.requests[tab.requestId] : undefined;
  if (activeReq && tabCol) Object.assign(result, collectFolderVars(tabCol.rootFolder, activeReq.id));

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

  // Request scope (highest static scope) overrides all of the above.
  if (activeReq) Object.assign(result, activeReq.variables ?? {});

  return result;
}
