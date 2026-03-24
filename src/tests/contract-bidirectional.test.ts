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
import { checkSchemaCompatibility } from '../main/contract/bidirectional';
import type { ContractViolation } from '../../shared/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function compat(
  consumer: Record<string, unknown>,
  provider: Record<string, unknown>,
): ContractViolation[] {
  return checkSchemaCompatibility(consumer, provider);
}

function noViolations(consumer: Record<string, unknown>, provider: Record<string, unknown>) {
  const v = compat(consumer, provider);
  expect(v, `expected no violations but got: ${JSON.stringify(v)}`).toHaveLength(0);
}

// ─── Type matching ────────────────────────────────────────────────────────────

describe('checkSchemaCompatibility — root types', () => {
  it('passes when both schemas have the same type', () => {
    noViolations({ type: 'object' }, { type: 'object' });
    noViolations({ type: 'string' }, { type: 'string' });
    noViolations({ type: 'array' }, { type: 'array' });
  });

  it('passes when neither schema specifies a type', () => {
    noViolations({}, {});
  });

  it('fails when root types differ', () => {
    const [v] = compat({ type: 'object' }, { type: 'array' });
    expect(v.type).toBe('schema_incompatible');
    expect(v.message).toContain('"object"');
    expect(v.message).toContain('"array"');
    expect(v.expected).toBe('object');
    expect(v.actual).toBe('array');
  });

  it('treats integer and number as compatible (consumer integer, provider number)', () => {
    noViolations({ type: 'integer' }, { type: 'number' });
  });

  it('treats number and integer as compatible (consumer number, provider integer)', () => {
    noViolations({ type: 'number' }, { type: 'integer' });
  });

  it('fails for string vs integer mismatch', () => {
    const [v] = compat({ type: 'string' }, { type: 'integer' });
    expect(v.type).toBe('schema_incompatible');
  });
});

// ─── Object properties ────────────────────────────────────────────────────────

describe('checkSchemaCompatibility — object properties', () => {
  it('passes when all consumer required fields exist in provider', () => {
    noViolations(
      {
        type: 'object',
        required: ['id', 'name'],
        properties: { id: { type: 'integer' }, name: { type: 'string' } },
      },
      {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id:     { type: 'integer' },
          name:   { type: 'string' },
          status: { type: 'string' },  // extra provider field — fine
        },
      },
    );
  });

  it('fails when consumer required field is absent from provider', () => {
    const violations = compat(
      {
        type: 'object',
        required: ['id', 'name'],
        properties: { id: { type: 'integer' }, name: { type: 'string' } },
      },
      {
        type: 'object',
        properties: { id: { type: 'integer' } },  // name is missing
      },
    );
    expect(violations.some(v => v.path === 'name')).toBe(true);
    expect(violations.some(v => v.actual === '(absent)')).toBe(true);
  });

  it('reports the correct path for missing required field', () => {
    const [v] = compat(
      { type: 'object', required: ['email'], properties: { email: { type: 'string' } } },
      { type: 'object', properties: {} },
    );
    expect(v.path).toBe('email');
  });

  it('allows extra fields in consumer that are not required', () => {
    noViolations(
      {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer' }, extra: { type: 'string' } },
      },
      {
        type: 'object',
        properties: { id: { type: 'integer' } },
      },
    );
  });

  it('passes when consumer has no required fields', () => {
    noViolations(
      { type: 'object', properties: { id: { type: 'integer' } } },
      { type: 'object', properties: {} },
    );
  });
});

// ─── Recursive / nested objects ───────────────────────────────────────────────

describe('checkSchemaCompatibility — nested objects', () => {
  it('recursively checks nested required fields', () => {
    const consumer = {
      type: 'object',
      required: ['user'],
      properties: {
        user: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'integer' } },
        },
      },
    };
    const provider = {
      type: 'object',
      required: ['user'],
      properties: {
        user: {
          type: 'object',
          properties: {},  // id missing inside user
        },
      },
    };
    const violations = compat(consumer, provider);
    expect(violations.some(v => v.path === 'user.id')).toBe(true);
  });

  it('passes for deeply nested compatible schemas', () => {
    const nested = (depth: number): Record<string, unknown> =>
      depth === 0
        ? { type: 'string' }
        : {
            type: 'object',
            required: ['child'],
            properties: { child: nested(depth - 1) },
          };
    noViolations(nested(3), nested(3));
  });

  it('reports path with dots for deeply nested violations', () => {
    const consumer = {
      type: 'object',
      required: ['a'],
      properties: {
        a: { type: 'object', required: ['b'], properties: { b: { type: 'string' } } },
      },
    };
    const provider = {
      type: 'object',
      properties: {
        a: { type: 'object', properties: {} },
      },
    };
    const violations = compat(consumer, provider);
    expect(violations.some(v => v.path === 'a.b')).toBe(true);
  });
});

// ─── Array schemas ────────────────────────────────────────────────────────────

describe('checkSchemaCompatibility — arrays', () => {
  it('passes when array item types match', () => {
    noViolations(
      { type: 'array', items: { type: 'string' } },
      { type: 'array', items: { type: 'string' } },
    );
  });

  it('fails when array item types differ', () => {
    const violations = compat(
      { type: 'array', items: { type: 'string' } },
      { type: 'array', items: { type: 'integer' } },
    );
    expect(violations.some(v => v.type === 'schema_incompatible')).toBe(true);
  });

  it('passes when no items schema is defined on either side', () => {
    noViolations({ type: 'array' }, { type: 'array' });
  });

  it('uses [] suffix in path for array item violations', () => {
    const violations = compat(
      { type: 'array', items: { type: 'string' } },
      { type: 'array', items: { type: 'integer' } },
    );
    expect(violations.some(v => v.path?.includes('[]'))).toBe(true);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('checkSchemaCompatibility — edge cases', () => {
  it('returns empty array for two empty schemas', () => {
    expect(compat({}, {})).toHaveLength(0);
  });

  it('handles null / undefined gracefully', () => {
    expect(checkSchemaCompatibility(null as any, {})).toHaveLength(0);
    expect(checkSchemaCompatibility({}, null as any)).toHaveLength(0);
  });

  it('collects multiple violations in one pass', () => {
    const consumer = {
      type: 'object',
      required: ['a', 'b', 'c'],
      properties: {
        a: { type: 'string' },
        b: { type: 'string' },
        c: { type: 'string' },
      },
    };
    const provider = { type: 'object', properties: {} };
    const violations = compat(consumer, provider);
    expect(violations.length).toBeGreaterThanOrEqual(3);
  });

  it('stops recursion once root type mismatch is found', () => {
    // If root types differ we return immediately — no nested checks
    const consumer = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'integer' } },
    };
    const provider = { type: 'array' };
    const violations = compat(consumer, provider);
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe('schema_incompatible');
  });
});
