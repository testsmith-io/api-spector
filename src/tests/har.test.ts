// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { historyToHar } from '../shared/har';
import type { HistoryEntry } from '../shared/types';

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'h1',
    timestamp: Date.parse('2026-07-18T10:00:00Z'),
    resolvedUrl: 'https://api.test/users?page=2&q=hello%20world',
    environmentName: 'staging',
    request: {
      id: 'r1', name: 'Get users', method: 'POST', url: 'https://api.test/users',
      headers: [
        { key: 'Accept', value: 'application/json', enabled: true },
        { key: 'X-Off', value: 'no', enabled: false },
      ],
      params: [], auth: { type: 'none' },
      body: { mode: 'json', json: '{"name":"Bob"}' },
    },
    response: {
      status: 201, statusText: 'Created',
      headers: { 'content-type': 'application/json', 'x-id': 'abc' },
      body: '{"id":7}', bodySize: 8, durationMs: 123,
    },
    ...over,
  };
}

describe('historyToHar', () => {
  it('produces a valid HAR 1.2 log with creator', () => {
    const har = JSON.parse(historyToHar([entry()], '2.0'));
    expect(har.log.version).toBe('1.2');
    expect(har.log.creator).toEqual({ name: 'API Spector', version: '2.0' });
    expect(har.log.entries).toHaveLength(1);
  });

  it('maps request: method, url, enabled headers, query string, body', () => {
    const { request } = JSON.parse(historyToHar([entry()])).log.entries[0];
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://api.test/users?page=2&q=hello%20world');
    expect(request.headers).toEqual([{ name: 'Accept', value: 'application/json' }]); // disabled dropped
    expect(request.queryString).toEqual([
      { name: 'page', value: '2' },
      { name: 'q', value: 'hello world' },  // url-decoded
    ]);
    expect(request.postData).toEqual({ mimeType: 'application/json', text: '{"name":"Bob"}' });
  });

  it('maps response: status, headers, content', () => {
    const { response, time, startedDateTime } = JSON.parse(historyToHar([entry()])).log.entries[0];
    expect(response.status).toBe(201);
    expect(response.content).toEqual({ size: 8, mimeType: 'application/json', text: '{"id":7}' });
    expect(response.headers).toContainEqual({ name: 'x-id', value: 'abc' });
    expect(time).toBe(123);
    expect(startedDateTime).toBe('2026-07-18T10:00:00.000Z');
  });

  it('omits postData for bodyless requests', () => {
    const { request } = JSON.parse(historyToHar([entry({
      request: { ...entry().request, method: 'GET', body: { mode: 'none' } },
    })])).log.entries[0];
    expect(request.postData).toBeUndefined();
    expect(request.bodySize).toBe(0);
  });

  it('encodes form bodies as urlencoded', () => {
    const { request } = JSON.parse(historyToHar([entry({
      request: { ...entry().request, body: { mode: 'form', form: [{ key: 'a', value: 'b c', enabled: true }] } },
    })])).log.entries[0];
    expect(request.postData).toEqual({ mimeType: 'application/x-www-form-urlencoded', text: 'a=b%20c' });
  });
});
