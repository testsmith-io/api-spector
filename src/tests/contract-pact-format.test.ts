// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import { importPact, exportPact, exampleToPactBody, bodyWithMatchers } from '../main/contract/pact-format';
import { compileMatcherExample } from '../main/contract/matchers';
import type { ApiRequest } from '../shared/types';

const ajv = new Ajv({ allErrors: true, strict: false });

// A representative Pact v3 file with provider states, query, and matchingRules.
const PACT_V3 = {
  consumer: { name: 'web' },
  provider: { name: 'pets-api' },
  interactions: [
    {
      description: 'a request for a pet',
      providerStates: [{ name: 'pet 1 exists' }],
      request: {
        method: 'GET',
        path: '/pets/1',
        query: { include: ['owner'] },
        headers: { Accept: 'application/json' },
      },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { id: 1, name: 'Fluffy', tags: ['a'] },
        matchingRules: {
          body: {
            '$.id': { matchers: [{ match: 'integer' }] },
            '$.name': { matchers: [{ match: 'type' }] },
            '$.tags': { matchers: [{ match: 'type', min: 1 }] },
          },
        },
      },
    },
  ],
  metadata: { pactSpecification: { version: '3.0.0' } },
};

describe('importPact', () => {
  it('parses consumer/provider/spec version', () => {
    const result = importPact(PACT_V3);
    expect(result.consumer).toBe('web');
    expect(result.provider).toBe('pets-api');
    expect(result.specVersion).toBe('3.0.0');
    expect(result.requests).toHaveLength(1);
  });

  it('maps the request side (method, path, query, headers)', () => {
    const [req] = importPact(PACT_V3).requests;
    expect(req.method).toBe('GET');
    expect(req.url).toBe('{{baseUrl}}/pets/1');
    expect(req.params).toEqual([{ key: 'include', value: 'owner', enabled: true }]);
    expect(req.headers).toEqual([{ key: 'Accept', value: 'application/json', enabled: true }]);
  });

  it('maps the response side into a consumer contract with matchers', () => {
    const [req] = importPact(PACT_V3).requests;
    expect(req.contract?.statusCode).toBe(200);
    expect(req.contract?.providerStates).toEqual(['pet 1 exists']);

    // The bodyMatcher should validate type-compatible bodies and reject bad types.
    const schema = compileMatcherExample(JSON.parse(req.contract!.bodyMatcher!));
    const validate = ajv.compile(schema);
    expect(validate({ id: 99, name: 'Other', tags: ['x', 'y'] })).toBe(true);   // types ok
    expect(validate({ id: 'nope', name: 'Other', tags: ['x'] })).toBe(false);    // id not integer
    expect(validate({ id: 1, name: 'Other', tags: [] })).toBe(false);            // tags below min
  });

  it('supports v2 providerState string and query string form', () => {
    const v2 = {
      consumer: { name: 'c' }, provider: { name: 'p' },
      interactions: [{
        description: 'x',
        providerState: 'thing exists',
        request: { method: 'GET', path: '/x', query: 'a=1&b=2' },
        response: { status: 204 },
      }],
      metadata: { 'pact-specification': { version: '2.0.0' } },
    };
    const [req] = importPact(v2).requests;
    expect(req.contract?.providerStates).toEqual(['thing exists']);
    expect(req.params).toEqual([
      { key: 'a', value: '1', enabled: true },
      { key: 'b', value: '2', enabled: true },
    ]);
  });
});

describe('exampleToPactBody', () => {
  it('extracts matchingRules and a plain example from a matcher tree', () => {
    const example = compileMatcherExampleInput();
    const { body, rules } = exampleToPactBody(example);
    expect(body).toEqual({ id: 0, name: '', tags: [''] });
    expect(rules['$.id']).toEqual({ matchers: [{ match: 'integer' }] });
    expect(rules['$.name']).toEqual({ matchers: [{ match: 'type' }] });
    expect(rules['$.tags']).toEqual({ matchers: [{ match: 'type', min: 1 }] });
  });
});

describe('round-trip: export then import', () => {
  it('preserves status, states, and matcher semantics', () => {
    const req: ApiRequest = {
      id: 'r1', name: 'get pet', method: 'GET', url: '{{baseUrl}}/pets/1',
      headers: [], params: [], auth: { type: 'none' }, body: { mode: 'none' },
      contract: {
        statusCode: 200,
        providerStates: ['pet exists'],
        bodyMatcher: JSON.stringify({ id: { __match: 'integer', value: 1 }, name: { __match: 'type', value: 'Fluffy' } }),
      },
    };
    const pact = exportPact('web', 'pets-api', [req]) as Record<string, unknown>;
    const reimported = importPact(pact);

    expect(reimported.consumer).toBe('web');
    const [back] = reimported.requests;
    expect(back.contract?.statusCode).toBe(200);
    expect(back.contract?.providerStates).toEqual(['pet exists']);

    const schema = compileMatcherExample(JSON.parse(back.contract!.bodyMatcher!));
    const validate = ajv.compile(schema);
    expect(validate({ id: 7, name: 'Rex' })).toBe(true);
    expect(validate({ id: 'x', name: 'Rex' })).toBe(false);
  });
});

describe('bodyWithMatchers — wildcard paths', () => {
  it('applies matchers to every element of an array via [*]', () => {
    const body = { items: [{ code: 'A' }, { code: 'B' }] };
    const rules = { body: { '$.items[*].code': { matchers: [{ match: 'type' as const }] } } };
    const marked = bodyWithMatchers(body, rules) as { items: { code: unknown }[] };
    expect(marked.items[0].code).toMatchObject({ __match: 'type' });
    expect(marked.items[1].code).toMatchObject({ __match: 'type' });
  });
});

// Helper: build a matcher example using raw marker nodes.
function compileMatcherExampleInput() {
  return {
    id:   { __match: 'integer', value: 0 },
    name: { __match: 'type', value: '' },
    tags: { __match: 'eachLike', value: '', min: 1 },
  };
}
