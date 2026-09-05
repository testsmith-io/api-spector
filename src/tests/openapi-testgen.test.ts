// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { generateTests, sampleValue, testUrl } from '../shared/openapi-testgen';

const SPEC = {
  openapi: '3.0.0',
  info: { title: 'Users API', version: '1.0' },
  components: {
    schemas: {
      NewUser: {
        type: 'object',
        required: ['email', 'age'],
        properties: {
          email: { type: 'string', format: 'email' },
          age: { type: 'integer', minimum: 18, maximum: 120 },
          nickname: { type: 'string', maxLength: 10 },
        },
      },
      User: { type: 'object', properties: { id: { type: 'integer' }, email: { type: 'string' } } },
    },
  },
  paths: {
    '/users': {
      post: {
        operationId: 'createUser',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/NewUser' } } } },
        responses: {
          '201': { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          '400': {},
        },
      },
    },
    '/users/{id}': {
      get: {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } }, '404': {} },
      },
    },
  },
};

describe('sampleValue', () => {
  it('honours format, enum, and numeric bounds', () => {
    expect(sampleValue({ type: 'string', format: 'email' })).toBe('user@example.com');
    expect(sampleValue({ type: 'integer', minimum: 18 })).toBe(18);
    expect(sampleValue({ enum: ['a', 'b'] })).toBe('a');
  });
  it('builds an object with required properties', () => {
    const v = sampleValue({ type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } });
    expect(v).toEqual({ email: 'user@example.com' });
  });
});

describe('generateTests', () => {
  const tests = generateTests(SPEC);

  it('produces a happy-path test per operation with a response schema', () => {
    const happy = tests.filter(t => t.category === 'happy');
    expect(happy).toHaveLength(2);
    const post = happy.find(t => t.method === 'POST')!;
    expect(post.expectedStatus).toBe(201);
    expect(post.body).toContain('user@example.com');
    expect(post.responseSchema).toContain('"type"');   // dereferenced User schema
  });

  it('generates negative tests for missing required fields', () => {
    const names = tests.map(t => t.name);
    expect(names).toContain('POST /users - missing email');
    expect(names).toContain('POST /users - missing age');
    const missing = tests.find(t => t.name === 'POST /users - missing email')!;
    expect(missing.category).toBe('negative');
    expect(missing.expectedStatus).toBe(400);
    expect(JSON.parse(missing.body!).email).toBeUndefined();
  });

  it('generates boundary tests from numeric and string constraints', () => {
    const below = tests.find(t => t.name === 'POST /users - age below minimum')!;
    expect(below.category).toBe('boundary');
    expect(JSON.parse(below.body!).age).toBe(17);
    expect(tests.some(t => t.name === 'POST /users - nickname too long')).toBe(true);
  });

  it('can target only specific operations', () => {
    const only = generateTests(SPEC, { only: new Set(['GET /users/{id}']) });
    expect(only.every(t => t.path === '/users/{id}')).toBe(true);
    expect(only.some(t => t.category === 'happy')).toBe(true);
  });

  it('builds a resolvable URL with path params and query', () => {
    const get = generateTests(SPEC, { only: new Set(['GET /users/{id}']) }).find(t => t.category === 'happy')!;
    expect(testUrl(get)).toBe('{{baseUrl}}/users/1');
  });
});
