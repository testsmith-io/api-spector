// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { harToCollection } from '../main/importers/har';
import type { ApiRequest } from '../shared/types';

function entry(method: string, url: string, extra: Record<string, unknown> = {}) {
  return {
    request: { method, url, headers: [], ...((extra.request as object) ?? {}) },
    response: { content: { mimeType: 'application/json' }, ...((extra.response as object) ?? {}) },
    ...extra,
  };
}

const har = {
  log: {
    entries: [
      // API calls (kept)
      entry('GET', 'https://api.example.com/users', { _resourceType: 'fetch' }),
      entry('POST', 'https://api.example.com/users', {
        _resourceType: 'xhr',
        request: {
          method: 'POST', url: 'https://api.example.com/users',
          headers: [
            { name: 'content-type', value: 'application/json' },
            { name: 'authorization', value: 'Bearer t0ken' },
            { name: 'cookie', value: 'session=secret' },
            { name: ':authority', value: 'api.example.com' },
            { name: 'content-length', value: '12' },
          ],
          postData: { mimeType: 'application/json', text: '{"name":"Ada"}' },
        },
      }),
      // Duplicate of the first GET (collapsed)
      entry('GET', 'https://api.example.com/users', { _resourceType: 'fetch' }),
      // Second host (kept, grouped separately)
      entry('GET', 'https://cdn.api.io/v1/config', { _resourceType: 'fetch' }),
      // Static assets (dropped)
      entry('GET', 'https://example.com/app.js', { _resourceType: 'script' }),
      entry('GET', 'https://example.com/logo.png', { response: { content: { mimeType: 'image/png' } } }),
      entry('GET', 'https://example.com/styles.css', { response: { content: { mimeType: 'text/css' } } }),
    ],
  },
};

describe('harToCollection', () => {
  const col = harToCollection(har, 'capture');
  const reqs = Object.values(col.requests) as ApiRequest[];

  it('keeps only API-like calls, deduped', () => {
    // 2 unique example.com calls + 1 cdn.api.io = 3; assets and the duplicate dropped.
    expect(reqs).toHaveLength(3);
    expect(reqs.map(r => `${r.method} ${r.url}`).sort()).toEqual([
      'GET https://api.example.com/users',
      'GET https://cdn.api.io/v1/config',
      'POST https://api.example.com/users',
    ]);
  });

  it('groups multiple hosts into folders', () => {
    expect(col.name).toBe('capture');
    expect(col.rootFolder.folders.map(f => f.name).sort()).toEqual(['api.example.com', 'cdn.api.io']);
  });

  it('maps the JSON body and keeps useful headers, dropping cookies and auto headers', () => {
    const post = reqs.find(r => r.method === 'POST')!;
    expect(post.body.mode).toBe('json');
    expect(post.body.json).toBe('{"name":"Ada"}');
    const headerKeys = post.headers.map(h => h.key.toLowerCase());
    expect(headerKeys).toContain('authorization');
    expect(headerKeys).toContain('content-type');
    expect(headerKeys).not.toContain('cookie');
    expect(headerKeys).not.toContain('content-length');
    expect(headerKeys.some(k => k.startsWith(':'))).toBe(false);
  });

  it('names a request from its method and path', () => {
    expect(reqs.find(r => r.method === 'POST')!.name).toBe('POST /users');
  });

  it('a single-host HAR collapses to a flat list', () => {
    const flat = harToCollection({ log: { entries: [entry('GET', 'https://only.example/a', { _resourceType: 'fetch' })] } }, 'one');
    expect(flat.rootFolder.folders).toHaveLength(0);
    expect(flat.rootFolder.requestIds).toHaveLength(1);
  });

  it('rejects a non-HAR object', () => {
    expect(() => harToCollection({} as never, 'x')).toThrow(/HAR/);
  });
});
