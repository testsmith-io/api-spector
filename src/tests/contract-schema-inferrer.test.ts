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
import { inferSchema, inferSchemaFromJson } from '../main/contract/schema-inferrer';

describe('inferSchema', () => {
  it('infers null type', () => {
    expect(inferSchema(null)).toEqual({ type: 'null' });
  });

  it('infers boolean type', () => {
    expect(inferSchema(true)).toEqual({ type: 'boolean' });
    expect(inferSchema(false)).toEqual({ type: 'boolean' });
  });

  it('infers integer type for whole numbers', () => {
    expect(inferSchema(42)).toEqual({ type: 'integer' });
  });

  it('infers number type for decimals', () => {
    expect(inferSchema(3.14)).toEqual({ type: 'number' });
  });

  it('infers string type', () => {
    expect(inferSchema('hello')).toEqual({ type: 'string' });
  });

  it('infers empty array', () => {
    expect(inferSchema([])).toEqual({ type: 'array', items: {} });
  });

  it('infers array with item schema from first element', () => {
    const schema = inferSchema([{ id: 1, name: 'Alice' }]);
    expect(schema).toMatchObject({ type: 'array', items: { type: 'object' } });
  });

  it('infers object with properties and required', () => {
    const schema = inferSchema({ id: 1, name: 'Alice' });
    expect(schema).toMatchObject({
      type: 'object',
      properties: {
        id:   { type: 'integer' },
        name: { type: 'string' },
      },
      required: expect.arrayContaining(['id', 'name']),
    });
  });

  it('does not include null values in required', () => {
    const schema = inferSchema({ id: 1, nickname: null }) as any;
    expect(schema.required).toContain('id');
    expect(schema.required).not.toContain('nickname');
  });

  it('recurses into nested objects', () => {
    const schema = inferSchema({ user: { id: 1 } }) as any;
    expect(schema.properties.user.type).toBe('object');
    expect(schema.properties.user.properties.id.type).toBe('integer');
  });

  it('returns empty object for undefined', () => {
    expect(inferSchema(undefined)).toEqual({ type: 'null' });
  });
});

describe('inferSchemaFromJson', () => {
  it('parses valid JSON and returns schema', () => {
    const schema = inferSchemaFromJson('{"id": 1, "name": "test"}');
    expect(schema).toMatchObject({ type: 'object' });
  });

  it('returns null for invalid JSON', () => {
    expect(inferSchemaFromJson('not json')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(inferSchemaFromJson('')).toBeNull();
  });

  it('infers schema for JSON array', () => {
    const schema = inferSchemaFromJson('[{"id": 1}]');
    expect(schema).toMatchObject({ type: 'array' });
  });
});
