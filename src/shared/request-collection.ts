// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { Folder, Collection, ApiRequest, RunnerItem, AuthConfig, KeyValuePair, DataSet } from './types';
import { findFolder, orderedChildren } from './folder-tree';

export type CollectedRequest = {
  request: ApiRequest
  collectionVars: Record<string, string>
  /** Folder names from below the root to the folder owning this request; for grouped CLI/report rendering. */
  scopePath?: string[]
}

// Internal helpers

/** Folder chain from `root` down to the folder with id `targetId`; [] if not found. */
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
  folderVars: Record<string, string>
  folderId: string
}

/** Non-disabled requests in a folder subtree, in childOrder, for running a folder
 *  as one hook body. Inner request hookTags ignored; the folder's hookType governs. */
function flattenFolderRequests(folder: Folder, requests: Collection['requests']): ApiRequest[] {
  const out: ApiRequest[] = [];
  for (const child of orderedChildren(folder)) {
    if (child.type === 'request') {
      const r = requests[child.id];
      if (r && !r.disabled) out.push(r);
    } else {
      const sub = folder.folders.find(f => f.id === child.id);
      if (sub && !sub.disabled) out.push(...flattenFolderRequests(sub, requests));
    }
  }
  return out;
}

function makeHook(
  req: ApiRequest,
  collectionVars: Record<string, string>,
  hookType: RunnerItem['hookType'],
  scopeId: string,
  scopeAncestors: string[],
  scopePath: string[],
  mainRequestId?: string,
  folderVars?: Record<string, string>,
  folderId?: string,
): RunnerItem {
  return { request: req, collectionVars, isHook: true, hookType, scopeId, scopeAncestors, scopePath, mainRequestId, folderVars, folderId };
}

/**
 * Flat run plan for a folder, hooks interleaved. request.hookType per folder:
 *   beforeAll - once before any regular request here/below
 *   before    - before every regular request here/below
 *   after     - after every regular request
 *   afterAll  - once after all regular requests
 * wrappers: before/after hooks from outer scopes (outermost first).
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
  /** True if this is the collection's top-level root scope - root name is omitted. */
  isRoot: boolean,
  /** Folder variables inherited from ancestor folders (root->leaf). */
  inheritedFolderVars: Record<string, string> = {},
): RunnerItem[] {
  const result: RunnerItem[] = [];
  // Folder vars for requests here: inherited chain plus this folder's own (inner wins).
  // Attached per item so scripts read `sp.folder` and writes land on this folder.
  const myFolderVars = { ...inheritedFolderVars, ...(folder.variables ?? {}) };
  const myFolderId = folder.id;
  // scopePath for requests owned by this folder: [] at root, else parentPath + folder name.
  const scopePath = isRoot ? [] : [...parentPath, folder.name];

  // This folder's direct, non-disabled requests (for regular-request lookup).
  const folderReqs = orderedChildren(folder)
    .filter(c => c.type === 'request')
    .map(c => requests[c.id])
    .filter(r => r && !r.disabled) as ApiRequest[];

  // Collect hook bodies in drag order so same-type hooks run top-to-bottom.
  // A hook is one request (request.hookType) or a whole sub-folder (folder.hookType)
  // run as a group, attributed to THIS scope not run inline. Disabled items excluded.
  const beforeAllHooks: ApiRequest[] = [];
  const beforeHooks:    ApiRequest[] = [];
  const afterHooks:     ApiRequest[] = [];
  const afterAllHooks:  ApiRequest[] = [];
  const hookFolderIds = new Set<string>();
  const pushHook = (ht: ApiRequest['hookType'], reqs: ApiRequest[]) => {
    if (ht === 'beforeAll')     beforeAllHooks.push(...reqs);
    else if (ht === 'before')   beforeHooks.push(...reqs);
    else if (ht === 'after')    afterHooks.push(...reqs);
    else if (ht === 'afterAll') afterAllHooks.push(...reqs);
  };
  for (const child of orderedChildren(folder)) {
    if (child.type === 'request') {
      const r = requests[child.id];
      if (r && !r.disabled && r.hookType) pushHook(r.hookType, [r]);
    } else {
      const sub = folder.folders.find(f => f.id === child.id);
      if (sub && !sub.disabled && sub.hookType) {
        hookFolderIds.add(sub.id);
        pushHook(sub.hookType, flattenFolderRequests(sub, requests));
      }
    }
  }
  const regularReqs = folderReqs.filter(r => !r.hookType);

  // Build wrapper chain for this scope
  const myWrapper: ScopeWrapper = { scopeId, ancestors: ancestorIds, scopePath, before: beforeHooks, after: afterHooks, folderVars: myFolderVars, folderId: myFolderId };
  const allWrappers = [...wrappers, myWrapper];

  // 1. beforeAll hooks for this scope
  for (const req of beforeAllHooks) {
    result.push(makeHook(req, collectionVars, 'beforeAll', scopeId, ancestorIds, scopePath, undefined, myFolderVars, myFolderId));
  }

  // 2 + 3. Regular requests and sub-folders interleaved in childOrder. Hooks excluded
  // here; emitted as beforeAll/afterAll or before/after wrappers per regular request.
  const regularById = new Map(regularReqs.map(r => [r.id, r] as const));
  const subById     = new Map(folder.folders.map(f => [f.id, f] as const));
  for (const child of orderedChildren(folder)) {
    if (child.type === 'request') {
      const req = regularById.get(child.id);
      if (!req) continue;
      const tags = req.meta?.tags ?? [];
      if (filterTags.length > 0 && !filterTags.some(t => tags.includes(t))) continue;

      // before hooks: outer -> inner
      for (const w of allWrappers) {
        for (const hookReq of w.before) {
          result.push(makeHook(hookReq, collectionVars, 'before', w.scopeId, w.ancestors, w.scopePath, req.id, w.folderVars, w.folderId));
        }
      }
      // main request
      result.push({ request: req, collectionVars, scopeId, scopeAncestors: ancestorIds, scopePath, folderVars: myFolderVars, folderId: myFolderId });
      // after hooks: inner -> outer
      for (const w of [...allWrappers].reverse()) {
        for (const hookReq of w.after) {
          result.push(makeHook(hookReq, collectionVars, 'after', w.scopeId, w.ancestors, w.scopePath, req.id, w.folderVars, w.folderId));
        }
      }
    } else {
      const sub = subById.get(child.id);
      if (!sub || sub.disabled) continue;   // disabled folders (and their subtree) are excluded
      if (hookFolderIds.has(sub.id)) continue;   // hook folders run in the before/after position, not inline
      const folderTags = sub.tags ?? [];
      const effectiveFilter = filterTags.length === 0
        ? filterTags
        : folderTags.some(t => filterTags.includes(t)) ? [] : filterTags;
      result.push(...buildFolderPlan(
        sub, requests, collectionVars, effectiveFilter,
        sub.id, [...ancestorIds, scopeId], scopePath, allWrappers, false, myFolderVars,
      ));
    }
  }

  // 4. afterAll hooks for this scope (always runs)
  for (const req of afterAllHooks) {
    result.push(makeHook(req, collectionVars, 'afterAll', scopeId, ancestorIds, scopePath, undefined, myFolderVars, myFolderId));
  }

  return result;
}

// Public API

/** Collect requests from a folder tree, optionally tag-filtered; hooks excluded
 *  (use buildRunPlan for the runner). scopePath is folder names below the root. */
export function collectTagged(
  folder: Folder,
  requests: Collection['requests'],
  collectionVars: Record<string, string>,
  filterTags: string[],
  parentPath: string[] = [],
  /** True on the first call when `folder` is the synthetic root; its name is kept out of scopePath. */
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

/** All unique tags across a folder tree (folders + requests). */
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
  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

/** Folder path from root to the folder directly containing requestId; [] if not found. */
function folderPathTo(root: Folder, requestId: string): Folder[] {
  if (root.requestIds.includes(requestId)) return [root];
  for (const sub of root.folders) {
    const path = folderPathTo(sub, requestId);
    if (path.length > 0) return [root, ...path];
  }
  return [];
}

/** Hook requests applicable to a folder (walk root down to it; ancestors wrap).
 *  Order: beforeAll/before outer->inner, after/afterAll inner->outer. */
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
  // after hooks fire inner -> outer
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

  afterReversed.reverse();
  return { before, after: afterReversed };
}

/** Inherited auth and headers for a request: walk collection -> root -> parent folder;
 *  each level can override auth (if non-'none') and append headers. */
/** Whether an auth config has a usable credential. `none`, or a blank credential like
 *  OpenAPI's empty bearer stub, does NOT override inherited auth; it inherits instead. */
/** Strip the session-only OAuth2 token cache (oauth2CachedToken/oauth2TokenExpiry)
 *  from an auth config in place; it must never reach the .spector file on disk. */
function stripEphemeralAuthFields(auth?: AuthConfig): void {
  if (auth?.type !== 'oauth2') return;
  delete auth.oauth2CachedToken;
  delete auth.oauth2TokenExpiry;
}

/** Remove session-only auth state (cached OAuth2 tokens at any level) before persisting.
 *  Mutates `col` in place, so callers pass a clone. */
export function stripEphemeralAuth(col: Collection): void {
  stripEphemeralAuthFields(col.auth);
  const walk = (f: Folder): void => {
    stripEphemeralAuthFields(f.auth);
    f.folders.forEach(walk);
  };
  walk(col.rootFolder);
  for (const req of Object.values(col.requests)) {
    stripEphemeralAuthFields(req.auth);
  }
}

export function authIsConfigured(auth?: AuthConfig): boolean {
  if (!auth || auth.type === 'none') return false;
  const set = (s?: string): boolean => !!(s?.trim());
  switch (auth.type) {
    case 'bearer': return set(auth.token) || set(auth.tokenSecretRef);
    case 'basic':
    case 'digest': return set(auth.username) || set(auth.password) || set(auth.passwordSecretRef);
    case 'ntlm':   return set(auth.username) || set(auth.password) || set(auth.passwordSecretRef);
    case 'apikey': return set(auth.apiKeyValue) || set(auth.apiKeySecretRef);
    case 'oauth2': return set(auth.oauth2TokenUrl) || set(auth.oauth2ClientId) || set(auth.oauth2CachedToken);
    default:       return true;
  }
}

export function resolveInheritedAuthAndHeaders(
  requestId: string,
  collection: Collection,
): { auth: AuthConfig | null; headers: KeyValuePair[] } {
  // Start with collection-level settings
  let inheritedAuth: AuthConfig | null =
    collection.auth && collection.auth.type !== 'none' ? collection.auth : null;
  let inheritedHeaders: KeyValuePair[] =
    collection.headers?.filter(h => h.enabled && h.key) ?? [];

  // Walk folder path (root -> immediate folder); each level can override
  const path = folderPathTo(collection.rootFolder, requestId);
  for (const folder of path) {
    if (folder.auth && folder.auth.type !== 'none') inheritedAuth = folder.auth;
    if (folder.headers?.length) {
      inheritedHeaders = [...inheritedHeaders, ...folder.headers.filter(h => h.enabled && h.key)];
    }
  }
  return { auth: inheritedAuth, headers: inheritedHeaders };
}

/** One header a request inherits, tagged with the level it comes from. */
export interface InheritedHeader {
  key: string
  value: string
  /** The collection or folder name the header is defined on. */
  source: string
}

/** Enabled headers a request inherits from collection + path folders, each tagged with
 *  its source, in send order (collection, then root->leaf) so the Headers tab mirrors it. */
export function inheritedHeadersWithSource(requestId: string, collection: Collection): InheritedHeader[] {
  const out: InheritedHeader[] = [];
  for (const h of collection.headers ?? []) {
    if (h.enabled && h.key) out.push({ key: h.key, value: h.value ?? '', source: collection.name });
  }
  for (const folder of folderPathTo(collection.rootFolder, requestId)) {
    for (const h of folder.headers ?? []) {
      if (h.enabled && h.key) out.push({ key: h.key, value: h.value ?? '', source: folder.name });
    }
  }
  return out;
}

/** Flat RunnerItem list with hooks (request.hookType, scoped to their folder) interleaved. */
export function buildRunPlan(
  collection: Collection,
  folderId: string | null,
  filterTags: string[],
): RunnerItem[] {
  const collectionVars = collection.collectionVariables ?? {};

  const tag = (items: RunnerItem[]) => items.map(i => ({ ...i, collection: collection.name }));

  // Whole-collection run
  if (!folderId) {
    return tag(buildFolderPlan(
      collection.rootFolder, collection.requests, collectionVars, filterTags,
      collection.rootFolder.id, [], [], [], true,
    ));
  }

  // Folder-scoped run. Ancestor hooks still fire: a collection-level beforeAll once
  // before the target, before/after wrap each request inside it, afterAll once at the end.
  const chain = folderChainTo(collection.rootFolder, folderId);
  if (chain.length === 0) return [];

  const targetFolder = chain[chain.length - 1];
  const ancestors    = chain.slice(0, -1);  // everything *above* the target

  const result: RunnerItem[] = [];
  const ancestorWrappers: ScopeWrapper[] = [];
  const ancestorIds: string[] = [];
  // Folder vars accumulate down the ancestor chain (outer -> inner), like buildFolderPlan.
  // Each wrapper snapshots its own so an ancestor's hooks resolve with that ancestor's vars.
  let ancestorFolderVars: Record<string, string> = {};

  // Walk root -> target's parent: emit each ancestor's beforeAll once, and
  // build a wrapper carrying its before/after hooks for nested requests.
  for (const f of ancestors) {
    ancestorFolderVars = { ...ancestorFolderVars, ...(f.variables ?? {}) };
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
      folderVars: ancestorFolderVars,
      folderId: f.id,
    });
    ancestorIds.push(f.id);
  }

  // Run the target folder as the new scopePath root, with the ancestor chain/wrappers.
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

  return tag(result);
}

/** Repeat a run plan once per DataSet row, tagging each copy with the row's values
 *  (dataRow) and a `1/N` label. No rows = plan returned unchanged. */
export function expandRunPlanWithData(items: RunnerItem[], ds: DataSet | undefined): RunnerItem[] {
  if (!ds || ds.rows.length === 0) return items;
  return ds.rows.flatMap((row, ri) => {
    const parsed = parseDataRow(ds.columns, row);
    // Merge onto any existing dataRow; this row's values win on key conflicts.
    return items.map(item => ({
      ...item,
      dataRow: { ...item.dataRow, ...parsed.dataRow },
      iterationLabel: `${ri + 1}/${ds.rows.length}`,
      ...(parsed.expectStatus ? { expectStatus: parsed.expectStatus } : {}),
      ...(parsed.owaspTag ? { owaspTag: parsed.owaspTag } : {}),
    }));
  });
}

// Data-table row parsing. Most columns become variables; reserved names build an
// OWASP matrix: expectStatus asserts the response code (403 or "403,404"), owasp
// tags the assertion so it flows into SARIF.
const RESERVED_STATUS = new Set(['expectstatus', 'expect_status', 'expectedstatus', 'expected_status']);
const RESERVED_OWASP  = new Set(['owasp', 'owasp_tag', 'category']);

export interface ParsedDataRow {
  dataRow: Record<string, string>
  expectStatus?: number[]
  owaspTag?: string
}

export function parseDataRow(columns: string[], row: string[]): ParsedDataRow {
  const dataRow: Record<string, string> = {};
  let expectStatus: number[] | undefined;
  let owaspTag: string | undefined;
  columns.forEach((col, ci) => {
    if (!col) return;
    const key = col.toLowerCase();
    const val = row[ci] ?? '';
    if (RESERVED_STATUS.has(key)) {
      const nums = val.split(/[\s,|]+/).map(x => Number.parseInt(x, 10)).filter(n => Number.isFinite(n));
      if (nums.length) expectStatus = nums;
    } else if (RESERVED_OWASP.has(key)) {
      if (val.trim()) owaspTag = val.trim().toUpperCase();
    } else {
      dataRow[col] = val;
    }
  });
  return { dataRow, expectStatus, owaspTag };
}

/** Nearest folder data table for a run item: own folder outward, first with rows.
 *  Collection-level data is applied separately by expandRunPlanWithData. */
function nearestFolderDataSet(item: RunnerItem, collection: Collection): DataSet | undefined {
  const chain = [item.scopeId, ...(item.scopeAncestors ?? [])].filter(Boolean) as string[];
  for (const id of chain) {
    const f = findFolder(collection.rootFolder, id);
    if (f?.dataSet && f.dataSet.rows.length > 0) return f.dataSet;
  }
  return undefined;
}

/** Each non-hook request repeated once per row of its nearest folder data table
 *  (inherited from ancestors). Hooks and tableless requests pass through unchanged. */
export function expandFolderDataSets(items: RunnerItem[], collection: Collection): RunnerItem[] {
  const out: RunnerItem[] = [];
  for (const item of items) {
    const ds = item.isHook ? undefined : nearestFolderDataSet(item, collection);
    if (!ds) { out.push(item); continue; }
    ds.rows.forEach((row, ri) => {
      const parsed = parseDataRow(ds.columns, row);
      out.push({
        ...item,
        dataRow: { ...item.dataRow, ...parsed.dataRow },
        iterationLabel: `${ri + 1}/${ds.rows.length}`,
        ...(parsed.expectStatus ? { expectStatus: parsed.expectStatus } : {}),
        ...(parsed.owaspTag ? { owaspTag: parsed.owaspTag } : {}),
      });
    });
  }
  return out;
}
