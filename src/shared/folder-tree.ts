// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Pure helpers for navigating and transforming a Collection's folder tree.
// No store, DOM, or Electron dependencies — safe to use from both the
// renderer and the main process.

import { v4 as uuidv4 } from 'uuid';
import type { Folder, ChildRef } from './types';

/** Effective, de-duplicated child order for a folder: honour `childOrder` for
 *  items that still exist, then append anything missing (requests first, then
 *  sub-folders). Stale entries in `childOrder` are ignored. This is the single
 *  source of truth for both tree rendering and run order. */
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

/**
 * Assign a fresh id to every folder in the tree (in place) and map every
 * requestId through `mapRequestId`. The callback is responsible for cloning /
 * moving the request data itself and returning the id to store in the tree.
 */
export function reIdFolderTree(root: Folder, mapRequestId: (oldId: string) => string): void {
  root.id = uuidv4();
  root.requestIds = root.requestIds.map(mapRequestId);
  root.folders.forEach(sub => reIdFolderTree(sub, mapRequestId));
}

/**
 * Deep-clone a folder tree, then re-ID every folder and remap every requestId
 * through `mapRequestId` (see {@link reIdFolderTree}). Shared by
 * duplicate-folder / merge-collection flows that must avoid id collisions.
 */
export function cloneAndReId(folder: Folder, mapRequestId: (oldId: string) => string): Folder {
  const cloned: Folder = JSON.parse(JSON.stringify(folder));
  reIdFolderTree(cloned, mapRequestId);
  return cloned;
}
