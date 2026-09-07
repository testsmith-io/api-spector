// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { getByPath, joinPath, findPrimaryArray, tableColumns, sortRows, classify, cellPreview } from '../shared/response-table';

describe('getByPath / joinPath', () => {
  const data = { data: { items: [{ id: 1, tags: ['a', 'b'] }, { id: 2 }] } };
  it('reads dotted and indexed paths', () => {
    expect(getByPath(data, 'data.items[0].id')).toBe(1);
    expect(getByPath(data, 'data.items[0].tags[1]')).toBe('b');
    expect(getByPath(data, '')).toBe(data);
    expect(getByPath(data, 'data.missing.x')).toBeUndefined();
  });
  it('builds drill paths', () => {
    expect(joinPath('data.items', 2, 'tags')).toBe('data.items[2].tags');
    expect(joinPath('', 0)).toBe('[0]');
  });
});

describe('findPrimaryArray', () => {
  it('returns the root when it is an array', () => {
    expect(findPrimaryArray([1, 2, 3])).toEqual({ path: '', array: [1, 2, 3] });
  });
  it('prefers a data-ish key over other arrays', () => {
    const r = findPrimaryArray({ meta: { tags: [1, 2] }, data: [{ id: 1 }, { id: 2 }] });
    expect(r?.path).toBe('data');
    expect(r?.array).toHaveLength(2);
  });
  it('prefers arrays of objects, then size', () => {
    const r = findPrimaryArray({ a: [1, 2], b: [{ x: 1 }] });
    expect(r?.path).toBe('b');
  });
  it('returns null when there is no array', () => {
    expect(findPrimaryArray({ a: 1, b: { c: 2 } })).toBeNull();
  });
});

describe('tableColumns', () => {
  it('unions object keys in first-seen order', () => {
    expect(tableColumns([{ id: 1, name: 'a' }, { id: 2, price: 9 }])).toEqual(['id', 'name', 'price']);
  });
  it('is empty for primitive rows', () => {
    expect(tableColumns([1, 2, 3])).toEqual([]);
  });
});

describe('sortRows', () => {
  const rows = [{ n: '10' }, { n: '2' }, { n: '30' }];
  it('sorts numerically when cells are numeric', () => {
    expect(sortRows(rows, 'n', 'asc').map(r => r.n)).toEqual(['2', '10', '30']);
    expect(sortRows(rows, 'n', 'desc').map(r => r.n)).toEqual(['30', '10', '2']);
  });
  it('sorts strings and pushes nulls last', () => {
    const r = sortRows([{ s: 'b' }, { s: null }, { s: 'a' }], 's', 'asc');
    expect(r.map(x => x.s)).toEqual(['a', 'b', null]);
  });
  it('sorts primitive rows via the $value column', () => {
    expect(sortRows([3, 1, 2], '$value', 'asc')).toEqual([1, 2, 3]);
  });
});

describe('classify / cellPreview', () => {
  it('classifies values', () => {
    expect(classify(null)).toBe('null');
    expect(classify([1])).toBe('array');
    expect(classify({})).toBe('object');
    expect(classify('x')).toBe('primitive');
  });
  it('previews compactly', () => {
    expect(cellPreview([1, 2, 3])).toBe('[3]');
    expect(cellPreview(null)).toBe('');
    expect(cellPreview('hi')).toBe('hi');
    expect(cellPreview({ a: 1 })).toBe('{"a":1}');
  });
});
