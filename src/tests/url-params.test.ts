// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { extractQueryParams, extractPathParamNames, syncParamsFromUrl } from '../shared/url-params';
import type { KeyValuePair } from '../shared/types';

const kv = (key: string, value: string, enabled = true): KeyValuePair => ({ key, value, enabled });
const pathKv = (key: string, value = ''): KeyValuePair => ({ key, value, enabled: true, paramType: 'path' });

describe('extractQueryParams', () => {
  it('leaves a URL with no query untouched', () => {
    const r = extractQueryParams('https://api.example.com/brands', []);
    expect(r.changed).toBe(false);
    expect(r.url).toBe('https://api.example.com/brands');
    expect(r.params).toEqual([]);
  });

  it('splits the query into params and strips it from the URL', () => {
    const r = extractQueryParams('https://api.example.com/products?page=2&sort=price', []);
    expect(r.changed).toBe(true);
    expect(r.url).toBe('https://api.example.com/products');
    expect(r.params).toEqual([kv('page', '2'), kv('sort', 'price')]);
  });

  it('decodes percent-encoded values', () => {
    const r = extractQueryParams('https://x.com/s?q=hello%20world&tag=a%26b', []);
    expect(r.params).toEqual([kv('q', 'hello world'), kv('tag', 'a&b')]);
  });

  it('handles a key with no value', () => {
    const r = extractQueryParams('https://x.com/s?debug&page=1', []);
    expect(r.params).toEqual([kv('debug', ''), kv('page', '1')]);
  });

  it('keeps {{var}} tokens intact', () => {
    const r = extractQueryParams('https://x.com/s?token={{apiKey}}', []);
    expect(r.params).toEqual([kv('token', '{{apiKey}}')]);
  });

  it('merges with existing params — pasted keys win, blank rows dropped', () => {
    const existing = [kv('page', '1'), kv('keep', 'yes'), kv('', '')];
    const r = extractQueryParams('https://x.com/s?page=5&new=z', existing);
    expect(r.params).toEqual([kv('keep', 'yes'), kv('page', '5'), kv('new', 'z')]);
  });

  it('preserves a trailing #fragment', () => {
    const r = extractQueryParams('https://x.com/s?a=1#section', []);
    expect(r.url).toBe('https://x.com/s#section');
    expect(r.params).toEqual([kv('a', '1')]);
  });

  it('strips a bare "?" with no params', () => {
    const r = extractQueryParams('https://x.com/s?', []);
    expect(r.url).toBe('https://x.com/s');
    expect(r.changed).toBe(true);
  });
});

describe('extractPathParamNames', () => {
  it('finds [name] placeholders, ignoring scheme and IPv6 host', () => {
    expect(extractPathParamNames('https://api.example.com/users/[id]/orders/[orderId]'))
      .toEqual(['id', 'orderId']);
    expect(extractPathParamNames('http://[::1]:8080/users/[id]')).toEqual(['id']);
  });

  it('de-duplicates repeated names', () => {
    expect(extractPathParamNames('/a/[id]/b/[id]')).toEqual(['id']);
  });
});

describe('syncParamsFromUrl', () => {
  it('adds a path-param row for each [name], keeping the URL text', () => {
    const r = syncParamsFromUrl('https://x.com/users/[id]/pets/[petId]', []);
    expect(r.url).toBe('https://x.com/users/[id]/pets/[petId]');
    expect(r.params).toEqual([pathKv('id'), pathKv('petId')]);
    expect(r.changed).toBe(true);
  });

  it('moves a query string to rows and adds path rows in one pass', () => {
    const r = syncParamsFromUrl('https://x.com/users/[id]?page=2', []);
    expect(r.url).toBe('https://x.com/users/[id]');
    expect(r.params).toEqual([kv('page', '2'), pathKv('id')]);
  });

  it('preserves a value already typed for a path param', () => {
    const r = syncParamsFromUrl('https://x.com/users/[id]', [pathKv('id', '42')]);
    expect(r.params).toEqual([pathKv('id', '42')]);
    expect(r.changed).toBe(false);
  });

  it('prunes an empty, now-unreferenced path row (rename [id] -> [userId])', () => {
    const r = syncParamsFromUrl('https://x.com/users/[userId]', [pathKv('id')]);
    expect(r.params).toEqual([pathKv('userId')]);
    expect(r.changed).toBe(true);
  });

  it('keeps a filled path row even when no longer referenced', () => {
    const r = syncParamsFromUrl('https://x.com/users', [pathKv('id', '42')]);
    expect(r.params).toEqual([pathKv('id', '42')]);
  });

  it('does not duplicate an existing path row', () => {
    const r = syncParamsFromUrl('https://x.com/users/[id]', [pathKv('id')]);
    expect(r.params).toEqual([pathKv('id')]);
    expect(r.changed).toBe(false);
  });
});
