// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Reusable TypeScript library files, scoped to a workspace, collection or
// folder. Scripts pull them in with sp.require('<name>').
//
// Scope membership is encoded in the on-disk path under `lib/` - no model entry:
//   lib/<name>.ts                      -> workspace (every collection)
//   lib/collections/<collectionId>/*   -> that collection
//   lib/folders/<folderId>/*           -> that folder (and its subtree)
// On a name clash the innermost scope wins, matching variable precedence.

/** A library with its content, as handed to the script sandbox. */
export interface ScriptLibrary {
  name: string
  code: string
}

export type LibraryScope = 'workspace' | 'collection' | 'folder'

export const WORKSPACE_LIB_DIR = 'lib';

export function collectionLibDir(collectionId: string): string {
  return `lib/collections/${collectionId}`;
}

export function folderLibDir(folderId: string): string {
  return `lib/folders/${folderId}`;
}

/** The lib/ directory that holds a given scope's files. */
export function libDirFor(scope: LibraryScope, scopeId?: string): string {
  if (scope === 'collection') return collectionLibDir(scopeId!);
  if (scope === 'folder') return folderLibDir(scopeId!);
  return WORKSPACE_LIB_DIR;
}

/** On-disk path for one library in a scope. */
export function libPathFor(scope: LibraryScope, name: string, scopeId?: string): string {
  return `${libDirFor(scope, scopeId)}/${name}.ts`;
}

/** Library name from a lib/ file path (basename without the .ts extension). */
export function libNameFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.ts$/, '');
}

/** The libraries that live directly in `dir` (not in a sub-directory of it),
 *  from a path -> content map. Order follows the map's key order. */
export function librariesInDir(contents: Record<string, string>, dir: string): ScriptLibrary[] {
  const prefix = dir + '/';
  const out: ScriptLibrary[] = [];
  for (const [path, code] of Object.entries(contents)) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (rest.includes('/') || !rest.endsWith('.ts')) continue; // direct children only
    out.push({ name: libNameFromPath(path), code });
  }
  return out;
}

/** Merge library sets from outermost (workspace) to innermost (folder chain);
 *  on a name collision the innermost wins, matching variable precedence. Later
 *  arrays override earlier ones. Order of the result follows first appearance. */
export function mergeLibraries(...scopes: (ScriptLibrary[] | undefined)[]): ScriptLibrary[] {
  const byName = new Map<string, string>();
  const order: string[] = [];
  for (const set of scopes) {
    for (const lib of set ?? []) {
      if (!byName.has(lib.name)) order.push(lib.name);
      byName.set(lib.name, lib.code);
    }
  }
  return order.map(name => ({ name, code: byName.get(name)! }));
}

/** Library file names are what scripts type in sp.require(). Keep them to a
 *  safe, path-free token so a name maps cleanly onto a single lib/ file. */
export function isValidLibraryName(name: string): boolean {
  return /^[A-Za-z_][\w-]*$/.test(name);
}
