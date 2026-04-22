// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { Folder, Collection, ApiRequest, RunnerItem, AuthConfig, KeyValuePair } from './types';

export type CollectedRequest = {
  request: ApiRequest
  collectionVars: Record<string, string>
  /** Folder names from (just below) the root to the folder that owns this
   *  request. Used for grouped rendering in the CLI output and reports. */
  scopePath?: string[]
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Return the chain of folders from `root` down to (and including) the folder
 * with id `targetId`. Returns [] if not found.
 */
function folderChainTo(root: Folder, targetId: string): Folder[] {
  if (root.id === targetId) return [root];
  for (const sub of root.folders) {
    const chain = folderChainTo(sub, targetId);
    if (chain.length > 0) return [root, ...chain];
  }
  return [];
}

type ScopeWrapper = {
  scopeId: string
  ancestors: string[]
  scopePath: string[]
  before: ApiRequest[]
  after: ApiRequest[]
}

function makeHook(
  req: ApiRequest,
  collectionVars: Record<string, string>,
  hookType: RunnerItem['hookType'],
  scopeId: string,
  scopeAncestors: string[],
  scopePath: string[],
  mainRequestId?: string,
): RunnerItem {
  return { request: req, collectionVars, isHook: true, hookType, scopeId, scopeAncestors, scopePath, mainRequestId };
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
  /** Folder names from root (excluding the synthetic root) down to this folder's parent. */
  parentPath: string[],
  wrappers: ScopeWrapper[],
  /** True if this is the collection's top-level root scope — root name is omitted. */
  isRoot: boolean,
): RunnerItem[] {
  const result: RunnerItem[] = [];
  // scopePath is the path *for requests owned by this folder*. For the root
  // scope, that's [] (direct collection children have no folder). For any
  // other scope, it's the parent path + this folder's name.
  const scopePath = isRoot ? [] : [...parentPath, folder.name];

  // Split this folder's requests into hook requests and regular requests
  // Filter out disabled requests — they're excluded from all runs.
  const folderReqs = folder.requestIds.map(id => requests[id]).filter(r => r && !r.disabled) as ApiRequest[];
  const beforeAllHooks = folderReqs.filter(r => r.hookType === 'beforeAll');
  const beforeHooks    = folderReqs.filter(r => r.hookType === 'before');
  const afterHooks     = folderReqs.filter(r => r.hookType === 'after');
  const afterAllHooks  = folderReqs.filter(r => r.hookType === 'afterAll');
  const regularReqs    = folderReqs.filter(r => !r.hookType);

  // Build wrapper chain for this scope
  const myWrapper: ScopeWrapper = { scopeId, ancestors: ancestorIds, scopePath, before: beforeHooks, after: afterHooks };
  const allWrappers = [...wrappers, myWrapper];

  // 1. beforeAll hooks for this scope
  for (const req of beforeAllHooks) {
    result.push(makeHook(req, collectionVars, 'beforeAll', scopeId, ancestorIds, scopePath));
  }

  // 2. Regular requests in this folder (applying tag filter)
  for (const req of regularReqs) {
    const tags = req.meta?.tags ?? [];
    if (filterTags.length > 0 && !filterTags.some(t => tags.includes(t))) continue;

    // before hooks: outer → inner
    for (const w of allWrappers) {
      for (const hookReq of w.before) {
        result.push(makeHook(hookReq, collectionVars, 'before', w.scopeId, w.ancestors, w.scopePath, req.id));
      }
    }
    // main request
    result.push({ request: req, collectionVars, scopeId, scopeAncestors: ancestorIds, scopePath });
    // after hooks: inner → outer
    for (const w of [...allWrappers].reverse()) {
      for (const hookReq of w.after) {
        result.push(makeHook(hookReq, collectionVars, 'after', w.scopeId, w.ancestors, w.scopePath, req.id));
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
      sub.id, [...ancestorIds, scopeId], scopePath, allWrappers, false,
    ));
  }

  // 4. afterAll hooks for this scope (always runs)
  for (const req of afterAllHooks) {
    result.push(makeHook(req, collectionVars, 'afterAll', scopeId, ancestorIds, scopePath));
  }

  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Recursively collect requests from a folder tree, optionally filtered by tags.
 * Hook requests (request.hookType set) are excluded — use buildRunPlan for runner use.
 *
 * Each returned item carries a `scopePath` — folder names from (just below)
 * the synthetic root to the folder that owns the request. The root's own name
 * is suppressed unless the caller explicitly starts the walk inside a named
 * subfolder (in which case that folder's name becomes the first path entry).
 */
export function collectTagged(
  folder: Folder,
  requests: Collection['requests'],
  collectionVars: Record<string, string>,
  filterTags: string[],
  parentPath: string[] = [],
  /** True on the very first call if `folder` is the collection's synthetic
   *  root; its "root" name should not appear in scopePath. */
  isRoot = true,
): CollectedRequest[] {
  const results: CollectedRequest[] = [];
  const scopePath = isRoot ? parentPath : [...parentPath, folder.name];

  for (const reqId of folder.requestIds) {
    const req = requests[reqId];
    if (!req || req.hookType || req.disabled) continue;
    const tags = req.meta?.tags ?? [];
    if (filterTags.length > 0 && !filterTags.some(t => tags.includes(t))) continue;
    results.push({ request: req, collectionVars, scopePath });
  }

  for (const sub of folder.folders) {
    const folderTags = sub.tags ?? [];
    const effectiveTags = filterTags.length === 0
      ? filterTags
      : folderTags.some(t => filterTags.includes(t))
        ? []
        : filterTags;
    results.push(...collectTagged(sub, requests, collectionVars, effectiveTags, scopePath, false));
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
/**
 * Collect all hook requests applicable to a given folder, by walking from
 * the collection root down to (and including) that folder. Hooks defined at
 * any ancestor scope wrap requests in this folder.
 *
 * Returned in correct execution order:
 *   - beforeAll: outer → inner
 *   - before:    outer → inner
 *   - after:     inner → outer
 *   - afterAll:  inner → outer
 */
export function getAllApplicableHooks(
  folderId: string,
  collection: Collection,
): { beforeAll: ApiRequest[]; before: ApiRequest[]; after: ApiRequest[]; afterAll: ApiRequest[] } {
  // folderPathTo expects a request id; build a similar walk for folder ids
  function chainToFolder(root: Folder, targetId: string): Folder[] {
    if (root.id === targetId) return [root];
    for (const sub of root.folders) {
      const chain = chainToFolder(sub, targetId);
      if (chain.length) return [root, ...chain];
    }
    return [];
  }
  const chain = chainToFolder(collection.rootFolder, folderId);

  const beforeAll: ApiRequest[] = [];
  const before:    ApiRequest[] = [];
  const after:     ApiRequest[] = [];
  const afterAll:  ApiRequest[] = [];

  for (const folder of chain) {
    const reqs = folder.requestIds.map(id => collection.requests[id]).filter(r => r && !r.disabled) as ApiRequest[];
    beforeAll.push(...reqs.filter(r => r.hookType === 'beforeAll'));
    before   .push(...reqs.filter(r => r.hookType === 'before'));
  }
  // after hooks fire inner → outer
  for (const folder of [...chain].reverse()) {
    const reqs = folder.requestIds.map(id => collection.requests[id]).filter(r => r && !r.disabled) as ApiRequest[];
    after   .push(...reqs.filter(r => r.hookType === 'after'));
    afterAll.push(...reqs.filter(r => r.hookType === 'afterAll'));
  }
  return { beforeAll, before, after, afterAll };
}

export function getHooksForRequest(
  requestId: string,
  collection: Collection,
): { before: ApiRequest[]; after: ApiRequest[] } {
  const path = folderPathTo(collection.rootFolder, requestId);

  const before: ApiRequest[] = [];
  const afterReversed: ApiRequest[] = [];

  for (const folder of path) {
    const reqs     = folder.requestIds.map(id => collection.requests[id]).filter(r => r && !r.disabled) as ApiRequest[];
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
 * Resolve inherited auth and headers for a request by walking the collection →
 * root folder → … → immediate parent folder chain. Each level can override
 * auth (if non-'none') and append headers.
 *
 * This is the shared/main-process equivalent of the renderer's
 * `getInheritedAuthAndHeaders` store action.
 */
export function resolveInheritedAuthAndHeaders(
  requestId: string,
  collection: Collection,
): { auth: AuthConfig | null; headers: KeyValuePair[] } {
  // Start with collection-level settings
  let inheritedAuth: AuthConfig | null =
    collection.auth && collection.auth.type !== 'none' ? collection.auth : null;
  let inheritedHeaders: KeyValuePair[] =
    collection.headers?.filter(h => h.enabled && h.key) ?? [];

  // Walk folder path (root → immediate folder); each level can override
  const path = folderPathTo(collection.rootFolder, requestId);
  for (const folder of path) {
    if (folder.auth && folder.auth.type !== 'none') inheritedAuth = folder.auth;
    if (folder.headers?.length) {
      inheritedHeaders = [...inheritedHeaders, ...folder.headers.filter(h => h.enabled && h.key)];
    }
  }
  return { auth: inheritedAuth, headers: inheritedHeaders };
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

  // ── Whole-collection run ──────────────────────────────────────────────────
  if (!folderId) {
    return buildFolderPlan(
      collection.rootFolder, collection.requests, collectionVars, filterTags,
      collection.rootFolder.id, [], [], [], true,
    );
  }

  // ── Folder-scoped run ─────────────────────────────────────────────────────
  // Walk down from the collection root to the target folder. Hooks defined on
  // any ancestor (including root/"collection level") still need to fire — a
  // collection-level `beforeAll` should run once before the target's content,
  // collection-level `before`/`after` should wrap each request inside the
  // target, and collection-level `afterAll` should run once at the end.
  const chain = folderChainTo(collection.rootFolder, folderId);
  if (chain.length === 0) return [];

  const targetFolder = chain[chain.length - 1];
  const ancestors    = chain.slice(0, -1);  // everything *above* the target

  const result: RunnerItem[] = [];
  const ancestorWrappers: ScopeWrapper[] = [];
  const ancestorIds: string[] = [];

  // Walk root → target's parent: emit each ancestor's beforeAll once, and
  // build a wrapper carrying its before/after hooks for nested requests.
  for (const f of ancestors) {
    const reqs       = f.requestIds.map(id => collection.requests[id]).filter(r => r && !r.disabled) as ApiRequest[];
    const beforeAllH = reqs.filter(r => r.hookType === 'beforeAll');
    const beforeH    = reqs.filter(r => r.hookType === 'before');
    const afterH     = reqs.filter(r => r.hookType === 'after');

    for (const req of beforeAllH) {
      result.push(makeHook(req, collectionVars, 'beforeAll', f.id, [...ancestorIds], []));
    }
    ancestorWrappers.push({
      scopeId: f.id,
      ancestors: [...ancestorIds],
      scopePath: [],   // ancestor hooks render with no folder heading
      before: beforeH,
      after: afterH,
    });
    ancestorIds.push(f.id);
  }

  // Run the target folder as the new root for scopePath purposes, but with
  // the ancestor chain and wrappers we just built.
  result.push(...buildFolderPlan(
    targetFolder, collection.requests, collectionVars, filterTags,
    targetFolder.id, ancestorIds, [], ancestorWrappers, true,
  ));

  // Walk back up: emit each ancestor's afterAll, innermost first.
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const f          = ancestors[i];
    const reqs       = f.requestIds.map(id => collection.requests[id]).filter(r => r && !r.disabled) as ApiRequest[];
    const afterAllH  = reqs.filter(r => r.hookType === 'afterAll');
    const myAncestors = ancestorIds.slice(0, i);
    for (const req of afterAllH) {
      result.push(makeHook(req, collectionVars, 'afterAll', f.id, myAncestors, []));
    }
  }

  return result;
}
