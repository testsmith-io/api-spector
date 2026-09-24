// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { buildRunPlan, collectTagged, expandRunPlanWithData, expandFolderDataSets } from '../shared/request-collection';
import type { Collection, ApiRequest, RunnerItem, DataSet, Folder } from '../shared/types';

function req(id: string, name: string, extra: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id,
    name,
    method: 'GET',
    url: `https://example.com/${id}`,
    headers: [],
    params: [],
    auth: { type: 'none' },
    body: { mode: 'none' },
    ...extra,
  };
}

function makeNestedCollection(): Collection {
  return {
    version: '1.0',
    id: 'col-1',
    name: 'Nested',
    rootFolder: {
      id: 'root',
      name: 'root',
      description: '',
      folders: [
        {
          id: 'f-users',
          name: 'Users',
          description: '',
          folders: [
            {
              id: 'f-admin',
              name: 'Admin',
              description: '',
              folders: [],
              requestIds: ['r-adm'],
            },
          ],
          requestIds: ['r-users'],
        },
        {
          id: 'f-orders',
          name: 'Orders',
          description: '',
          folders: [],
          requestIds: ['r-orders'],
        },
      ],
      requestIds: ['r-root'],
    },
    requests: {
      'r-root':   req('r-root',   'Root-level request'),
      'r-users':  req('r-users',  'List users'),
      'r-adm':    req('r-adm',    'List admins'),
      'r-orders': req('r-orders', 'List orders'),
    },
  };
}

describe('collectTagged scopePath', () => {
  it('assigns empty scopePath to requests directly under the root', () => {
    const col = makeNestedCollection();
    const items = collectTagged(col.rootFolder, col.requests, {}, []);
    const root = items.find(i => i.request.id === 'r-root');
    expect(root?.scopePath).toEqual([]);
  });

  it('assigns a one-segment scopePath for direct subfolders', () => {
    const col = makeNestedCollection();
    const items = collectTagged(col.rootFolder, col.requests, {}, []);
    const users = items.find(i => i.request.id === 'r-users');
    expect(users?.scopePath).toEqual(['Users']);
  });

  it('assigns a multi-segment scopePath for nested subfolders', () => {
    const col = makeNestedCollection();
    const items = collectTagged(col.rootFolder, col.requests, {}, []);
    const admin = items.find(i => i.request.id === 'r-adm');
    expect(admin?.scopePath).toEqual(['Users', 'Admin']);
  });

  it('suppresses the synthetic root name from scopePath', () => {
    const col = makeNestedCollection();
    const items = collectTagged(col.rootFolder, col.requests, {}, []);
    for (const item of items) {
      expect(item.scopePath).not.toContain('root');
    }
  });
});

describe('buildRunPlan scopePath', () => {
  it('assigns scopePath to every regular request', () => {
    const col = makeNestedCollection();
    const plan = buildRunPlan(col, null, []);
    const byId = Object.fromEntries(plan.map(p => [p.request.id, p]));
    expect(byId['r-root']?.scopePath).toEqual([]);
    expect(byId['r-users']?.scopePath).toEqual(['Users']);
    expect(byId['r-adm']?.scopePath).toEqual(['Users', 'Admin']);
    expect(byId['r-orders']?.scopePath).toEqual(['Orders']);
  });

  it('folder-scoped run treats the starting folder as the top of the path', () => {
    const col = makeNestedCollection();
    const plan = buildRunPlan(col, 'f-users', []);
    const users = plan.find(p => p.request.id === 'r-users');
    const admin = plan.find(p => p.request.id === 'r-adm');
    // When you run the "Users" folder specifically, that folder becomes the
    // root of the run — its name is omitted, nested folders start from the
    // subfolder name.
    expect(users?.scopePath).toEqual([]);
    expect(admin?.scopePath).toEqual(['Admin']);
  });

  it('hooks inherit the scopePath of the folder they belong to', () => {
    const col: Collection = {
      version: '1.0',
      id: 'col-hooks',
      name: 'With hooks',
      rootFolder: {
        id: 'root',
        name: 'root',
        description: '',
        folders: [{
          id: 'f-users',
          name: 'Users',
          description: '',
          folders: [],
          requestIds: ['r-main', 'h-before'],
        }],
        requestIds: [],
      },
      requests: {
        'r-main':   req('r-main',   'List users'),
        'h-before': req('h-before', 'Set token', { hookType: 'before' }),
      },
    };
    const plan = buildRunPlan(col, null, []);
    // Both the before hook and the main request live in Users/
    for (const item of plan) {
      expect(item.scopePath).toEqual(['Users']);
    }
  });

  it('folder-scoped run fires collection-level (root) hooks', () => {
    // Root has every hook flavour; "Run Users folder" should fire all four
    // wrapping the single nested request.
    const col: Collection = {
      version: '1.0',
      id: 'col-root-hooks',
      name: 'Root hooks',
      rootFolder: {
        id: 'root',
        name: 'root',
        description: '',
        folders: [{
          id: 'f-users',
          name: 'Users',
          description: '',
          folders: [],
          requestIds: ['r-main'],
        }],
        requestIds: ['h-rba', 'h-rb', 'h-ra', 'h-raa'],
      },
      requests: {
        'h-rba':  req('h-rba',  'global setup',   { hookType: 'beforeAll' }),
        'h-rb':   req('h-rb',   'global before',  { hookType: 'before' }),
        'h-ra':   req('h-ra',   'global after',   { hookType: 'after' }),
        'h-raa':  req('h-raa',  'global teardown',{ hookType: 'afterAll' }),
        'r-main': req('r-main', 'list users'),
      },
    };

    const plan = buildRunPlan(col, 'f-users', []);
    const seq  = plan.map(p => p.isHook ? `[${p.hookType}] ${p.request.name}` : p.request.name);

    expect(seq).toEqual([
      '[beforeAll] global setup',
      '[before] global before',
      'list users',
      '[after] global after',
      '[afterAll] global teardown',
    ]);
  });

  it('folder-scoped run fires every ancestor scope in outer→inner order', () => {
    // root → Users → Admin, each with its own before/after; running Admin
    // should produce: root.before → Users.before → main → Users.after → root.after
    const col: Collection = {
      version: '1.0',
      id: 'col-nested-hooks',
      name: 'Nested',
      rootFolder: {
        id: 'root',
        name: 'root',
        description: '',
        folders: [{
          id: 'f-users',
          name: 'Users',
          description: '',
          folders: [{
            id: 'f-admin',
            name: 'Admin',
            description: '',
            folders: [],
            requestIds: ['r-main'],
          }],
          requestIds: ['h-ub', 'h-ua'],
        }],
        requestIds: ['h-rb', 'h-ra'],
      },
      requests: {
        'h-rb':   req('h-rb',  'root before',  { hookType: 'before' }),
        'h-ra':   req('h-ra',  'root after',   { hookType: 'after' }),
        'h-ub':   req('h-ub',  'users before', { hookType: 'before' }),
        'h-ua':   req('h-ua',  'users after',  { hookType: 'after' }),
        'r-main': req('r-main','list admins'),
      },
    };

    const plan = buildRunPlan(col, 'f-admin', []);
    const seq  = plan.map(p => p.isHook ? `[${p.hookType}] ${p.request.name}` : p.request.name);

    expect(seq).toEqual([
      '[before] root before',
      '[before] users before',
      'list admins',
      '[after] users after',
      '[after] root after',
    ]);
  });

  it('folder-scoped run still suppresses the target folder name from scopePath', () => {
    // Regression: previously, running a folder treated it as the new root and
    // its name was suppressed. Adding ancestor hooks shouldn't change that.
    const col: Collection = {
      version: '1.0', id: 'c', name: 'test',
      rootFolder: {
        id: 'root', name: 'root', description: '',
        folders: [{
          id: 'f-users', name: 'Users', description: '',
          folders: [], requestIds: ['r-main'],
        }],
        requestIds: ['h-rb'],
      },
      requests: {
        'h-rb':   req('h-rb',  'root before',  { hookType: 'before' }),
        'r-main': req('r-main','list users'),
      },
    };
    const plan = buildRunPlan(col, 'f-users', []);
    const main = plan.find(p => p.request.id === 'r-main');
    expect(main?.scopePath).toEqual([]);
  });
});

describe('expandRunPlanWithData (folder/collection data tables)', () => {
  const items = [
    { request: req('a', 'A') },
    { request: req('b', 'B') },
  ] as unknown as RunnerItem[];

  it('runs the plan once per data row (N rows × M requests)', () => {
    const ds: DataSet = { columns: ['email', 'name'], rows: [['a@x.io', 'Al'], ['b@x.io', 'Bo'], ['c@x.io', 'Cy']] };
    const out = expandRunPlanWithData(items, ds);
    expect(out).toHaveLength(6); // 3 rows × 2 requests
    expect(out.filter(i => i.iterationLabel === '1/3')).toHaveLength(2);
    expect(out[0].dataRow).toEqual({ email: 'a@x.io', name: 'Al' });
    expect(out[2].dataRow).toEqual({ email: 'b@x.io', name: 'Bo' });
  });

  it('returns the plan unchanged when there are no rows', () => {
    expect(expandRunPlanWithData(items, { columns: ['x'], rows: [] })).toBe(items);
    expect(expandRunPlanWithData(items, undefined)).toBe(items);
  });

  it('fills missing cells with empty strings and ignores blank column names', () => {
    const ds: DataSet = { columns: ['a', '', 'b'], rows: [['1']] };
    const out = expandRunPlanWithData(items, ds);
    expect(out[0].dataRow).toEqual({ a: '1', b: '' });
  });
});

describe('expandFolderDataSets (folder data tables in a collection run)', () => {
  const sub: Folder = { id: 'f1', name: 'F', folders: [], requestIds: [], dataSet: { columns: ['id'], rows: [['1'], ['2']] } };
  const root: Folder = { id: 'root', name: 'root', folders: [sub], requestIds: [] };
  const col = { version: '1.0', id: 'c', name: 'C', rootFolder: root, requests: {} } as unknown as Collection;
  const rows = [
    { request: req('a', 'A'), collectionVars: {}, scopeId: 'f1', scopeAncestors: ['root'] },
    { request: req('b', 'B'), collectionVars: {}, scopeId: 'root', scopeAncestors: [] },
    { request: req('h', 'H'), collectionVars: {}, scopeId: 'f1', scopeAncestors: ['root'], isHook: true, hookType: 'before' },
  ] as unknown as RunnerItem[];

  it("repeats a folder's requests once per its rows, others once", () => {
    const out = expandFolderDataSets(rows, col);
    expect(out).toHaveLength(4); // a×2 + b×1 + hook×1
    const a = out.filter(i => i.request.id === 'a');
    expect(a).toHaveLength(2);
    expect(a[0].dataRow).toEqual({ id: '1' });
    expect(a[1].dataRow).toEqual({ id: '2' });
    expect(out.filter(i => i.request.id === 'b')).toHaveLength(1); // root: no folder table
    expect(out.filter(i => i.request.id === 'h')).toHaveLength(1); // hooks not multiplied
  });
});

describe('buildRunPlan honours childOrder (interleaved requests + folders)', () => {
  it('runs children in the folder\'s explicit order', () => {
    const col = makeNestedCollection();
    // Put a folder before the root-level request, and reorder the folders.
    col.rootFolder.childOrder = [
      { type: 'folder', id: 'f-orders' },
      { type: 'request', id: 'r-root' },
      { type: 'folder', id: 'f-users' },
    ];
    const ids = buildRunPlan(col, null, []).filter(i => !i.isHook).map(i => i.request.id);
    expect(ids).toEqual(['r-orders', 'r-root', 'r-users', 'r-adm']);
  });

  it('falls back to requests-then-folders when childOrder is absent', () => {
    const col = makeNestedCollection();
    const ids = buildRunPlan(col, null, []).filter(i => !i.isHook).map(i => i.request.id);
    expect(ids).toEqual(['r-root', 'r-users', 'r-adm', 'r-orders']);
  });
});
