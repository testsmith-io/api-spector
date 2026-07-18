// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import {
  makeRng, buildBaseline, mutate, inferSchema, sampleCases, type JsonSchema,
} from '../main/contract/fuzz-gen';

const ajv = new Ajv({ allErrors: true, strict: false });

const productSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'name', 'price', 'email'],
  additionalProperties: false,
  properties: {
    id: { type: 'integer', minimum: 1 },
    name: { type: 'string', maxLength: 50 },
    price: { type: 'number', minimum: 0, maximum: 1000 },
    email: { type: 'string', format: 'email' },
    tags: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['active', 'inactive'] },
  },
};

describe('makeRng', () => {
  it('is deterministic for a seed', () => {
    const a = makeRng(42); const b = makeRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('differs across seeds', () => {
    expect(makeRng(1)()).not.toBe(makeRng(2)());
  });
});

describe('buildBaseline', () => {
  it('produces a schema-valid example', () => {
    const validate = ajv.compile(productSchema);
    const baseline = buildBaseline(productSchema, makeRng(7));
    // Force optional fields in for a full validation.
    const full = { ...(baseline as object), tags: ['x'], status: 'active' };
    expect(validate(full)).toBe(true);
  });
  it('respects enum, format, and numeric bounds', () => {
    expect(buildBaseline({ type: 'string', enum: ['a', 'b'] }, makeRng(1))).toBe('a');
    expect(buildBaseline({ type: 'string', format: 'email' }, makeRng(1))).toBe('user@example.com');
    expect(buildBaseline({ type: 'integer', minimum: 5, maximum: 5 }, makeRng(1))).toBe(5);
  });
  it('is deterministic for a seed', () => {
    expect(buildBaseline(productSchema, makeRng(3))).toEqual(buildBaseline(productSchema, makeRng(3)));
  });
});

describe('mutate', () => {
  const baseline = { id: 1, name: 'x', price: 5, email: 'user@example.com', status: 'active' };
  const cases = mutate(baseline, productSchema, 'body');

  it('produces single-field mutations, each tagged', () => {
    expect(cases.length).toBeGreaterThan(5);
    for (const c of cases) {
      expect(c.mutation.target).toMatch(/^body/);
      expect(c.mutation.kind).toBeTruthy();
    }
  });

  it('every structural mutation actually violates the schema', () => {
    const validate = ajv.compile(productSchema);
    // Structural violations plain ajv catches. `format` is advisory in JSON
    // Schema (ajv needs ajv-formats to enforce it), so bad-format is validated
    // server-side by the accepted-invalid oracle, not here.
    const strong = cases.filter(c =>
      /missing-required|type:|enum-violation|null-injection|unexpected-field|maxLength|below-minimum|above-maximum/.test(c.mutation.kind));
    expect(strong.length).toBeGreaterThan(0);
    for (const c of strong) {
      expect(validate(c.value), `${c.mutation.kind} on ${c.mutation.target} should be invalid`).toBe(false);
    }
  });

  it('generates missing-required for each required field present', () => {
    const kinds = cases.filter(c => c.mutation.kind === 'missing-required').map(c => c.mutation.target);
    expect(kinds).toContain('body.id');
    expect(kinds).toContain('body.email');
  });

  it('generates an unexpected-field mutation when additionalProperties is false', () => {
    expect(cases.some(c => c.mutation.kind === 'unexpected-field')).toBe(true);
  });

  it('generates a format violation for the email field', () => {
    expect(cases.some(c => c.mutation.target === 'body.email' && c.mutation.kind.startsWith('bad-format'))).toBe(true);
  });
});

describe('inferSchema', () => {
  it('infers an object schema with all keys required', () => {
    const s = inferSchema({ a: 1, b: 'x', c: true });
    expect(s['type']).toBe('object');
    expect((s['required'] as string[]).sort()).toEqual(['a', 'b', 'c']);
    expect((s['properties'] as Record<string, JsonSchema>)['a']['type']).toBe('integer');
  });
  it('drives mutations for a spec-less body', () => {
    const body = { userId: 10, note: 'hi' };
    const cases = mutate(body, inferSchema(body), 'body');
    expect(cases.some(c => c.mutation.kind === 'missing-required')).toBe(true);
    expect(cases.some(c => c.mutation.kind.startsWith('type:'))).toBe(true);
  });
});

describe('sampleCases', () => {
  it('caps the count deterministically', () => {
    const many = mutate({ id: 1, name: 'x', price: 5, email: 'a@b.co', status: 'active' }, productSchema, 'body');
    const a = sampleCases(many, 5, makeRng(9));
    const b = sampleCases(many, 5, makeRng(9));
    expect(a).toHaveLength(5);
    expect(a.map(c => c.mutation.kind)).toEqual(b.map(c => c.mutation.kind));
  });
  it('returns all when budget exceeds count', () => {
    const few = mutate({ x: 1 }, inferSchema({ x: 1 }), 'body');
    expect(sampleCases(few, 999, makeRng(1))).toHaveLength(few.length);
  });
});

describe('accepted-invalid gating (false-positive guard)', () => {
  // The orchestrator only flags accepted-invalid when ajv confirms the mutated
  // body violates the schema. A plain string field with no minLength/pattern
  // must treat empty/unicode/whitespace strings as VALID, so a 2xx to them is
  // not a finding. This locks that behavior at the schema level.
  const schema: JsonSchema = {
    type: 'object', required: ['name'],
    properties: { name: { type: 'string', maxLength: 20 } },
  };
  const validate = ajv.compile(schema);

  it('empty / unicode / whitespace strings are schema-valid (no false positive)', () => {
    expect(validate({ name: '' })).toBe(true);
    expect(validate({ name: '𝔘🙈' })).toBe(true);
    expect(validate({ name: '   ' })).toBe(true);
  });

  it('genuinely invalid mutations remain invalid', () => {
    expect(validate({ name: 'x'.repeat(21) })).toBe(false); // maxLength+1
    expect(validate({ name: 123 })).toBe(false);            // type confusion
    expect(validate({})).toBe(false);                        // missing required
  });
});

// ─── runFuzz integration: trace records every executed case ───────────────────

import { createServer } from 'node:http';
import { runFuzz } from '../main/contract/fuzz';
import type { ApiRequest } from '../shared/types';

describe('runFuzz trace mode', () => {
  const req: ApiRequest = {
    id: 'r1', name: 'echo', method: 'POST', url: 'http://placeholder/echo',
    headers: [], params: [], auth: { type: 'none' },
    body: { mode: 'json', json: '{"name":"Bob","age":30}' },
  };

  async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
    const server = createServer((rq, res) => {
      let b = ''; rq.on('data', c => { b += c; });
      rq.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
    });
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    try { return await fn(`http://127.0.0.1:${port}`); }
    finally { server.close(); }
  }

  it('records every case when trace is on, and omits it when off', async () => {
    await withServer(async base => {
      const withTrace = await runFuzz({
        requests: [req], envVars: {}, providerBaseUrl: base,
        includeWrites: true, casesPerOperation: 10, seed: 1, trace: true,
      });
      const op = withTrace.results[0];
      expect(op.trace).toBeDefined();
      expect(op.trace!.length).toBe(op.cases);
      // Each trace entry carries the sent body and a status.
      for (const t of op.trace!) {
        expect(typeof t.status).toBe('number');
        expect(t.request.body).toBeTruthy();
        expect(t.mutation.kind).toBeTruthy();
        // The server responded {"ok":true}; the trace must capture that response.
        expect(t.responseSample).toContain('ok');
      }

      const noTrace = await runFuzz({
        requests: [req], envVars: {}, providerBaseUrl: base,
        includeWrites: true, casesPerOperation: 10, seed: 1, trace: false,
      });
      expect(noTrace.results[0].trace).toBeUndefined();
    });
  });

  it('is deterministic: same seed sends the same case bodies', async () => {
    await withServer(async base => {
      const run = () => runFuzz({
        requests: [req], envVars: {}, providerBaseUrl: base,
        includeWrites: true, casesPerOperation: 10, seed: 7, trace: true,
      });
      const a = await run(); const b = await run();
      const bodiesA = a.results[0].trace!.map(t => t.request.body);
      const bodiesB = b.results[0].trace!.map(t => t.request.body);
      expect(bodiesA).toEqual(bodiesB);
    });
  });
});

// ─── Query parameter mutations ────────────────────────────────────────────────

import { mutateQueryParams } from '../main/contract/fuzz-gen';
import type { KeyValuePair } from '../shared/types';

describe('mutateQueryParams', () => {
  const base: KeyValuePair[] = [
    { key: 'q', value: 'hello', enabled: true },
    { key: 'limit', value: '10', enabled: true },
  ];
  const schemas = [
    { name: 'q', required: true, schema: { type: 'string' } },
    { name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } },
  ];

  it('omits required params, and only required ones', () => {
    const cases = mutateQueryParams(base, schemas);
    const missing = cases.filter(c => c.mutation.kind === 'missing-required');
    expect(missing.map(c => c.mutation.target)).toEqual(['query.q']);
    expect(missing[0].params.some(p => p.key === 'q')).toBe(false);
  });

  it('mutates numeric params below/above bounds and with non-numbers', () => {
    const cases = mutateQueryParams(base, schemas);
    const limitKinds = cases.filter(c => c.mutation.target === 'query.limit').map(c => c.mutation.kind);
    expect(limitKinds).toEqual(expect.arrayContaining(['not-a-number', 'below-minimum', 'above-maximum']));
    const below = cases.find(c => c.mutation.kind === 'below-minimum')!;
    expect(below.params.find(p => p.key === 'limit')!.value).toBe('0');
  });

  it('injects adversarial values (sql, xss, traversal) per param', () => {
    const cases = mutateQueryParams(base, schemas);
    const kinds = cases.map(c => c.mutation.kind);
    expect(kinds).toEqual(expect.arrayContaining(['adversarial:sql', 'adversarial:xss', 'adversarial:traversal']));
  });

  it('adds an unexpected extra param', () => {
    const cases = mutateQueryParams(base, schemas);
    const extra = cases.find(c => c.mutation.kind === 'unexpected-param')!;
    expect(extra.params.some(p => p.key === '__fuzz')).toBe(true);
  });

  it('works with no schemas (request-source mode): adversarial + extra only', () => {
    const cases = mutateQueryParams(base, []);
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.every(c => c.mutation.kind !== 'missing-required')).toBe(true);
    expect(cases.some(c => c.mutation.kind.startsWith('adversarial:'))).toBe(true);
  });
});
