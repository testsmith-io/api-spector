// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type {
  ApiRequest,
  AuthConfig,
  Collection,
  DataSet,
  Folder,
  KeyValuePair,
  RequestExample,
  ResponsePayload,
  TlsSettings,
} from '../../../../shared/types';
import { uniqueName, colRelPath } from '../../../../shared/naming-utils';
import {
  cloneAndReId,
  collectRequestIds,
  findFolder,
  findFolderContaining,
  findFolderParent,
  findFolderPath,
  reIdFolderTree,
  removeFolderById,
  removeFromFolder,
} from '../../../../shared/folder-tree';
import { makeTab, protocolFor } from './tabs-slice';
import type { FullState } from '../index';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(override: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: uuidv4(),
    name: 'New Request',
    method: 'GET',
    url: '',
    headers: [],
    params: [],
    auth: { type: 'none' },
    body: { mode: 'none' },
    ...override,
  };
}

function makeCollection(name: string): Collection {
  return {
    version: '1.0',
    id: uuidv4(),
    name,
    description: '',
    rootFolder: { id: uuidv4(), name: 'root', description: '', folders: [], requestIds: [] },
    requests: {},
  };
}

// ─── Slice ───────────────────────────────────────────────────────────────────

export interface CollectionsSliceState {
  collections: Record<string, { relPath: string; data: Collection; dirty: boolean }>
}

export interface CollectionsSliceActions {
  loadCollection: (relPath: string, data: Collection) => void
  markCollectionClean: (id: string) => void

  // Collection CRUD
  addCollection: (name: string) => void
  renameCollection: (id: string, name: string) => void
  deleteCollection: (id: string) => void

  duplicateCollection: (id: string) => void

  // Merge a folder tree (with its requests) into an existing collection,
  // preserving the source folder structure. Used by importers when the user
  // picks "merge into existing". Each folder and request is re-IDed to avoid
  // collisions.
  mergeIntoCollection: (
    collectionId: string,
    sourceFolder: Folder,
    sourceRequests: Record<string, ApiRequest>,
  ) => void

  // Folder CRUD
  addFolder: (collectionId: string, parentFolderId: string, name: string) => void
  renameFolder: (collectionId: string, folderId: string, name: string) => void
  deleteFolder: (collectionId: string, folderId: string) => void
  duplicateFolder: (collectionId: string, folderId: string) => void

  // Request CRUD
  addRequest: (collectionId: string, folderId: string) => string
  updateRequest: (id: string, patch: Partial<ApiRequest>) => void
  renameRequest: (id: string, name: string) => void
  deleteRequest: (collectionId: string, id: string) => void
  duplicateRequest: (collectionId: string, id: string) => void
  moveRequest: (srcCollectionId: string, requestId: string, destCollectionId: string, destFolderId: string, destIndex?: number) => void
  moveFolder: (collectionId: string, folderId: string, destParentFolderId: string, destIndex?: number) => void

  // Request examples (Postman/Bruno-style saved request/response snapshots)
  addExample: (requestId: string, snapshot: { name?: string; request?: Partial<ApiRequest>; response?: ResponsePayload | null }) => string | null
  /** Add an example seeded from the request's current payload (no response). */
  addExampleFromRequest: (requestId: string) => string | null
  updateExampleRequest: (requestId: string, exampleId: string, patch: Partial<ApiRequest>) => void
  updateExampleResponse: (requestId: string, exampleId: string, response: ResponsePayload | null) => void
  renameExample: (requestId: string, exampleId: string, name: string) => void
  deleteExample: (requestId: string, exampleId: string) => void
  duplicateExample: (requestId: string, exampleId: string) => void
  openExample: (requestId: string, collectionId: string, exampleId: string) => void

  // Tags
  updateFolderTags: (collectionId: string, folderId: string, tags: string[]) => void
  updateRequestTags: (requestId: string, tags: string[]) => void

  // Folder settings (auth & headers)
  updateFolder: (collectionId: string, folderId: string, patch: Partial<Folder>) => void

  // Inherited auth/headers selector
  getInheritedAuthAndHeaders: (requestId: string) => { auth: AuthConfig | null; headers: KeyValuePair[] }
  /** Merge the folder-chain variables for a request (root → immediate folder,
   *  inner folders override). Excludes collection/environment/local scopes. */
  getInheritedVariables: (requestId: string) => Record<string, string>

  // Collection dataset
  updateCollectionDataSet: (id: string, ds: DataSet) => void

  // Collection TLS
  updateCollectionTls: (id: string, tls: TlsSettings | undefined) => void
  updateCollectionAuthAndHeaders: (id: string, auth: AuthConfig, headers: KeyValuePair[]) => void
}

export type CollectionsSlice = CollectionsSliceState & CollectionsSliceActions

export const createCollectionsSlice: StateCreator<
  FullState,
  [['zustand/immer', never]],
  [],
  CollectionsSlice
> = (set, get) => ({
  collections: {},

  loadCollection: (relPath, data) => set(s => {
    // Ensure every request has required array/object fields — AI-generated
    // or hand-edited collections may omit them.
    for (const req of Object.values(data.requests)) {
      if (!req.headers) req.headers = [];
      if (!req.params) req.params = [];
      if (!req.body) req.body = { mode: 'none' };
      if (!req.auth) req.auth = { type: 'none' };
      // Migration: requests pre-dating the `soap` protocol value were
      // identified solely by body.mode. Lift them so the new request shell
      // (locked POST, WSDL-derived URL) kicks in automatically.
      if (!req.protocol && req.body.mode === 'soap') req.protocol = 'soap';
    }
    // Ensure every folder has required arrays
    function sanitizeFolder(f: Folder) {
      if (!f.folders) f.folders = [];
      if (!f.requestIds) f.requestIds = [];
      f.folders.forEach(sanitizeFolder);
    }
    sanitizeFolder(data.rootFolder);
    s.collections[data.id] = { relPath, data, dirty: false };
  }),

  markCollectionClean: (id) => set(s => {
    if (s.collections[id]) s.collections[id].dirty = false;
  }),

  // ── Collection CRUD ─────────────────────────────────────────────────────────
  addCollection: (name) => set(s => {
    const existingNames = Object.values(s.collections).map(c => c.data.name);
    const safeName = uniqueName(name, existingNames);
    const col = makeCollection(safeName);
    const relPath = colRelPath(safeName, col.id);
    s.collections[col.id] = { relPath, data: col, dirty: true };
    s.activeCollectionId = col.id;
    if (s.workspace) s.workspace.collections.push(relPath);
  }),

  renameCollection: (id, name) => set(s => {
    if (!s.collections[id]) return;
    const oldRelPath = s.collections[id].relPath;
    const newRelPath = colRelPath(name, id);
    s.collections[id].data.name = name;
    s.collections[id].relPath = newRelPath;
    s.collections[id].dirty = true;
    if (s.workspace && oldRelPath !== newRelPath) {
      s.workspace.collections = s.workspace.collections.map(p => p === oldRelPath ? newRelPath : p);
    }
  }),

  duplicateCollection: (id) => set(s => {
    const entry = s.collections[id];
    if (!entry) return;
    const orig = entry.data;
    const existingNames = Object.values(s.collections).map(c => c.data.name);
    const newName = uniqueName(orig.name + ' (copy)', existingNames);
    const newId   = uuidv4();

    // Deep-clone, then re-ID all requests and folders
    const copy: Collection = JSON.parse(JSON.stringify(orig));
    copy.id   = newId;
    copy.name = newName;

    const reqIdMap: Record<string, string> = {};
    Object.keys(copy.requests).forEach(oldReqId => {
      const newReqId = uuidv4();
      reqIdMap[oldReqId] = newReqId;
      copy.requests[newReqId] = { ...copy.requests[oldReqId], id: newReqId };
      delete copy.requests[oldReqId];
    });
    reIdFolderTree(copy.rootFolder, rid => reqIdMap[rid] ?? rid);

    const relPath = colRelPath(newName, newId);
    s.collections[newId] = { relPath, data: copy, dirty: true };
    s.activeCollectionId  = newId;
    if (s.workspace) s.workspace.collections.push(relPath);
  }),

  mergeIntoCollection: (collectionId, sourceFolder, sourceRequests) => set(s => {
    const entry = s.collections[collectionId];
    if (!entry) return;
    const col = entry.data;

    // Deep-clone, then re-ID every folder and request to avoid collisions.
    const cloned = cloneAndReId(sourceFolder, oldId => {
      const newId = uuidv4();
      const srcReq = sourceRequests[oldId];
      if (srcReq) col.requests[newId] = { ...srcReq, id: newId };
      return newId;
    });

    // Append each top-level subfolder of the cloned root into the target
    // collection's root. This preserves the section/tag grouping. If the
    // source root itself had direct requests (no subfolder), wrap them in
    // a folder named after the source root.
    if (cloned.folders.length > 0) {
      // Has subfolders — merge them individually so we don't create an
      // unnecessary wrapper.
      for (const sub of cloned.folders) {
        col.rootFolder.folders.push(sub);
      }
      // Also add any root-level requests (rare, but possible)
      if (cloned.requestIds.length > 0) {
        const wrapper: Folder = {
          id: uuidv4(),
          name: cloned.name || 'Imported',
          description: '',
          folders: [],
          requestIds: cloned.requestIds,
        };
        col.rootFolder.folders.push(wrapper);
      }
    } else {
      // No subfolders — the whole thing is one flat folder
      col.rootFolder.folders.push(cloned);
    }

    entry.dirty = true;
    s.activeCollectionId = collectionId;
  }),

  deleteCollection: (id) => {
    const relPath = get().collections[id]?.relPath;
    // Fire-and-forget the disk unlink — handler is idempotent so a missing
    // file isn't an error. Store mutation continues regardless so the UI
    // stays in sync even if the unlink fails.
    if (relPath) {
      window.electron.deleteWorkspaceFile(relPath).catch((err: unknown) => {
        console.warn('deleteCollection: could not remove file', relPath, err);
      });
    }
    set(s => {
      delete s.collections[id];
      if (s.workspace && relPath) {
        s.workspace.collections = s.workspace.collections.filter(p => p !== relPath);
      }
      // Close any tabs belonging to this collection
      s.tabs = s.tabs.filter(t => t.collectionId !== id);
      if (s.activeCollectionId === id) {
        s.activeCollectionId = Object.keys(s.collections)[0] ?? null;
        const activeTab = s.tabs.find(t => t.id === s.activeTabId);
        if (!activeTab) s.activeTabId = s.tabs[0]?.id ?? null;
      }
    });
  },

  updateCollectionDataSet: (id, ds) => set(s => {
    if (!s.collections[id]) return;
    s.collections[id].data.dataSet = ds;
    s.collections[id].dirty = true;
  }),

  updateCollectionTls: (id, tls) => set(s => {
    if (!s.collections[id]) return;
    s.collections[id].data.tls = tls;
    s.collections[id].dirty = true;
  }),

  updateCollectionAuthAndHeaders: (id, auth, headers) => set(s => {
    if (!s.collections[id]) return;
    s.collections[id].data.auth    = auth;
    s.collections[id].data.headers = headers;
    s.collections[id].dirty = true;
  }),

  // ── Folder CRUD ─────────────────────────────────────────────────────────────
  addFolder: (collectionId, parentFolderId, name) => set(s => {
    const col = s.collections[collectionId]?.data;
    if (!col) return;
    const parent = findFolder(col.rootFolder, parentFolderId);
    if (!parent) return;
    parent.folders.push({ id: uuidv4(), name, description: '', folders: [], requestIds: [] });
    s.collections[collectionId].dirty = true;
  }),

  renameFolder: (collectionId, folderId, name) => set(s => {
    const col = s.collections[collectionId]?.data;
    if (!col) return;
    const folder = findFolder(col.rootFolder, folderId);
    if (folder) { folder.name = name; s.collections[collectionId].dirty = true; }
  }),

  duplicateFolder: (collectionId, folderId) => set(s => {
    const col = s.collections[collectionId]?.data;
    if (!col) return;
    const orig = findFolder(col.rootFolder, folderId);
    if (!orig) return;

    // Deep-clone, re-ID all folders, and clone each request under a fresh id.
    const copy = cloneAndReId(orig, oldId => {
      const newId = uuidv4();
      col.requests[newId] = { ...JSON.parse(JSON.stringify(col.requests[oldId])), id: newId };
      return newId;
    });
    copy.name = orig.name + ' (copy)';

    // Insert after the original in its parent
    const parent = findFolderParent(col.rootFolder, folderId) ?? col.rootFolder;
    const idx = parent.folders.findIndex(f => f.id === folderId);
    parent.folders.splice(idx + 1, 0, copy);
    s.collections[collectionId].dirty = true;
  }),

  deleteFolder: (collectionId, folderId) => set(s => {
    const col = s.collections[collectionId]?.data;
    if (!col) return;
    const folder = findFolder(col.rootFolder, folderId);
    if (folder) {
      collectRequestIds(folder).forEach(rid => delete col.requests[rid]);
    }
    removeFolderById(col.rootFolder, folderId);
    s.collections[collectionId].dirty = true;
  }),

  // ── Request CRUD ────────────────────────────────────────────────────────────
  addRequest: (collectionId, folderId) => {
    const req = makeRequest();
    set(s => {
      const col = s.collections[collectionId]?.data;
      if (!col) return;
      col.requests[req.id] = req;
      const folder = findFolder(col.rootFolder, folderId) ?? col.rootFolder;
      folder.requestIds.push(req.id);
      s.activeCollectionId = collectionId;
      s.collections[collectionId].dirty = true;
      const tab = makeTab(req.id, collectionId);
      s.tabs.push(tab);
      s.activeTabId = tab.id;
    });
    return req.id;
  },

  updateRequest: (id, patch) => set(s => {
    const entry = Object.values(s.collections).find(c => c.data.requests[id]);
    if (!entry) return;
    Object.assign(entry.data.requests[id], patch);
    entry.dirty = true;
  }),

  // ── Request examples ────────────────────────────────────────────────────────
  addExample: (requestId, snapshot) => {
    const id = uuidv4();
    set(s => {
      const entry = Object.values(s.collections).find(c => c.data.requests[requestId]);
      if (!entry) return;
      const req = entry.data.requests[requestId];
      const list = req.examples ?? (req.examples = []);
      const example: RequestExample = {
        id,
        name: snapshot.name || uniqueName('Example', list.map(e => e.name)),
        request: snapshot.request,
        response: snapshot.response ?? null,
        createdAt: new Date().toISOString(),
        source: 'saved',
      };
      list.push(example);
      entry.dirty = true;
    });
    return id;
  },

  addExampleFromRequest: (requestId) => {
    // Snapshot from committed (non-draft) state so structuredClone can't hit an
    // Immer proxy; the example's payload starts as a copy of the request.
    const entry = Object.values(get().collections).find(c => c.data.requests[requestId]);
    if (!entry) return null;
    const req = entry.data.requests[requestId];
    const id = uuidv4();
    const example: RequestExample = {
      id,
      name: uniqueName('Example', (req.examples ?? []).map(e => e.name)),
      request: {
        method: req.method, url: req.url,
        headers: structuredClone(req.headers), params: structuredClone(req.params),
        auth: structuredClone(req.auth), body: structuredClone(req.body),
      },
      response: null,
      createdAt: new Date().toISOString(),
      source: 'saved',
    };
    set(s => {
      const e = Object.values(s.collections).find(c => c.data.requests[requestId]);
      if (!e) return;
      const r = e.data.requests[requestId];
      (r.examples ?? (r.examples = [])).push(example);
      e.dirty = true;
    });
    return id;
  },

  updateExampleRequest: (requestId, exampleId, patch) => set(s => {
    const entry = Object.values(s.collections).find(c => c.data.requests[requestId]);
    const ex = entry?.data.requests[requestId].examples?.find(e => e.id === exampleId);
    if (!entry || !ex) return;
    ex.request = { ...(ex.request ?? {}), ...patch };
    entry.dirty = true;
  }),

  updateExampleResponse: (requestId, exampleId, response) => set(s => {
    const entry = Object.values(s.collections).find(c => c.data.requests[requestId]);
    const ex = entry?.data.requests[requestId].examples?.find(e => e.id === exampleId);
    if (!entry || !ex) return;
    ex.response = response;
    entry.dirty = true;
  }),

  renameExample: (requestId, exampleId, name) => set(s => {
    const entry = Object.values(s.collections).find(c => c.data.requests[requestId]);
    const ex = entry?.data.requests[requestId].examples?.find(e => e.id === exampleId);
    if (!entry || !ex) return;
    ex.name = name;
    entry.dirty = true;
  }),

  deleteExample: (requestId, exampleId) => set(s => {
    const entry = Object.values(s.collections).find(c => c.data.requests[requestId]);
    const req = entry?.data.requests[requestId];
    if (!entry || !req?.examples) return;
    req.examples = req.examples.filter(e => e.id !== exampleId);
    entry.dirty = true;
    // Close any tab open on this example.
    const idx = s.tabs.findIndex(t => t.requestId === requestId && t.exampleId === exampleId);
    if (idx !== -1) {
      const wasActive = s.tabs[idx].id === s.activeTabId;
      s.tabs.splice(idx, 1);
      if (wasActive) s.activeTabId = (s.tabs[idx] ?? s.tabs[idx - 1] ?? null)?.id ?? null;
    }
  }),

  duplicateExample: (requestId, exampleId) => set(s => {
    const entry = Object.values(s.collections).find(c => c.data.requests[requestId]);
    const list = entry?.data.requests[requestId].examples;
    const ex = list?.find(e => e.id === exampleId);
    if (!entry || !list || !ex) return;
    list.push({
      ...structuredClone(ex),
      id: uuidv4(),
      name: uniqueName(ex.name, list.map(e => e.name)),
      createdAt: new Date().toISOString(),
    });
    entry.dirty = true;
  }),

  openExample: (requestId, collectionId, exampleId) => set(s => {
    const existing = s.tabs.find(t => t.requestId === requestId && t.exampleId === exampleId);
    if (existing) { s.activeTabId = existing.id; s.activeCollectionId = collectionId; return; }
    const ex = Object.values(s.collections).find(c => c.data.requests[requestId])
      ?.data.requests[requestId].examples?.find(e => e.id === exampleId);
    const tab = makeTab(requestId, collectionId, { protocol: protocolFor(s, requestId), exampleId });
    tab.lastResponse = ex?.response ?? null;
    s.tabs.push(tab);
    s.activeTabId = tab.id;
    s.activeCollectionId = collectionId;
  }),

  renameRequest: (id, name) => set(s => {
    const entry = Object.values(s.collections).find(c => c.data.requests[id]);
    if (!entry) return;
    entry.data.requests[id].name = name;
    entry.dirty = true;
  }),

  deleteRequest: (collectionId, id) => set(s => {
    const col = s.collections[collectionId]?.data;
    if (!col) return;
    delete col.requests[id];
    removeFromFolder(col.rootFolder, id);
    // Close any tab that had this request open
    const tabIdx = s.tabs.findIndex(t => t.requestId === id);
    if (tabIdx !== -1) {
      const wasActive = s.tabs[tabIdx].id === s.activeTabId;
      s.tabs.splice(tabIdx, 1);
      if (wasActive) {
        const next = s.tabs[tabIdx] ?? s.tabs[tabIdx - 1] ?? null;
        s.activeTabId = next?.id ?? null;
        s.activeCollectionId = next?.collectionId ?? null;
      }
    }
    s.collections[collectionId].dirty = true;
  }),

  duplicateRequest: (collectionId, id) => set(s => {
    const col = s.collections[collectionId]?.data;
    if (!col || !col.requests[id]) return;
    const orig = col.requests[id];
    const copy: ApiRequest = { ...JSON.parse(JSON.stringify(orig)), id: uuidv4(), name: orig.name + ' (copy)' };
    col.requests[copy.id] = copy;
    const folder = findFolderContaining(col.rootFolder, id);
    if (folder) {
      const idx = folder.requestIds.indexOf(id);
      folder.requestIds.splice(idx + 1, 0, copy.id);
    }
    s.collections[collectionId].dirty = true;
    // Open copy in a new tab — preserves protocol so SOAP duplicates land
    // on the SOAP panel directly.
    const tab = makeTab(copy.id, collectionId, { protocol: copy.protocol });
    s.tabs.push(tab);
    s.activeTabId = tab.id;
  }),

  moveRequest: (srcCollectionId, requestId, destCollectionId, destFolderId, destIndex?) => set(s => {
    const srcCol  = s.collections[srcCollectionId]?.data;
    const destCol = s.collections[destCollectionId]?.data;
    if (!srcCol || !destCol) return;
    const req = srcCol.requests[requestId];
    if (!req) return;

    // Remember source folder + index before removal (to adjust destIndex for same-folder moves)
    const srcFolder = findFolderContaining(srcCol.rootFolder, requestId);
    const srcIdx    = srcFolder ? srcFolder.requestIds.indexOf(requestId) : -1;

    // Remove from source folder
    removeFromFolder(srcCol.rootFolder, requestId);
    s.collections[srcCollectionId].dirty = true;

    if (srcCollectionId !== destCollectionId) {
      // Move request data to destination collection
      delete srcCol.requests[requestId];
      destCol.requests[requestId] = req;
      // Update any open tab's collectionId
      const tab = s.tabs.find(t => t.requestId === requestId);
      if (tab) tab.collectionId = destCollectionId;
    }

    const destFolder = findFolder(destCol.rootFolder, destFolderId);
    if (destFolder) {
      if (destIndex !== undefined) {
        // Adjust index when moving within the same folder: removal shifted everything down by 1
        let adjusted = destIndex;
        if (srcCollectionId === destCollectionId && srcFolder?.id === destFolder.id && srcIdx < destIndex) {
          adjusted--;
        }
        adjusted = Math.max(0, Math.min(adjusted, destFolder.requestIds.length));
        destFolder.requestIds.splice(adjusted, 0, requestId);
      } else {
        destFolder.requestIds.push(requestId);
      }
    }
    s.collections[destCollectionId].dirty = true;
  }),

  moveFolder: (collectionId, folderId, destParentFolderId, destIndex?) => set(s => {
    const col = s.collections[collectionId]?.data;
    if (!col) return;
    const folder = findFolder(col.rootFolder, folderId);
    if (!folder) return;
    // Prevent dropping a folder into itself or one of its own descendants
    if (folderId === destParentFolderId) return;
    if (findFolder(folder, destParentFolderId)) return;

    const srcParent = findFolderParent(col.rootFolder, folderId) ?? col.rootFolder;
    const srcIdx    = srcParent.folders.findIndex(f => f.id === folderId);

    // Remove from source
    srcParent.folders.splice(srcIdx, 1);

    // Insert into destination
    const destParent = findFolder(col.rootFolder, destParentFolderId);
    if (!destParent) return;
    if (destIndex !== undefined) {
      let adjusted = destIndex;
      if (srcParent.id === destParent.id && srcIdx < destIndex) adjusted--;
      adjusted = Math.max(0, Math.min(adjusted, destParent.folders.length));
      destParent.folders.splice(adjusted, 0, folder);
    } else {
      destParent.folders.push(folder);
    }
    s.collections[collectionId].dirty = true;
  }),

  // ── Tags ────────────────────────────────────────────────────────────────────
  updateFolderTags: (collectionId, folderId, tags) => set(s => {
    const col = s.collections[collectionId]?.data;
    if (!col) return;
    const folder = findFolder(col.rootFolder, folderId);
    if (folder) { folder.tags = tags; s.collections[collectionId].dirty = true; }
  }),

  updateRequestTags: (requestId, tags) => set(s => {
    const entry = Object.values(s.collections).find(c => c.data.requests[requestId]);
    if (!entry) return;
    const req = entry.data.requests[requestId];
    req.meta = { ...(req.meta ?? {}), tags };
    entry.dirty = true;
  }),

  // ── Folder settings ─────────────────────────────────────────────────────────
  updateFolder: (collectionId, folderId, patch) => set(s => {
    const col = s.collections[collectionId]?.data;
    if (!col) return;
    const folder = findFolder(col.rootFolder, folderId);
    if (folder) {
      Object.assign(folder, patch);
      s.collections[collectionId].dirty = true;
    }
  }),

  // ── Inherited auth/headers ──────────────────────────────────────────────────
  getInheritedAuthAndHeaders: (requestId) => {
    const state = get();
    const colEntry = Object.values(state.collections).find(c => c.data.requests[requestId]);
    if (!colEntry) return { auth: null, headers: [] };

    // Start with collection-level settings
    let inheritedAuth: AuthConfig | null =
      colEntry.data.auth && colEntry.data.auth.type !== 'none' ? colEntry.data.auth : null;
    let inheritedHeaders: KeyValuePair[] =
      colEntry.data.headers?.filter(h => h.enabled && h.key) ?? [];

    // Walk folder path (root → immediate folder); each level overrides the previous
    const path = findFolderPath(colEntry.data.rootFolder, requestId);
    for (const folder of path) {
      if (folder.auth && folder.auth.type !== 'none') inheritedAuth = folder.auth;
      if (folder.headers?.length) inheritedHeaders = [...inheritedHeaders, ...folder.headers];
    }
    return { auth: inheritedAuth, headers: inheritedHeaders };
  },

  getInheritedVariables: (requestId) => {
    const state = get();
    const colEntry = Object.values(state.collections).find(c => c.data.requests[requestId]);
    if (!colEntry) return {};
    const merged: Record<string, string> = {};
    // Root → immediate folder; each inner folder overrides the outer ones.
    for (const folder of findFolderPath(colEntry.data.rootFolder, requestId)) {
      if (folder.variables) Object.assign(merged, folder.variables);
    }
    return merged;
  },
});
