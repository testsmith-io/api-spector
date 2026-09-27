// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { generateSecurityTests } from '../shared/security-tests';
import type { ApiRequest } from '../shared/types';

function req(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: 'r1', name: 'Get user', method: 'GET', url: 'https://api.example.com/users/42',
    headers: [{ key: 'Authorization', value: 'Bearer x', enabled: true }],
    params: [], auth: { type: 'bearer', token: 'x' }, body: { mode: 'none' },
    ...overrides,
  } as ApiRequest;
}

const tags = (rs: ApiRequest[]) => rs.map(r => r.name.match(/^\[([A-Z-]+)\]/)?.[1]);

describe('generateSecurityTests', () => {
  it('always produces auth + config tests, and BOLA for object-scoped URLs', () => {
    const out = generateSecurityTests(req());
    expect(tags(out)).toEqual(expect.arrayContaining(['AUTH', 'CONFIG', 'BOLA']));
    // missing-token test strips Authorization and uses no auth
    const missing = out.find(r => r.name.includes('missing token'))!;
    expect(missing.auth.type).toBe('none');
    expect(missing.headers.some(h => h.key.toLowerCase() === 'authorization')).toBe(false);
    // generated tests are real assertions
    expect(missing.postRequestScript).toContain('sp.test(');
  });

  it('adds mass-assignment for JSON writes and injection for query params', () => {
    const out = generateSecurityTests(req({
      method: 'POST', url: 'https://api.example.com/users',
      body: { mode: 'json', json: '{"name":"Al"}' },
      params: [{ key: 'search', value: 'al', enabled: true }],
    }));
    expect(tags(out)).toEqual(expect.arrayContaining(['MASS-ASSIGN', 'INJECTION']));
    const mass = out.find(r => r.name.includes('privileged'))!;
    expect(mass.body.json).toContain('"role"');
    const inj = out.find(r => r.name.startsWith('[INJECTION]'))!;
    expect(inj.params.find(p => p.key === 'search')?.value).toContain("' OR '1'='1");
  });

  it('gives every generated test a unique id', () => {
    const out = generateSecurityTests(req());
    const ids = new Set(out.map(r => r.id));
    expect(ids.size).toBe(out.length);
    expect(out.every(r => r.id !== 'r1')).toBe(true);
  });
});
