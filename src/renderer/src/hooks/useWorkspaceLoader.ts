// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { useCallback } from 'react';
import { useStore } from '../store';
import type { Collection, Workspace } from '../../../shared/types';

const { electron } = window;

export function useWorkspaceLoader() {
  const loadCollection   = useStore(s => s.loadCollection);
  const loadEnvironment  = useStore(s => s.loadEnvironment);
  const loadMock         = useStore(s => s.loadMock);
  const setActiveCollection = useStore(s => s.setActiveCollection);
  const setTheme = useStore(s => s.setTheme);
  const setZoom  = useStore(s => s.setZoom);

  const applyWorkspace = useCallback(async (ws: Workspace, path: string) => {
    // Reset to a clean slate before loading the new workspace
    useStore.setState({
      workspace: ws,
      workspacePath: path,
      collections: {},
      environments: {},
      mocks: {},
      tabs: [],
      activeTabId: null,
      activeMockId: null,
    });

    // Apply appearance from workspace settings (theme + zoom)
    if (ws.settings?.theme) setTheme(ws.settings.theme);
    if (typeof ws.settings?.zoom === 'number') setZoom(ws.settings.zoom);

    for (const colPath of ws.collections) {
      try {
        const col: Collection = await electron.loadCollection(colPath);
        loadCollection(colPath, col);
      } catch { /* ignore missing files */ }
    }

    for (const envPath of ws.environments) {
      try {
        const env = await electron.loadEnvironment(envPath);
        loadEnvironment(envPath, env);
      } catch { /* ignore */ }
    }

    for (const relPath of (ws.mocks ?? [])) {
      try {
        const mockData = await electron.loadMock(relPath);
        loadMock(relPath, mockData);
      } catch { /* ignore */ }
    }

    if (ws.collections.length > 0) {
      try {
        const firstCol: Collection = await electron.loadCollection(ws.collections[0]);
        setActiveCollection(firstCol.id);
      } catch { /* ignore */ }
    }
  }, [loadCollection, loadEnvironment, loadMock, setActiveCollection, setTheme, setZoom]);

  return { applyWorkspace };
}
