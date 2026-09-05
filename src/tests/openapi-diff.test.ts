// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { diffSpecs, summarizeDiff } from '../shared/openapi-diff';

function spec(paths: any) {
  return { openapi: '3.0.0', info: { title: 'API', version: '1' }, paths };
}

describe('diffSpecs', () => {
  it('flags a removed operation as breaking and an added one as non-breaking', () => {
    const oldS = spec({ '/a': { get: { responses: { '200': {} } } }, '/b': { get: { responses: { '200': {} } } } });
    const newS = spec({ '/a': { get: { responses: { '200': {} } } }, '/c': { get: { responses: { '200': {} } } } });
    const changes = diffSpecs(oldS, newS);
    expect(changes.find(c => c.kind === 'operation-removed' && c.path === '/b')?.breaking).toBe(true);
    expect(changes.find(c => c.kind === 'operation-added' && c.path === '/c')?.breaking).toBe(false);
  });

  it('detects a new required request field and a request type change', () => {
    const reqSchema = (required: string[], emailType = 'string') => ({
      post: { requestBody: { content: { 'application/json': { schema: {
        type: 'object', required, properties: { email: { type: emailType }, age: { type: 'integer' } },
      } } } }, responses: { '201': {} } },
    });
    const oldS = spec({ '/users': reqSchema([]) });
    const newS = spec({ '/users': reqSchema(['email']) });
    const changes = diffSpecs(oldS, newS);
    expect(changes.some(c => c.kind === 'request-required-added' && c.detail.includes('email'))).toBe(true);

    const typed = diffSpecs(spec({ '/users': reqSchema([], 'string') }), spec({ '/users': reqSchema([], 'integer') }));
    expect(typed.some(c => c.kind === 'request-type-changed' && c.breaking)).toBe(true);
  });

  it('detects a removed / retyped response field', () => {
    const res = (props: any) => ({ get: { responses: { '200': { content: { 'application/json': { schema: { type: 'object', properties: props } } } } } } });
    const oldS = spec({ '/p/{id}': res({ id: { type: 'integer' }, price: { type: 'number' } }) });
    const removed = spec({ '/p/{id}': res({ id: { type: 'integer' } }) });
    const retyped = spec({ '/p/{id}': res({ id: { type: 'integer' }, price: { type: 'string' } }) });

    expect(diffSpecs(oldS, removed).some(c => c.kind === 'response-removed' && c.detail.includes('price'))).toBe(true);
    expect(diffSpecs(oldS, retyped).some(c => c.kind === 'response-type-changed' && c.detail.includes('number -> string'))).toBe(true);
  });

  it('detects a newly-required parameter', () => {
    const p = (required: boolean) => ({ get: { parameters: [{ name: 'q', in: 'query', required, schema: { type: 'string' } }], responses: { '200': {} } } });
    const changes = diffSpecs(spec({ '/search': p(false) }), spec({ '/search': p(true) }));
    expect(changes.some(c => c.kind === 'param-required-added' && c.detail.includes('query:q'))).toBe(true);
  });

  it('reports no breaking changes for an added optional response field', () => {
    const res = (props: any) => ({ get: { responses: { '200': { content: { 'application/json': { schema: { type: 'object', properties: props } } } } } } });
    const changes = diffSpecs(spec({ '/p': res({ id: { type: 'integer' } }) }), spec({ '/p': res({ id: { type: 'integer' }, discount: { type: 'number' } }) }));
    expect(summarizeDiff(changes).breaking).toBe(0);
  });
});
