// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { resolveRequestLibraries } from '../main/library-files';
import { librariesInDir } from '../shared/libraries';
import type { Collection } from '../shared/types';

// Collection: root -> folder "F" -> request "req1".
const collection = {
  version: '1.0',
  id: 'col1',
  name: 'C',
  rootFolder: {
    id: 'root', name: 'root', folders: [
      { id: 'folderA', name: 'F', folders: [], requestIds: ['req1'] },
    ], requestIds: [],
  },
  requests: {
    req1: { id: 'req1', name: 'R', method: 'GET', url: '', headers: [], params: [], auth: { type: 'none' }, body: { mode: 'none' } },
  },
} as unknown as Collection;

describe('librariesInDir', () => {
  it('returns only the direct .ts children of a dir', () => {
    const contents = {
      'lib/a.ts': '1',
      'lib/b.ts': '2',
      'lib/collections/col1/c.ts': '3', // nested, excluded from lib/
      'lib/notes.md': 'x',               // non-ts, excluded
    };
    const names = librariesInDir(contents, 'lib').map(l => l.name).sort();
    expect(names).toEqual(['a', 'b']);
  });
});

describe('resolveRequestLibraries — scope precedence', () => {
  it('merges workspace + collection + folder, innermost wins', () => {
    const contents = {
      'lib/util.ts': 'export const from = () => "workspace";',
      'lib/wsonly.ts': 'export const x = 1;',
      'lib/collections/col1/util.ts': 'export const from = () => "collection";',
      'lib/folders/folderA/util.ts': 'export const from = () => "folder";',
      'lib/folders/folderA/fonly.ts': 'export const y = 2;',
    };
    const libs = resolveRequestLibraries(collection, 'req1', contents);
    const byName = Object.fromEntries(libs.map(l => [l.name, l.code]));
    expect(byName.util).toContain('folder');   // folder beats collection + workspace
    expect(byName.wsonly).toContain('x = 1');   // workspace-only survives
    expect(byName.fonly).toContain('y = 2');    // folder-only survives
  });

  it('falls back to workspace libraries for an unknown request', () => {
    const contents = { 'lib/g.ts': 'export const g = 1;' };
    const libs = resolveRequestLibraries(collection, 'does-not-exist', contents);
    // No collection/folder match, but the request is also not found, so only
    // workspace-scope libs are returned (the collection is still passed).
    expect(libs.map(l => l.name)).toContain('g');
  });

  it('returns nothing when there are no lib files', () => {
    expect(resolveRequestLibraries(collection, 'req1', {})).toEqual([]);
  });
});
