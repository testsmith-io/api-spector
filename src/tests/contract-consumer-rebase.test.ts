// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { runConsumerContracts } from '../main/contract/consumer-verifier';
import type { ApiRequest } from '../shared/types';

// A design-first contract carries only a path (no host), matched by type — the
// same shape the Contract Designer emits. Consumer mode must be able to send it
// once a base URL is supplied, and fail with an actionable message without one.

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.startsWith('/brands')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{ id: '01M0', name: 'ForgeFlex Tools', slug: 'forgeflex-tools' }]));
      return;
    }
    res.writeHead(404).end('not found');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

/** A host-less design-first contract: bare path, matched by type. */
function brandsRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: 'r1', name: 'get all brands', method: 'GET', url: '/brands',
    headers: [], params: [], auth: { type: 'none' }, body: { mode: 'none' },
    contract: {
      statusCode: 200,
      bodyMatcher: JSON.stringify([{ id: { __match: 'type', value: 'x' }, name: { __match: 'type', value: 'x' }, slug: { __match: 'type', value: 'x' } }]),
    },
    ...overrides,
  };
}

describe('runConsumerContracts — base URL rebase', () => {
  it('rebases a host-less contract onto the provider base URL and validates the response', async () => {
    const report = await runConsumerContracts([brandsRequest()], {}, {}, baseUrl);
    expect(report.mode).toBe('consumer');
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.results[0].url).toContain(baseUrl);
  });

  it('fails with an actionable message when a host-less contract has no base URL', async () => {
    const report = await runConsumerContracts([brandsRequest()], {}, {});
    expect(report.failed).toBe(1);
    expect(report.results[0].violations[0].message).toMatch(/has no host/i);
  });

  it('sends a request that already carries a full URL unchanged (no base URL needed)', async () => {
    const req = brandsRequest({ url: `${baseUrl}/brands` });
    const report = await runConsumerContracts([req], {}, {});
    expect(report.passed).toBe(1);
    expect(report.results[0].url).toBe(`${baseUrl}/brands`);
  });
});
