// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { rebaseUrl, runLiveProviderVerification } from '../main/contract/provider-live-verifier';
import type { ApiRequest } from '../shared/types';

describe('rebaseUrl', () => {
  it('swaps the origin but keeps path + query', () => {
    expect(rebaseUrl('https://api.example.com/pets/1?x=2', 'http://localhost:3000'))
      .toBe('http://localhost:3000/pets/1?x=2');
  });
  it('honours a base path prefix on the provider URL', () => {
    expect(rebaseUrl('https://api.example.com/pets', 'http://localhost:3000/api'))
      .toBe('http://localhost:3000/api/pets');
  });
  it('handles relative request URLs', () => {
    expect(rebaseUrl('/pets/1', 'http://localhost:3000')).toBe('http://localhost:3000/pets/1');
  });
  it('returns the URL unchanged when no provider base is given', () => {
    expect(rebaseUrl('https://api.example.com/pets')).toBe('https://api.example.com/pets');
  });
});

// ─── Live verification against a real ephemeral provider ──────────────────────

let server: http.Server;
let baseUrl: string;
const seededStates: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/_states' && req.method === 'POST') {
      let raw = '';
      req.on('data', c => (raw += c));
      req.on('end', () => {
        try { seededStates.push((JSON.parse(raw).state as string) + ':' + JSON.parse(raw).action); } catch { /* ignore */ }
        res.writeHead(200).end('{}');
      });
      return;
    }
    if (req.url?.startsWith('/pets/1')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 1, name: 'Fluffy' }));
      return;
    }
    res.writeHead(404).end('not found');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

function petRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: 'r1', name: 'get pet', method: 'GET', url: 'https://real-provider.com/pets/1',
    headers: [], params: [], auth: { type: 'none' }, body: { mode: 'none' },
    contract: {
      statusCode: 200,
      bodyMatcher: JSON.stringify({ id: { __match: 'integer', value: 1 }, name: { __match: 'type', value: 'x' } }),
    },
    ...overrides,
  };
}

describe('runLiveProviderVerification', () => {
  it('rebases onto the provider and validates the live response', async () => {
    const report = await runLiveProviderVerification([petRequest()], {}, {}, baseUrl);
    expect(report.mode).toBe('provider-live');
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.results[0].url).toContain(baseUrl);
  });

  it('fails when the live response violates the contract', async () => {
    const req = petRequest({ contract: { statusCode: 418 } }); // provider returns 200
    const report = await runLiveProviderVerification([req], {}, {}, baseUrl);
    expect(report.failed).toBe(1);
    expect(report.results[0].violations[0].type).toBe('status_mismatch');
  });

  it('seeds provider states via the state handler', async () => {
    seededStates.length = 0;
    const req = petRequest({ contract: { statusCode: 200, providerStates: ['pet 1 exists'] } });
    const report = await runLiveProviderVerification([req], {}, {}, baseUrl, `${baseUrl}/_states`);
    expect(report.passed).toBe(1);
    expect(seededStates).toContain('pet 1 exists:setup');
    expect(seededStates).toContain('pet 1 exists:teardown');
  });

  it('reports a provider_state_failed violation when a state is required but no handler is configured', async () => {
    const req = petRequest({ contract: { statusCode: 200, providerStates: ['pet 1 exists'] } });
    const report = await runLiveProviderVerification([req], {}, {}, baseUrl); // no states URL
    expect(report.failed).toBe(1);
    expect(report.results[0].violations[0].type).toBe('provider_state_failed');
  });
});
