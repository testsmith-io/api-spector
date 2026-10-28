// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT
//
// Move a variable from one scope to another, anywhere variables can be defined:
// request, folder, collection, environment, globals. Reads the value at the
// source, refuses the move if the destination already has a same-named variable
// (block & warn), writes it to the destination, then removes the source copy.
// All mutations go through the normal store actions so they persist like any
// other edit.

import { useStore } from '../store';
import { findFolder } from '../../../shared/folder-tree';
import type { Folder } from '../../../shared/types';

export type VarScopeKind = 'request' | 'folder' | 'collection' | 'environment' | 'global';

/** A concrete place a variable lives — a scope kind plus the ids that pin it to
 *  one instance (none for globals). */
export interface VarLoc {
  kind: VarScopeKind
  collectionId?: string
  folderId?: string
  requestId?: string
  environmentId?: string
}

export const SCOPE_LABEL: Record<VarScopeKind, string> = {
  request: 'request', folder: 'folder', collection: 'collection', environment: 'environment', global: 'globals',
};

/** Scopes that have more than one instance (so a move needs the user to pick one). */
export const SCOPE_HAS_INSTANCES: Record<VarScopeKind, boolean> = {
  request: true, folder: true, collection: true, environment: true, global: false,
};

type State = ReturnType<typeof useStore.getState>;

function colOf(s: State, id?: string) { return id ? s.collections[id]?.data : undefined; }

/** Human label for an instance, e.g. "collection 'API'", "globals". */
export function describeLoc(loc: VarLoc): string {
  const s = useStore.getState();
  switch (loc.kind) {
    case 'global': return 'globals';
    case 'environment': return `environment "${s.environments[loc.environmentId ?? '']?.data.name ?? '?'}"`;
    case 'collection': return `collection "${colOf(s, loc.collectionId)?.name ?? '?'}"`;
    case 'folder': {
      const col = colOf(s, loc.collectionId);
      const f = col && loc.folderId ? findFolder(col.rootFolder, loc.folderId) : null;
      return `folder "${f?.name ?? '?'}"`;
    }
    case 'request': return `request "${colOf(s, loc.collectionId)?.requests[loc.requestId ?? '']?.name ?? '?'}"`;
  }
}

// ─── Read / exists ────────────────────────────────────────────────────────────

export function readVarAt(loc: VarLoc, key: string): string | undefined {
  const s = useStore.getState();
  switch (loc.kind) {
    case 'global': return s.globals[key];
    case 'environment': return s.environments[loc.environmentId ?? '']?.data.variables.find(v => v.key === key)?.value;
    case 'collection': return colOf(s, loc.collectionId)?.collectionVariables?.[key];
    case 'folder': {
      const col = colOf(s, loc.collectionId);
      const f = col && loc.folderId ? findFolder(col.rootFolder, loc.folderId) : null;
      return f?.variables?.[key];
    }
    case 'request': return colOf(s, loc.collectionId)?.requests[loc.requestId ?? '']?.variables?.[key];
  }
}

export function hasVarAt(loc: VarLoc, key: string): boolean {
  const s = useStore.getState();
  switch (loc.kind) {
    case 'global': return key in s.globals;
    case 'environment': return !!s.environments[loc.environmentId ?? '']?.data.variables.some(v => v.key === key);
    case 'collection': return !!colOf(s, loc.collectionId)?.collectionVariables && key in (colOf(s, loc.collectionId)!.collectionVariables ?? {});
    case 'folder': {
      const col = colOf(s, loc.collectionId);
      const f = col && loc.folderId ? findFolder(col.rootFolder, loc.folderId) : null;
      return !!f?.variables && key in f.variables;
    }
    case 'request': {
      const r = colOf(s, loc.collectionId)?.requests[loc.requestId ?? ''];
      return !!r?.variables && key in r.variables;
    }
  }
}

/** True when this variable is an encrypted environment secret — its stored value
 *  is ciphertext, so moving it to a plain scope would carry garbage. */
export function isEncryptedEnvSecret(loc: VarLoc, key: string): boolean {
  if (loc.kind !== 'environment') return false;
  const v = useStore.getState().environments[loc.environmentId ?? '']?.data.variables.find(x => x.key === key);
  return !!(v?.secret && v.secretEncrypted);
}

// ─── Mutate ───────────────────────────────────────────────────────────────────

function omit(map: Record<string, string> | undefined, key: string): Record<string, string> {
  const next = { ...(map ?? {}) };
  delete next[key];
  return next;
}

function addVarAt(loc: VarLoc, key: string, value: string): void {
  const s = useStore.getState();
  switch (loc.kind) {
    case 'global':
      { const next = { ...s.globals, [key]: value }; s.setGlobals(next); void window.electron.setGlobals(next); }
      break;
    case 'environment': {
      const env = s.environments[loc.environmentId ?? '']?.data;
      if (!env) return;
      s.updateEnvironment(env.id, { ...env, variables: [...env.variables, { key, value, enabled: true }] });
      break;
    }
    case 'collection': {
      const col = colOf(s, loc.collectionId);
      if (!col) return;
      s.updateCollectionVariables(col.id, { ...(col.collectionVariables ?? {}), [key]: value }, col.collectionVariablesDisabled);
      break;
    }
    case 'folder': {
      const col = colOf(s, loc.collectionId);
      const f = col && loc.folderId ? findFolder(col.rootFolder, loc.folderId) : null;
      if (!col || !f) return;
      s.updateFolder(col.id, f.id, { variables: { ...(f.variables ?? {}), [key]: value } });
      break;
    }
    case 'request': {
      const col = colOf(s, loc.collectionId);
      const r = col?.requests[loc.requestId ?? ''];
      if (!r) return;
      s.updateRequest(r.id, { variables: { ...(r.variables ?? {}), [key]: value } });
      break;
    }
  }
}

function removeVarAt(loc: VarLoc, key: string): void {
  const s = useStore.getState();
  switch (loc.kind) {
    case 'global':
      { const next = omit(s.globals, key); s.setGlobals(next); void window.electron.setGlobals(next); }
      break;
    case 'environment': {
      const env = s.environments[loc.environmentId ?? '']?.data;
      if (!env) return;
      s.updateEnvironment(env.id, { ...env, variables: env.variables.filter(v => v.key !== key) });
      break;
    }
    case 'collection': {
      const col = colOf(s, loc.collectionId);
      if (!col) return;
      s.updateCollectionVariables(col.id, omit(col.collectionVariables, key), omit(col.collectionVariablesDisabled, key));
      break;
    }
    case 'folder': {
      const col = colOf(s, loc.collectionId);
      const f = col && loc.folderId ? findFolder(col.rootFolder, loc.folderId) : null;
      if (!col || !f) return;
      s.updateFolder(col.id, f.id, { variables: omit(f.variables, key), variablesDisabled: omit(f.variablesDisabled, key) });
      break;
    }
    case 'request': {
      const col = colOf(s, loc.collectionId);
      const r = col?.requests[loc.requestId ?? ''];
      if (!r) return;
      s.updateRequest(r.id, { variables: omit(r.variables, key), variablesDisabled: omit(r.variablesDisabled, key) });
      break;
    }
  }
}

// ─── Move ───────────────────────────────────────────────────────────────────

export interface MoveResult { ok: boolean; error?: string }

/** Move `key` from `src` to `dst`. Blocks (no change) when the destination
 *  already defines the same name, or when moving an encrypted env secret. */
export function moveVariable(src: VarLoc, dst: VarLoc, key: string): MoveResult {
  if (src.kind === dst.kind && src.collectionId === dst.collectionId && src.folderId === dst.folderId
      && src.requestId === dst.requestId && src.environmentId === dst.environmentId) {
    return { ok: false, error: 'Source and destination are the same.' };
  }
  if (isEncryptedEnvSecret(src, key)) {
    return { ok: false, error: `"${key}" is an encrypted secret and can't be moved out of the environment.` };
  }
  if (hasVarAt(dst, key)) {
    return { ok: false, error: `"${key}" already exists in ${describeLoc(dst)}. Rename or remove it there first.` };
  }
  const value = readVarAt(src, key) ?? '';
  addVarAt(dst, key, value);
  removeVarAt(src, key);
  return { ok: true };
}

// ─── Instance enumeration (for the destination picker) ─────────────────────────

export interface ScopeInstance { loc: VarLoc; label: string }

function walkFolders(col: { id: string; name: string; rootFolder: Folder }, out: ScopeInstance[], f: Folder, path: string[]): void {
  for (const sub of f.folders ?? []) {
    const p = [...path, sub.name];
    out.push({ loc: { kind: 'folder', collectionId: col.id, folderId: sub.id }, label: `${col.name} / ${p.join(' / ')}` });
    walkFolders(col, out, sub, p);
  }
}

/** All instances of a scope kind the user can move a variable into, excluding the
 *  source instance. `global` yields a single entry. */
export function listScopeInstances(kind: VarScopeKind, exclude?: VarLoc): ScopeInstance[] {
  const s = useStore.getState();
  const out: ScopeInstance[] = [];
  switch (kind) {
    case 'global':
      out.push({ loc: { kind: 'global' }, label: 'globals' });
      break;
    case 'environment':
      for (const { data } of Object.values(s.environments)) out.push({ loc: { kind: 'environment', environmentId: data.id }, label: data.name });
      break;
    case 'collection':
      for (const { data } of Object.values(s.collections)) out.push({ loc: { kind: 'collection', collectionId: data.id }, label: data.name });
      break;
    case 'folder':
      for (const { data } of Object.values(s.collections)) walkFolders(data, out, data.rootFolder, []);
      break;
    case 'request':
      for (const { data } of Object.values(s.collections)) {
        for (const r of Object.values(data.requests)) out.push({ loc: { kind: 'request', collectionId: data.id, requestId: r.id }, label: `${data.name} / ${r.name}` });
      }
      break;
  }
  if (!exclude) return out;
  const sameLoc = (a: VarLoc) =>
    a.kind === exclude.kind && a.collectionId === exclude.collectionId && a.folderId === exclude.folderId
    && a.requestId === exclude.requestId && a.environmentId === exclude.environmentId;
  return out.filter(x => !sameLoc(x.loc));
}
