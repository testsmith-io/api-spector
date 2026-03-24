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

import type { Folder, Collection, ApiRequest } from './types';

export type CollectedRequest = { request: ApiRequest; collectionVars: Record<string, string> }

/**
 * Recursively collect requests from a folder tree, optionally filtered by tags.
 *
 * Folder-level tags are inherited: if a folder's tag matches the filter,
 * all requests inside it are included regardless of their own tags.
 */
export function collectTagged(
  folder: Folder,
  requests: Collection['requests'],
  collectionVars: Record<string, string>,
  filterTags: string[],
): CollectedRequest[] {
  const results: CollectedRequest[] = [];

  for (const reqId of folder.requestIds) {
    const req = requests[reqId];
    if (!req) continue;
    const tags = req.meta?.tags ?? [];
    if (filterTags.length > 0 && !filterTags.some(t => tags.includes(t))) continue;
    results.push({ request: req, collectionVars });
  }

  for (const sub of folder.folders) {
    // A folder's tags count as tags on all its children:
    // if the folder matches the filter, include all requests inside it.
    const folderTags = sub.tags ?? [];
    const effectiveTags = filterTags.length === 0
      ? filterTags
      : folderTags.some(t => filterTags.includes(t))
        ? []           // folder matches → include all requests inside
        : filterTags;   // apply request-level filter

    results.push(...collectTagged(sub, requests, collectionVars, effectiveTags));
  }

  return results;
}

/**
 * Collect all unique tags used across a folder tree (folders + requests).
 */
export function collectAllTags(folder: Folder, requests: Collection['requests']): string[] {
  const tags = new Set<string>();

  function walk(f: Folder) {
    ;(f.tags ?? []).forEach(t => tags.add(t));
    for (const reqId of f.requestIds) {
      ;(requests[reqId]?.meta?.tags ?? []).forEach(t => tags.add(t));
    }
    f.folders.forEach(walk);
  }

  walk(folder);
  return Array.from(tags).sort();
}
