// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { Folder, Collection, ApiRequest, RunnerItem } from './types';

export type CollectedRequest = { request: ApiRequest; collectionVars: Record<string, string> }

// ─── Internal helpers ─────────────────────────────────────────────────────────

function findFolderById(root: Folder, id: string): Folder | null {
  if (root.id === id) return root;
  for (const sub of root.folders) {
    const found = findFolderById(sub, id);
    if (found) return found;
  }
  return null;
}

type ScopeWrapper = {
  scopeId: string
  ancestors: string[]
  before: ApiRequest[]
  after: ApiRequest[]
}

function makeHook(
  req: ApiRequest,
  collectionVars: Record<string, string>,
  hookType: RunnerItem['hookType'],
  scopeId: string,
  scopeAncestors: string[],
  mainRequestId?: string,
): RunnerItem {
  return { request: req, collectionVars, isHook: true, hookType, scopeId, scopeAncestors, mainRequestId };
}

/**
 * Recursively build a flat run plan for a folder, interleaving hook requests.
 *
 * Hooks are identified by request.hookType within each folder:
 *   beforeAll — runs once before any regular request in this folder/sub-folders
 *   before    — runs before every regular request in this folder/sub-folders
 *   after     — runs after every regular request (always)
 *   afterAll  — runs once after all regular requests complete (always)
 *
 * wrappers: accumulated before/after hooks from outer scopes (outermost first)
 */
function buildFolderPlan(
  folder: Folder,
  requests: Collection['requests'],
  collectionVars: Record<string, string>,
  filterTags: string[],
  scopeId: string,
  ancestorIds: string[],
  wrappers: ScopeWrapper[],
): RunnerItem[] {
  const result: RunnerItem[] = [];

  // Split this folder's requests into hook requests and regular requests
  const folderReqs = folder.requestIds.map(id => requests[id]).filter(Boolean) as ApiRequest[];
  const beforeAllHooks = folderReqs.filter(r => r.hookType === 'beforeAll');
  const beforeHooks    = folderReqs.filter(r => r.hookType === 'before');
  const afterHooks     = folderReqs.filter(r => r.hookType === 'after');
  const afterAllHooks  = folderReqs.filter(r => r.hookType === 'afterAll');
  const regularReqs    = folderReqs.filter(r => !r.hookType);

  // Build wrapper chain for this scope
  const myWrapper: ScopeWrapper = { scopeId, ancestors: ancestorIds, before: beforeHooks, after: afterHooks };
  const allWrappers = [...wrappers, myWrapper];

  // 1. beforeAll hooks for this scope
  for (const req of beforeAllHooks) {
    result.push(makeHook(req, collectionVars, 'beforeAll', scopeId, ancestorIds));
  }

  // 2. Regular requests in this folder (applying tag filter)
  for (const req of regularReqs) {
    const tags = req.meta?.tags ?? [];
    if (filterTags.length > 0 && !filterTags.some(t => tags.includes(t))) continue;

    // before hooks: outer → inner
    for (const w of allWrappers) {
      for (const hookReq of w.before) {
        result.push(makeHook(hookReq, collectionVars, 'before', w.scopeId, w.ancestors, req.id));
      }
    }
    // main request
    result.push({ request: req, collectionVars, scopeId, scopeAncestors: ancestorIds });
    // after hooks: inner → outer
    for (const w of [...allWrappers].reverse()) {
      for (const hookReq of w.after) {
        result.push(makeHook(hookReq, collectionVars, 'after', w.scopeId, w.ancestors, req.id));
      }
    }
  }

  // 3. Subfolders
  for (const sub of folder.folders) {
    const folderTags = sub.tags ?? [];
    const effectiveFilter = filterTags.length === 0
      ? filterTags
      : folderTags.some(t => filterTags.includes(t)) ? [] : filterTags;
    result.push(...buildFolderPlan(
      sub, requests, collectionVars, effectiveFilter,
      sub.id, [...ancestorIds, scopeId], allWrappers,
    ));
  }

  // 4. afterAll hooks for this scope (always runs)
  for (const req of afterAllHooks) {
    result.push(makeHook(req, collectionVars, 'afterAll', scopeId, ancestorIds));
  }

  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Recursively collect requests from a folder tree, optionally filtered by tags.
 * Hook requests (request.hookType set) are excluded — use buildRunPlan for runner use.
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
    if (!req || req.hookType) continue;
    const tags = req.meta?.tags ?? [];
    if (filterTags.length > 0 && !filterTags.some(t => tags.includes(t))) continue;
    results.push({ request: req, collectionVars });
  }

  for (const sub of folder.folders) {
    const folderTags = sub.tags ?? [];
    const effectiveTags = filterTags.length === 0
      ? filterTags
      : folderTags.some(t => filterTags.includes(t))
        ? []
        : filterTags;
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

/**
 * Find the path of folders from the root to (and including) the folder that
 * directly contains requestId. Returns [] if not found.
 */
function folderPathTo(root: Folder, requestId: string): Folder[] {
  if (root.requestIds.includes(requestId)) return [root];
  for (const sub of root.folders) {
    const path = folderPathTo(sub, requestId);
    if (path.length > 0) return [root, ...path];
  }
  return [];
}

/**
 * Return the hooks that should wrap a single request execution.
 * before: [outermost scope → innermost scope], beforeAll then before within each scope.
 * after:  [innermost scope → outermost scope], after then afterAll within each scope.
 */
export function getHooksForRequest(
  requestId: string,
  collection: Collection,
): { before: ApiRequest[]; after: ApiRequest[] } {
  const path = folderPathTo(collection.rootFolder, requestId);

  const before: ApiRequest[] = [];
  const afterReversed: ApiRequest[] = [];

  for (const folder of path) {
    const reqs     = folder.requestIds.map(id => collection.requests[id]).filter(Boolean) as ApiRequest[];
    const bAll     = reqs.filter(r => r.hookType === 'beforeAll');
    const bEach    = reqs.filter(r => r.hookType === 'before');
    const aEach    = reqs.filter(r => r.hookType === 'after');
    const aAll     = reqs.filter(r => r.hookType === 'afterAll');
    before.push(...bAll, ...bEach);
    afterReversed.push(...aEach, ...aAll);
  }

  return { before, after: afterReversed.reverse() };
}

/**
 * Build a flat RunnerItem list with hooks interleaved in the correct order.
 * Hooks are requests that have request.hookType set, scoped to their folder.
 */
export function buildRunPlan(
  collection: Collection,
  folderId: string | null,
  filterTags: string[],
): RunnerItem[] {
  const collectionVars = collection.collectionVariables ?? {};

  if (folderId) {
    const folder = findFolderById(collection.rootFolder, folderId);
    if (!folder) return [];
    return buildFolderPlan(folder, collection.requests, collectionVars, filterTags, folder.id, [], []);
  }

  // Whole collection: rootFolder acts as the top-level scope
  return buildFolderPlan(
    collection.rootFolder, collection.requests, collectionVars, filterTags,
    collection.rootFolder.id, [], [],
  );
}
