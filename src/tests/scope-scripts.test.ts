// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Collection/folder pre & post scripts wrap each request: pre runs outer->inner
// (collection, then root folder down to the request's folder) and post runs
// inner->outer. The request's own scripts are not part of this list.
import { describe, it, expect } from 'vitest';
import { resolveInheritedScripts } from '../shared/request-collection';
import type { Collection } from '../shared/types';

function collection(opts: {
  collectionPre?: string; collectionPost?: string;
  rootPre?: string; rootPost?: string;
  leafPre?: string; leafPost?: string;
}): Collection {
  return {
    version: '1.0', id: 'c', name: 'c',
    preRequestScript: opts.collectionPre,
    postRequestScript: opts.collectionPost,
    rootFolder: {
      id: 'root', name: 'root', description: '', requestIds: [],
      preRequestScript: opts.rootPre, postRequestScript: opts.rootPost,
      folders: [
        {
          id: 'leaf', name: 'Leaf', description: '', folders: [], requestIds: ['r1'],
          preRequestScript: opts.leafPre, postRequestScript: opts.leafPost,
        },
      ],
    },
    requests: { r1: { id: 'r1', name: 'r', method: 'GET', url: 'http://x', headers: [], params: [], body: { mode: 'none' } } },
  } as Collection;
}

describe('resolveInheritedScripts', () => {
  it('orders pre scripts collection -> root -> leaf', () => {
    const { pre } = resolveInheritedScripts('r1', collection({ collectionPre: 'C', rootPre: 'R', leafPre: 'L' }));
    expect(pre).toEqual(['C', 'R', 'L']);
  });

  it('orders post scripts leaf -> root -> collection', () => {
    const { post } = resolveInheritedScripts('r1', collection({ collectionPost: 'C', rootPost: 'R', leafPost: 'L' }));
    expect(post).toEqual(['L', 'R', 'C']);
  });

  it('skips blank / whitespace-only scripts', () => {
    const { pre, post } = resolveInheritedScripts('r1', collection({
      collectionPre: 'C', rootPre: '   ', leafPre: 'L',
      leafPost: '', collectionPost: 'CP',
    }));
    expect(pre).toEqual(['C', 'L']);
    expect(post).toEqual(['CP']);
  });

  it('returns empty arrays when nothing is set', () => {
    expect(resolveInheritedScripts('r1', collection({}))).toEqual({ pre: [], post: [] });
  });

  it('applies only collection-level scripts for a request not in any folder', () => {
    const { pre } = resolveInheritedScripts('nope', collection({ collectionPre: 'C', leafPre: 'L' }));
    expect(pre).toEqual(['C']);
  });
});
