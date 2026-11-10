// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Pure helpers for navigating and transforming a Collection's folder tree.
// No store/DOM/Electron deps - usable from renderer and main.

import { v4 as uuidv4 } from 'uuid';
import type { Folder, ChildRef } from './types';

/** De-duplicated child order: honour `childOrder` for items that still exist,
 *  then append anything missing (requests, then sub-folders). The single source
 *  of truth for tree rendering and run order. */
export function orderedChildren(folder: Folder): ChildRef[] {
  const reqSet    = new Set(folder.requestIds);
  const folderSet = new Set(folder.folders.map(f => f.id));
  const seen      = new Set<string>();
  const out: ChildRef[] = [];
  for (const ref of folder.childOrder ?? []) {
    const key = `${ref.type}:${ref.id}`;
    if (seen.has(key)) continue;
    if ((ref.type === 'request' && reqSet.has(ref.id)) || (ref.type === 'folder' && folderSet.has(ref.id))) {
      out.push({ type: ref.type, id: ref.id });
      seen.add(key);
    }
  }
  for (const id of folder.requestIds) if (!seen.has(`request:${id}`)) out.push({ type: 'request', id });
  for (const f of folder.folders)    if (!seen.has(`folder:${f.id}`)) out.push({ type: 'folder', id: f.id });
  return out;
}

/** Child order sorted alphabetically (case-insensitive), interleaving requests
 *  and sub-folders. `requestName` resolves a request id to its name. Returns a
 *  fresh ChildRef[] to store as `childOrder`. */
export function sortChildOrder(folder: Folder, requestName: (id: string) => string): ChildRef[] {
  const nameOf = (ref: ChildRef): string =>
    ref.type === 'folder'
      ? (folder.folders.find(f => f.id === ref.id)?.name ?? '')
      : requestName(ref.id);
  return [...orderedChildren(folder)].sort((a, b) =>
    nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base', numeric: true }));
}

export function findFolder(root: Folder, id: string): Folder | null {
  if (root.id === id) return root;
  for (const sub of root.folders) {
    const found = findFolder(sub, id);
    if (found) return found;
  }
  return null;
}

export function findFolderContaining(root: Folder, reqId: string): Folder | null {
  if (root.requestIds.includes(reqId)) return root;
  for (const sub of root.folders) {
    const found = findFolderContaining(sub, reqId);
    if (found) return found;
  }
  return null;
}

export function removeFromFolder(root: Folder, reqId: string): void {
  root.requestIds = root.requestIds.filter(id => id !== reqId);
  root.folders.forEach(sub => removeFromFolder(sub, reqId));
}

export function removeFolderById(parent: Folder, folderId: string): boolean {
  const idx = parent.folders.findIndex(f => f.id === folderId);
  if (idx !== -1) { parent.folders.splice(idx, 1); return true; }
  for (const sub of parent.folders) {
    if (removeFolderById(sub, folderId)) return true;
  }
  return false;
}

/** Returns the direct parent folder that contains the given folderId as a child. */
export function findFolderParent(root: Folder, folderId: string): Folder | null {
  for (const sub of root.folders) {
    if (sub.id === folderId) return root;
    const found = findFolderParent(sub, folderId);
    if (found) return found;
  }
  return null;
}

/** Returns the path of folders from root to the folder containing requestId, inclusive of the containing folder. */
export function findFolderPath(root: Folder, requestId: string): Folder[] {
  if (root.requestIds.includes(requestId)) return [root];
  for (const sub of root.folders) {
    const path = findFolderPath(sub, requestId);
    if (path.length > 0) return [root, ...path];
  }
  return [];
}

/** All request ids reachable from this folder, depth-first. */
export function collectRequestIds(f: Folder): string[] {
  return [...f.requestIds, ...f.folders.flatMap(collectRequestIds)];
}

/** Assign a fresh id to every folder in place and map every requestId through
 *  `mapRequestId` (the callback clones/moves the request data and returns the new id). */
export function reIdFolderTree(root: Folder, mapRequestId: (oldId: string) => string): void {
  root.id = uuidv4();
  root.requestIds = root.requestIds.map(mapRequestId);
  root.folders.forEach(sub => reIdFolderTree(sub, mapRequestId));
}

/** Deep-clone a folder tree, then re-ID folders and remap requestIds (see
 *  {@link reIdFolderTree}). Used by duplicate-folder / merge-collection. */
export function cloneAndReId(folder: Folder, mapRequestId: (oldId: string) => string): Folder {
  // JSON clone, NOT structuredClone: callers pass an immer draft (a Proxy), and
  // structuredClone throws DataCloneError on a Proxy. Folder data is plain JSON.
  const cloned: Folder = JSON.parse(JSON.stringify(folder));
  reIdFolderTree(cloned, mapRequestId);
  return cloned;
}

/** Merged folder-scope variables from `root` down to the folder containing
 *  `reqId`: outer first, inner overrides. `{}` when not found. */
export function collectFolderVars(root: Folder, reqId: string): Record<string, string> {
  const walk = (folder: Folder): Record<string, string> | null => {
    if ((folder.requestIds ?? []).includes(reqId)) return { ...(folder.variables ?? {}) };
    for (const sub of folder.folders ?? []) {
      const inner = walk(sub);
      if (inner) return { ...(folder.variables ?? {}), ...inner };
    }
    return null;
  };
  return walk(root) ?? {};
}
