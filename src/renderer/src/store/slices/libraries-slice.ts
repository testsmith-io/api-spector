// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { StateCreator } from 'zustand';
import type { FullState } from '../index';
import type { ScriptLibrary, LibraryScope } from '../../../../shared/libraries';
import {
  librariesInDir, mergeLibraries, collectionLibDir, folderLibDir, WORKSPACE_LIB_DIR,
} from '../../../../shared/libraries';

/** Scope key used by the create-request signal and the tree groups. */
export function libraryScopeKey(scope: LibraryScope, scopeId?: string): string {
  return `${scope}:${scopeId ?? ''}`;
}
import { findFolderPath } from '../../../../shared/folder-tree';

export interface LibrariesSliceState {
  /** Every reusable library file under lib/, as path -> TypeScript source.
   *  Loaded on workspace open; the source of truth for sp.require resolution. */
  libraryContents: Record<string, string>
  /** Transient signal: a scope key ("workspace:" | "collection:<id>" |
   *  "folder:<id>") whose tree group should open its inline "new library" input.
   *  Set by the context-menu action, consumed and cleared by the group. */
  libraryCreateRequest: string | null
}

export interface LibrariesSliceActions {
  /** (Re)load all lib/ files from disk into the store. */
  loadLibraryContents: () => Promise<void>
  /** Persist one library file and update the in-memory copy. */
  saveLibraryFile: (path: string, content: string) => Promise<void>
  /** Delete one library file from disk and the store; closes its open tab. */
  deleteLibraryFile: (path: string) => Promise<void>
  /** Move a library file to a new path (rename), keeping its content; retargets
   *  an open tab. */
  renameLibraryFile: (oldPath: string, newPath: string) => Promise<void>
  /** Merged libraries in scope for a request: workspace + its collection + its
   *  folder chain (innermost wins). What a script's sp.require() resolves against. */
  getScopedLibraries: (requestId: string) => ScriptLibrary[]
  /** Ask the matching tree group to open its inline "new library" input. */
  requestLibraryCreate: (scope: LibraryScope, scopeId?: string) => void
  clearLibraryCreateRequest: () => void
}

export type LibrariesSlice = LibrariesSliceState & LibrariesSliceActions

export const createLibrariesSlice: StateCreator<
  FullState,
  [['zustand/immer', never]],
  [],
  LibrariesSlice
> = (set, get) => ({
  libraryContents: {},
  libraryCreateRequest: null,

  requestLibraryCreate: (scope, scopeId) => set(s => { s.libraryCreateRequest = libraryScopeKey(scope, scopeId); }),
  clearLibraryCreateRequest: () => set(s => { s.libraryCreateRequest = null; }),

  loadLibraryContents: async () => {
    const map = await window.electron.loadLibraries();
    set(s => { s.libraryContents = map; });
  },

  saveLibraryFile: async (path, content) => {
    await window.electron.saveLibrary(path, content);
    set(s => { s.libraryContents[path] = content; });
  },

  deleteLibraryFile: async (path) => {
    await window.electron.deleteWorkspaceFile(path);
    set(s => {
      delete s.libraryContents[path];
      // Close the tab editing the deleted file, activating an adjacent one.
      const idx = s.tabs.findIndex(t => t.kind === 'library' && t.libraryPath === path);
      if (idx !== -1) {
        const wasActive = s.tabs[idx].id === s.activeTabId;
        s.tabs.splice(idx, 1);
        if (wasActive) s.activeTabId = (s.tabs[idx] ?? s.tabs[idx - 1])?.id ?? null;
      }
    });
  },

  renameLibraryFile: async (oldPath, newPath) => {
    if (oldPath === newPath) return;
    const content = get().libraryContents[oldPath] ?? '';
    await window.electron.saveLibrary(newPath, content);
    await window.electron.deleteWorkspaceFile(oldPath);
    set(s => {
      delete s.libraryContents[oldPath];
      s.libraryContents[newPath] = content;
      for (const t of s.tabs) if (t.kind === 'library' && t.libraryPath === oldPath) t.libraryPath = newPath;
    });
  },

  getScopedLibraries: (requestId) => {
    const state = get();
    const contents = state.libraryContents;
    const wsLibs = librariesInDir(contents, WORKSPACE_LIB_DIR);

    const colEntry = Object.values(state.collections).find(c => requestId in c.data.requests);
    if (!colEntry) return mergeLibraries(wsLibs);

    const colLibs = librariesInDir(contents, collectionLibDir(colEntry.data.id));
    const folderLibSets = findFolderPath(colEntry.data.rootFolder, requestId)
      .map(f => librariesInDir(contents, folderLibDir(f.id)));
    return mergeLibraries(wsLibs, colLibs, ...folderLibSets);
  },
});
