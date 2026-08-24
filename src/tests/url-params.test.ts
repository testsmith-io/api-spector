// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { extractQueryParams } from '../shared/url-params';
import type { KeyValuePair } from '../shared/types';

const kv = (key: string, value: string, enabled = true): KeyValuePair => ({ key, value, enabled });

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
