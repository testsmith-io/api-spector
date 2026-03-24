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

import { useCallback } from 'react';
import { useStore } from '../store';
import type { Collection, Workspace } from '../../../shared/types';

const { electron } = window;

export function useWorkspaceLoader() {
  const loadCollection   = useStore(s => s.loadCollection);
  const loadEnvironment  = useStore(s => s.loadEnvironment);
  const loadMock         = useStore(s => s.loadMock);
  const setActiveCollection = useStore(s => s.setActiveCollection);

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
  }, [loadCollection, loadEnvironment, loadMock, setActiveCollection]);

  return { applyWorkspace };
}
