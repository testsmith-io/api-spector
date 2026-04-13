// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { describe, it, expect } from 'vitest';
import { buildRunPlan, collectTagged } from '../shared/request-collection';
import type { Collection, ApiRequest } from '../shared/types';

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
