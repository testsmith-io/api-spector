// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { designContractToPact, designContractToMock, typeMatchingRules, parseShape, compileResponseBody } from '../main/contract/design-pact';
import type { ConsumerContract } from '../shared/types';

const contract: ConsumerContract = {
  id: 'c1',
  consumer: 'toolshop-web',
  provider: 'toolshop-api',
  interactions: [
    {
      id: 'i1',
      description: 'get brand 1',
      providerState: 'brand 1 exists',
      request: { method: 'get', path: '/brands/{id}', headers: [{ key: 'Accept', value: 'application/json', enabled: true }] },
      response: { status: 200, body: '{"id":1,"name":"Acme","slug":"acme","tags":["a","b"]}' },
    },
  ],
};

describe('typeMatchingRules', () => {
  it('emits a type matcher for every leaf and arrays with a min', () => {
    const rules = typeMatchingRules({ id: 1, name: 'x', tags: ['a', 'b'], nested: { k: true } });
    expect(rules['$.id']).toEqual({ matchers: [{ match: 'type' }] });
    expect(rules['$.name']).toEqual({ matchers: [{ match: 'type' }] });
    expect(rules['$.tags']).toEqual({ matchers: [{ match: 'type', min: 1 }] });
    expect(rules['$.tags[*]']).toEqual({ matchers: [{ match: 'type' }] });
    expect(rules['$.nested.k']).toEqual({ matchers: [{ match: 'type' }] });
    // objects themselves get no rule — matching their members is enough
    expect(rules['$.nested']).toBeUndefined();
  });
  it('marks an empty array with min 0', () => {
    expect(typeMatchingRules({ items: [] })['$.items']).toEqual({ matchers: [{ match: 'type', min: 0 }] });
  });
});

describe('designContractToPact', () => {
  const pact = designContractToPact(contract) as {
    consumer: { name: string }; provider: { name: string };
    interactions: Record<string, unknown>[]; metadata: Record<string, unknown>;
  };

  it('names the pacticipants and pins Pact v4', () => {
    expect(pact.consumer.name).toBe('toolshop-web');
    expect(pact.provider.name).toBe('toolshop-api');
    expect((pact.metadata.pactSpecification as { version: string }).version).toBe('4.0');
  });

  it('marks each interaction as a Synchronous/HTTP v4 interaction with a stable key', () => {
    const it0 = pact.interactions[0] as { type: string; key: string };
    expect(it0.type).toBe('Synchronous/HTTP');
    expect(it0.key).toMatch(/^[0-9a-f]{8}$/);
    // key is deterministic — same contract compiles to the same key
    const again = (designContractToPact(contract) as { interactions: { key: string }[] }).interactions[0].key;
    expect(again).toBe(it0.key);
  });

  it('uppercases the method and keeps the path template', () => {
    const req = pact.interactions[0].request as { method: string; path: string; headers: Record<string, string> };
    expect(req.method).toBe('GET');
    expect(req.path).toBe('/brands/{id}');
    expect(req.headers).toEqual({ Accept: 'application/json' });
  });

  it('carries the provider state', () => {
    expect(pact.interactions[0].providerStates).toEqual([{ name: 'brand 1 exists' }]);
  });

  it('emits the response example with type matchers by default (tolerant CDCT)', () => {
    const res = pact.interactions[0].response as { status: number; body: unknown; matchingRules: { body: Record<string, unknown> } };
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 1, name: 'Acme', slug: 'acme', tags: ['a', 'b'] });
    expect(res.matchingRules.body['$.id']).toEqual({ matchers: [{ match: 'type' }] });
    expect(res.matchingRules.body['$.tags']).toEqual({ matchers: [{ match: 'type', min: 1 }] });
  });

  it('uses exact matching when looseMatch is false', () => {
    const strict = designContractToPact({
      ...contract,
      interactions: [{ ...contract.interactions[0], looseMatch: false }],
    }) as { interactions: Record<string, unknown>[] };
    const res = strict.interactions[0].response as Record<string, unknown>;
    expect(res['matchingRules']).toBeUndefined();
    expect(res['body']).toEqual({ id: 1, name: 'Acme', slug: 'acme', tags: ['a', 'b'] });
  });
});

describe('type-shape shorthand', () => {
  it('compiles [{ id: string, name: string, slug: string }] to a body + type matchers', () => {
    const out = compileResponseBody('[{ id: string, name: string, slug: string }]');
    expect(out?.body).toEqual([{ id: 'string', name: 'string', slug: 'string' }]);
    expect(out?.rules?.['$']).toEqual({ matchers: [{ match: 'type', min: 1 }] });
    expect(out?.rules?.['$[*].id']).toEqual({ matchers: [{ match: 'type' }] });
    expect(out?.rules?.['$[*].name']).toEqual({ matchers: [{ match: 'type' }] });
    expect(out?.rules?.['$[*].slug']).toEqual({ matchers: [{ match: 'type' }] });
  });

  it('defaults bare fields (no type) to string', () => {
    const out = compileResponseBody('[{ id, name, slug }]');
    expect(out?.body).toEqual([{ id: 'string', name: 'string', slug: 'string' }]);
    expect(out?.rules?.['$[*].id']).toEqual({ matchers: [{ match: 'type' }] });
  });

  it('maps integer / number / boolean / null to their specific matchers', () => {
    const out = compileResponseBody('{ count: integer, price: number, active: boolean, note: null }');
    expect(out?.body).toEqual({ count: 0, price: 0, active: false, note: null });
    expect(out?.rules?.['$.count']).toEqual({ matchers: [{ match: 'integer' }] });
    expect(out?.rules?.['$.price']).toEqual({ matchers: [{ match: 'number' }] });
    expect(out?.rules?.['$.active']).toEqual({ matchers: [{ match: 'boolean' }] });
    expect(out?.rules?.['$.note']).toEqual({ matchers: [{ match: 'null' }] });
  });

  it('handles nested objects and arrays', () => {
    const out = compileResponseBody('{ user: { id: string }, tags: [ string ] }');
    expect(out?.body).toEqual({ user: { id: 'string' }, tags: ['string'] });
    expect(out?.rules?.['$.user.id']).toEqual({ matchers: [{ match: 'type' }] });
    expect(out?.rules?.['$.user']).toBeUndefined(); // objects need no rule of their own
    expect(out?.rules?.['$.tags']).toEqual({ matchers: [{ match: 'type', min: 1 }] });
    expect(out?.rules?.['$.tags[*]']).toEqual({ matchers: [{ match: 'type' }] });
  });

  it('still treats valid JSON as a concrete example (dual-mode)', () => {
    const out = compileResponseBody('[{"id":"01M0","name":"ForgeFlex"}]');
    expect(out?.body).toEqual([{ id: '01M0', name: 'ForgeFlex' }]);
    expect(out?.rules?.['$[*].id']).toEqual({ matchers: [{ match: 'type' }] });
  });

  it('rejects text that is neither JSON nor a shape', () => {
    expect(compileResponseBody('!! not a shape !!')).toBeUndefined();
    expect(parseShape('!! nope')).toBeUndefined();
    expect(compileResponseBody('')).toBeUndefined();
  });

  it('flows through designContractToPact into the pact', () => {
    const cc: ConsumerContract = {
      id: 'c2', consumer: 'product-listing', provider: 'toolshop-api',
      interactions: [{
        id: 'i1', description: 'get all brands',
        request: { method: 'GET', path: '/brands', headers: [] },
        response: { status: 200, body: '[{ id: string, name: string, slug: string }]' },
      }],
    };
    const pact = designContractToPact(cc) as { interactions: Record<string, unknown>[] };
    const res = pact.interactions[0].response as { body: unknown; matchingRules: { body: Record<string, unknown> } };
    expect(res.body).toEqual([{ id: 'string', name: 'string', slug: 'string' }]);
    expect(res.matchingRules.body['$[*].id']).toEqual({ matchers: [{ match: 'type' }] });
  });
});

describe('designContractToMock', () => {
  it('turns each interaction into a route, converting {id} to :id', () => {
    const mock = designContractToMock(contract);
    expect(mock.routes).toHaveLength(1);
    expect(mock.routes[0].method).toBe('GET');
    expect(mock.routes[0].path).toBe('/brands/:id');
    expect(mock.routes[0].statusCode).toBe(200);
    expect(mock.routes[0].headers['Content-Type']).toBe('application/json');
  });
});
