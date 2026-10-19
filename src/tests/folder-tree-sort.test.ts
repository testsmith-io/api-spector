// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// sortChildOrder sorts a folder's direct children (requests + sub-folders,
// interleaved) alphabetically by display name, case-insensitive and numeric
// aware.
import { describe, it, expect } from 'vitest';
import { sortChildOrder } from '../shared/folder-tree';
import type { Folder } from '../shared/types';

function folder(name: string, id = name): Folder {
  return { id, name, folders: [], requestIds: [] };
}

describe('sortChildOrder', () => {
  const names: Record<string, string> = {
    r1: 'banana', r2: 'Apple', r3: 'cherry',
  };
  const requestName = (id: string) => names[id] ?? '';

  it('interleaves folders and requests sorted by name (case insensitive)', () => {
    const f: Folder = {
      ...folder('root'),
      folders: [folder('Zebra', 'fz'), folder('mango', 'fm')],
      requestIds: ['r1', 'r2', 'r3'],
    };
    const order = sortChildOrder(f, requestName);
    // Apple(r2), banana(r1), cherry(r3), mango(fm), Zebra(fz)
    expect(order).toEqual([
      { type: 'request', id: 'r2' },
      { type: 'request', id: 'r1' },
      { type: 'request', id: 'r3' },
      { type: 'folder', id: 'fm' },
      { type: 'folder', id: 'fz' },
    ]);
  });

  it('does not force folders above or below requests', () => {
    const f: Folder = {
      ...folder('root'),
      folders: [folder('beta', 'fb')],
      requestIds: ['r2'], // "Apple"
    };
    // Apple(request) sorts before beta(folder): a request can lead.
    const order = sortChildOrder(f, requestName);
    expect(order[0]).toEqual({ type: 'request', id: 'r2' });
    expect(order[1]).toEqual({ type: 'folder', id: 'fb' });
  });

  it('sorts numbers naturally (2 before 10)', () => {
    const nn: Record<string, string> = { a: 'item 2', b: 'item 10', c: 'item 1' };
    const f: Folder = { ...folder('root'), requestIds: ['a', 'b', 'c'] };
    const order = sortChildOrder(f, id => nn[id] ?? '');
    expect(order.map(o => o.id)).toEqual(['c', 'a', 'b']);
  });
});
