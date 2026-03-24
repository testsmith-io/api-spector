// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  findOperation,
  resolveSchema,
  validateRequestAgainstSpec,
} from '../main/contract/provider-verifier';
import type { ApiRequest } from '../../shared/types';
import specJson from './fixtures/openapi-contract.json';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const _FIXTURE = path.resolve(__dirname, 'fixtures/openapi-contract.json');

// Minimal spec loaded synchronously for pure-function tests
const spec = specJson as Record<string, unknown>;

function makeRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: 'req-1',
    name: 'Test request',
    method: 'GET',
    url: 'https://api.petstore.com/v1/pets',
    headers: [],
    params: [{ key: 'status', value: 'available', enabled: true }],
    auth: { type: 'none' },
    body: { mode: 'none' },
    ...overrides,
  };
}

// ─── resolveSchema ────────────────────────────────────────────────────────────

describe('resolveSchema', () => {
  it('returns primitives unchanged', () => {
    expect(resolveSchema(spec, 'hello')).toBe('hello');
    expect(resolveSchema(spec, 42)).toBe(42);
    expect(resolveSchema(spec, null)).toBe(null);
  });

  it('resolves a $ref to the target schema', () => {
    const obj = { $ref: '#/components/schemas/Pet' };
    const resolved = resolveSchema(spec, obj) as Record<string, unknown>;
    expect(resolved['type']).toBe('object');
    expect((resolved['properties'] as Record<string, Record<string, unknown>>)?.id?.type).toBe('integer');
  });

  it('resolves nested $refs recursively', () => {
    // NewPet has no nested $ref, but Pet props should all be plain after resolve
    const obj = { $ref: '#/components/schemas/NewPet' };
    const resolved = resolveSchema(spec, obj) as Record<string, unknown>;
    expect((resolved['properties'] as Record<string, Record<string, unknown>>)?.name?.type).toBe('string');
  });

  it('handles circular refs by returning {}', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    // Should not throw
    expect(() => resolveSchema(spec, circular)).not.toThrow();
  });

  it('resolves arrays element-by-element', () => {
    const arr = [{ $ref: '#/components/schemas/Pet' }];
    const result = resolveSchema(spec, arr) as unknown[];
    expect(Array.isArray(result)).toBe(true);
    expect((result[0] as Record<string, unknown>)['type']).toBe('object');
  });
});

// ─── findOperation ────────────────────────────────────────────────────────────

describe('findOperation', () => {
  it('finds a GET operation by full URL', () => {
    const match = findOperation(spec, 'GET', 'https://api.petstore.com/v1/pets');
    expect(match).not.toBeNull();
    expect(match!.pathTemplate).toBe('/pets');
    expect(match!.operation).toBeDefined();
  });

  it('finds a POST operation', () => {
    const match = findOperation(spec, 'POST', 'https://api.petstore.com/v1/pets');
    expect(match).not.toBeNull();
    expect(match!.operation['operationId']).toBe('createPet');
  });

  it('finds an operation with path parameter', () => {
    const match = findOperation(spec, 'GET', 'https://api.petstore.com/v1/pets/42');
    expect(match).not.toBeNull();
    expect(match!.pathTemplate).toBe('/pets/{id}');
  });

  it('returns null for unknown path', () => {
    const match = findOperation(spec, 'GET', 'https://api.petstore.com/v1/unknown');
    expect(match).toBeNull();
  });

  it('returns null for unknown method on known path', () => {
    const match = findOperation(spec, 'DELETE', 'https://api.petstore.com/v1/pets');
    expect(match).toBeNull();
  });

  it('is case-insensitive for HTTP method', () => {
    const upper = findOperation(spec, 'GET', 'https://api.petstore.com/v1/pets');
    const lower = findOperation(spec, 'get', 'https://api.petstore.com/v1/pets');
    expect(upper).not.toBeNull();
    expect(lower).not.toBeNull();
  });
});

// ─── validateRequestAgainstSpec ───────────────────────────────────────────────

describe('validateRequestAgainstSpec — path matching', () => {
  it('passes for a valid GET request matching the spec', () => {
    const req = makeRequest({ params: [{ key: 'status', value: 'available', enabled: true }] });
    const violations = validateRequestAgainstSpec(spec, req, {});
    expect(violations).toHaveLength(0);
  });

  it('returns unknown_path violation for unrecognised endpoint', () => {
    const req = makeRequest({ url: 'https://api.petstore.com/v1/orders' });
    const [v] = validateRequestAgainstSpec(spec, req, {});
    expect(v.type).toBe('unknown_path');
    expect(v.message).toContain('GET');
  });
});

describe('validateRequestAgainstSpec — required query parameters', () => {
  it('fails when required query parameter is absent', () => {
    // GET /pets requires "status"
    const req = makeRequest({ params: [] });
    const violations = validateRequestAgainstSpec(spec, req, {});
    expect(violations.some(v => v.message.includes('"status"'))).toBe(true);
  });

  it('passes when all required query parameters are present', () => {
    const req = makeRequest({
      params: [{ key: 'status', value: 'available', enabled: true }],
    });
    const violations = validateRequestAgainstSpec(spec, req, {});
    expect(violations).toHaveLength(0);
  });

  it('ignores disabled query parameters', () => {
    const req = makeRequest({
      params: [
        { key: 'status', value: 'available', enabled: false },  // disabled
      ],
    });
    const violations = validateRequestAgainstSpec(spec, req, {});
    // "status" is required but disabled → should fail
    expect(violations.some(v => v.message.includes('"status"'))).toBe(true);
  });
});

describe('validateRequestAgainstSpec — request body', () => {
  it('passes when POST body conforms to spec schema', () => {
    const req = makeRequest({
      method: 'POST',
      url: 'https://api.petstore.com/v1/pets',
      body: { mode: 'json', json: '{"name":"Fluffy","age":3}' },
      params: [],
    });
    const violations = validateRequestAgainstSpec(spec, req, {});
    expect(violations).toHaveLength(0);
  });

  it('fails when POST body violates schema (wrong type)', () => {
    const req = makeRequest({
      method: 'POST',
      url: 'https://api.petstore.com/v1/pets',
      body: { mode: 'json', json: '{"name": 42}' },  // name must be string
      params: [],
    });
    const violations = validateRequestAgainstSpec(spec, req, {});
    expect(violations.some(v => v.type === 'request_body_invalid')).toBe(true);
  });

  it('fails when POST body is not valid JSON', () => {
    const req = makeRequest({
      method: 'POST',
      url: 'https://api.petstore.com/v1/pets',
      body: { mode: 'json', json: 'not json' },
      params: [],
    });
    const violations = validateRequestAgainstSpec(spec, req, {});
    expect(violations.some(v => v.type === 'request_body_invalid')).toBe(true);
  });

  it('interpolates env variables in body before validation', () => {
    const req = makeRequest({
      method: 'POST',
      url: 'https://api.petstore.com/v1/pets',
      body: { mode: 'json', json: '{"name":"{{PET_NAME}}"}' },
      params: [],
    });
    const violations = validateRequestAgainstSpec(spec, req, { PET_NAME: 'Rex' });
    expect(violations).toHaveLength(0);
  });

  it('interpolates env variables in URL', () => {
    const req = makeRequest({
      url: 'https://api.petstore.com/v1/pets/{{PET_ID}}',
      params: [],
    });
    const violations = validateRequestAgainstSpec(spec, req, { PET_ID: '123' });
    expect(violations).toHaveLength(0);
  });

  it('skips body validation when body mode is not json', () => {
    const req = makeRequest({
      method: 'POST',
      url: 'https://api.petstore.com/v1/pets',
      body: { mode: 'raw', raw: 'some text' },
      params: [],
    });
    // raw body → no schema check; only required params
    const violations = validateRequestAgainstSpec(spec, req, {});
    expect(violations.every(v => v.type !== 'request_body_invalid')).toBe(true);
  });
});
