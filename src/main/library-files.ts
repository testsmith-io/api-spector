// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Read reusable TypeScript library files from a workspace's lib/ directory and
// resolve the set in scope for a given request. Shared by the file IPC handler
// (for the editor) and the CLI runner (so sp.require works headlessly).

import { readFile, readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Collection } from '../shared/types';
import type { ScriptLibrary } from '../shared/libraries';
import {
  librariesInDir, mergeLibraries, collectionLibDir, folderLibDir, WORKSPACE_LIB_DIR,
} from '../shared/libraries';
import { findFolderPath } from '../shared/folder-tree';

/** Every `.ts` file under `<wsDir>/lib`, as workspace-relative path -> source.
 *  Returns {} when lib/ does not exist. */
export async function readLibraryFiles(wsDir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // dir absent
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.ts')) {
        out[relative(wsDir, full).split(sep).join('/')] = await readFile(full, 'utf8');
      }
    }
  };
  await walk(join(wsDir, 'lib'));
  return out;
}

/** Libraries in scope for a request: workspace + its collection + its folder
 *  chain, merged innermost-wins. `contents` is the map from readLibraryFiles. */
export function resolveRequestLibraries(
  collection: Collection,
  requestId: string,
  contents: Record<string, string>,
): ScriptLibrary[] {
  const wsLibs  = librariesInDir(contents, WORKSPACE_LIB_DIR);
  const colLibs = librariesInDir(contents, collectionLibDir(collection.id));
  const folderLibSets = findFolderPath(collection.rootFolder, requestId)
    .map(f => librariesInDir(contents, folderLibDir(f.id)));
  return mergeLibraries(wsLibs, colLibs, ...folderLibSets);
}
