// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useStore } from '../store';
import { useActiveEnvironment } from './useActiveEnvironment';
import { collectFolderVars } from '../../../shared/folder-tree';

/**
 * Returns a map of varName → resolved display value for the current scope.
 * Encrypted secrets show ••••••••, env-ref vars show $VARNAME. Assembled in
 * precedence order (higher wins): global < environment < collection < folder <
 * request, matching the runner.
 *
 * Session script values (sp.*.set from earlier sends this session) overlay each
 * scope at that scope's level, so a value a previous request extracted — e.g. a
 * token — shows here even though it was never saved to the environment/collection
 * files. They match what the send resolves.
 */
export function useVarValues(): Record<string, string> {
  const activeCollectionId  = useStore(s => s.activeCollectionId);
  const collections         = useStore(s => s.collections);
  const globals             = useStore(s => s.globals);
  const session             = useStore(s => s.sessionScriptVars);
  const activeTabId         = useStore(s => s.activeTabId);
  const tabs                = useStore(s => s.tabs);
  // Active environment resolved through its extends chain, so inherited
  // variables display exactly like the environment's own.
  const activeEnv           = useActiveEnvironment();

  const result: Record<string, string> = { ...globals, ...session.globals };

  // Environment scope (a shared default: above globals, below collection).
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
  Object.assign(result, session.env);

  // Collection scope (above environment, below folder/request).
  if (activeCollectionId) {
    const colVars = collections[activeCollectionId]?.data.collectionVariables ?? {};
    Object.assign(result, colVars);
  }
  Object.assign(result, session.collection);

  // Folder scope of the active request (above collection, below request).
  const tab = tabs.find(x => x.id === activeTabId);
  const tabCol = tab?.collectionId ? collections[tab.collectionId]?.data : undefined;
  const activeReq = tab?.requestId && tabCol ? tabCol.requests[tab.requestId] : undefined;
  if (activeReq && tabCol) Object.assign(result, collectFolderVars(tabCol.rootFolder, activeReq.id));
  Object.assign(result, session.folder);

  // Request scope (highest static scope) overrides all of the above; when the
  // active tab is an example, its own variables override the request's.
  if (activeReq) {
    Object.assign(result, activeReq.variables ?? {});
    if (tab?.exampleId) {
      const ex = activeReq.examples?.find(e => e.id === tab.exampleId);
      if (ex?.request?.variables) Object.assign(result, ex.request.variables);
    }
  }

  return result;
}
