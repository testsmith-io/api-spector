// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { inheritedHeadersWithSource } from '../shared/request-collection';
import type { Collection, ApiRequest } from '../shared/types';

const req = { id: 'r1', name: 'R', method: 'GET', url: '', headers: [], params: [], auth: { type: 'none' }, body: { mode: 'none' } } as unknown as ApiRequest;

const collection = {
  version: '1.0', id: 'c1', name: 'My API',
  headers: [
    { key: 'X-Collection', value: 'col', enabled: true },
    { key: 'X-Disabled', value: 'x', enabled: false },
    { key: '', value: 'noKey', enabled: true },
  ],
  rootFolder: {
    id: 'root', name: 'root', description: '', requestIds: [],
    folders: [{
      id: 'f1', name: 'Pets', description: '', folders: [], requestIds: ['r1'],
      headers: [{ key: 'X-Folder', value: 'fld', enabled: true }],
    }],
  },
  requests: { r1: req },
} as unknown as Collection;

describe('inheritedHeadersWithSource', () => {
  it('lists enabled headers from collection then folder, tagged with source', () => {
    expect(inheritedHeadersWithSource('r1', collection)).toEqual([
      { key: 'X-Collection', value: 'col', source: 'My API' },
      { key: 'X-Folder', value: 'fld', source: 'Pets' },
    ]);
  });

  it('skips disabled and keyless headers', () => {
    const keys = inheritedHeadersWithSource('r1', collection).map(h => h.key);
    expect(keys).not.toContain('X-Disabled');
    expect(keys).not.toContain('');
  });

  it('returns nothing when there is no inheritance', () => {
    const bare = { ...collection, headers: [], rootFolder: { ...collection.rootFolder, folders: [{ ...collection.rootFolder.folders[0], headers: [] }] } } as Collection;
    expect(inheritedHeadersWithSource('r1', bare)).toEqual([]);
  });
});
