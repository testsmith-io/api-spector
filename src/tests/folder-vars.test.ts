// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Folder-scoped variables: sp.folder in the script sandbox (read/write),
// mergeVars precedence, and the run plan attaching each item's folder vars +
// owning folder id (so a value one request sets is seen by its siblings).
import { describe, it, expect } from 'vitest';
import { runScript } from '../main/script-runner';
import { mergeVars } from '../main/interpolation';
import { buildRunPlan } from '../shared/request-collection';
import type { Collection, ApiRequest } from '../shared/types';

function req(id: string, name: string, extra: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id, name, method: 'GET', url: `https://example.com/${id}`,
    headers: [], params: [], auth: { type: 'none' }, body: { mode: 'none' }, ...extra,
  };
}

describe('sp.folder in the sandbox', () => {
  it('reads a folder variable', async () => {
    const r = await runScript('sp.variables.set("out", sp.folder.get("petId"))', {
      envVars: {}, collectionVars: {}, globals: {}, localVars: {}, folderVars: { petId: '42' },
    });
    expect(r.error).toBeUndefined();
    expect(r.updatedLocalVars.out).toBe('42');
  });

  it('writes a folder variable into updatedFolderVars', async () => {
    const r = await runScript('sp.folder.set("petId", "99")', {
      envVars: {}, collectionVars: {}, globals: {}, localVars: {}, folderVars: {},
    });
    expect(r.updatedFolderVars.petId).toBe('99');
  });

  it('clears a folder variable', async () => {
    const r = await runScript('sp.folder.clear("petId")', {
      envVars: {}, collectionVars: {}, globals: {}, localVars: {}, folderVars: { petId: '42' },
    });
    expect(r.updatedFolderVars.petId).toBeUndefined();
  });

  it('is an empty scope when no folder vars are provided (no throw)', async () => {
    const r = await runScript('sp.variables.set("out", String(sp.folder.get("x")))', {
      envVars: {}, collectionVars: {}, globals: {}, localVars: {},
    });
    expect(r.error).toBeUndefined();
    expect(r.updatedLocalVars.out).toBe('null');
  });
});

describe('mergeVars folder precedence', () => {
  it('folder overrides collection', () => {
    const vars = mergeVars({}, { k: 'collection' }, {}, {}, {}, { k: 'folder' });
    expect(vars.k).toBe('folder');
  });

  it('env and local override folder', () => {
    expect(mergeVars({ k: 'env' }, {}, {}, {}, {}, { k: 'folder' }).k).toBe('env');
    expect(mergeVars({}, {}, {}, { k: 'local' }, {}, { k: 'folder' }).k).toBe('local');
  });
});

describe('buildRunPlan attaches folder vars and owning folder id', () => {
  const collection: Collection = {
    version: '1.0', id: 'c1', name: 'Shop',
    rootFolder: {
      id: 'root', name: 'root', description: '',
      folders: [{
        id: 'f-pets', name: 'Pets', description: '',
        folders: [], requestIds: ['r-create', 'r-get'],
        variables: { species: 'dog' },
      }],
      requestIds: [],
    },
    requests: {
      'r-create': req('r-create', 'Create pet'),
      'r-get': req('r-get', 'Get pet'),
    },
  };

  it('gives each request in the folder its folder vars and folderId', () => {
    const plan = buildRunPlan(collection, null, []);
    const create = plan.find(i => i.request.id === 'r-create');
    const get = plan.find(i => i.request.id === 'r-get');
    expect(create?.folderId).toBe('f-pets');
    expect(get?.folderId).toBe('f-pets');
    expect(create?.folderVars).toEqual({ species: 'dog' });
    // Both siblings share the same owning folder, so a run accumulator keyed by
    // folderId lets a value Create sets reach Get.
    expect(create?.folderId).toBe(get?.folderId);
  });

  it('merges nested folder vars innermost-wins', () => {
    const nested: Collection = {
      ...collection,
      rootFolder: {
        id: 'root', name: 'root', description: '', requestIds: [],
        folders: [{
          id: 'f-outer', name: 'Outer', description: '', requestIds: [],
          variables: { a: '1', b: 'outer' },
          folders: [{
            id: 'f-inner', name: 'Inner', description: '', requestIds: ['r-x'],
            variables: { b: 'inner', c: '3' },
            folders: [],
          }],
        }],
      },
      requests: { 'r-x': req('r-x', 'X') },
    };
    const plan = buildRunPlan(nested, null, []);
    const x = plan.find(i => i.request.id === 'r-x');
    expect(x?.folderVars).toEqual({ a: '1', b: 'inner', c: '3' });
    expect(x?.folderId).toBe('f-inner');
  });
});
