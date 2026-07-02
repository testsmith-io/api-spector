// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import {
  compileMatcherExample,
  compileMatcherJson,
  like,
  eachLike,
  regex,
  integer,
  decimal,
  datetime,
} from '../main/contract/matchers';

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = (schema: object, data: unknown) => ajv.compile(schema)(data);

describe('compileMatcherExample — exact (default)', () => {
  it('compiles plain primitives to const (exact match)', () => {
    const schema = compileMatcherExample('hello');
    expect(schema).toEqual({ const: 'hello' });
    expect(validate(schema, 'hello')).toBe(true);
    expect(validate(schema, 'world')).toBe(false);
  });

  it('compiles a plain object to required properties with exact values', () => {
    const schema = compileMatcherExample({ a: 1, b: 'x' });
    expect(validate(schema, { a: 1, b: 'x' })).toBe(true);
    expect(validate(schema, { a: 2, b: 'x' })).toBe(false); // wrong value
    expect(validate(schema, { a: 1 })).toBe(false);          // missing required
  });

  it('allows extra provider fields (additionalProperties)', () => {
    const schema = compileMatcherExample({ a: 1 });
    expect(validate(schema, { a: 1, extra: true })).toBe(true);
  });
});

describe('compileMatcherExample — matchers relax exactness', () => {
  it('like() matches by type, not value', () => {
    const schema = compileMatcherExample({ name: like('Fluffy') });
    expect(validate(schema, { name: 'anything' })).toBe(true);
    expect(validate(schema, { name: 42 })).toBe(false);
  });

  it('integer() and decimal() enforce numeric kinds', () => {
    expect(validate(compileMatcherExample(integer()), 5)).toBe(true);
    expect(validate(compileMatcherExample(integer()), 5.5)).toBe(false);
    expect(validate(compileMatcherExample(decimal()), 5.5)).toBe(true);
  });

  it('regex() enforces a string pattern', () => {
    const schema = compileMatcherExample({ id: regex('^[0-9]+$', '123') });
    expect(validate(schema, { id: '999' })).toBe(true);
    expect(validate(schema, { id: 'abc' })).toBe(false);
  });

  it('datetime() requires a date-time formatted string', () => {
    const schema = compileMatcherExample(datetime('2024-01-01T00:00:00Z'));
    expect(schema).toMatchObject({ type: 'string', format: 'date-time' });
  });

  it('eachLike() matches arrays of any length whose items match the example', () => {
    const schema = compileMatcherExample({ pets: eachLike({ id: integer(), name: like('x') }, 1) });
    expect(validate(schema, { pets: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] })).toBe(true);
    expect(validate(schema, { pets: [] })).toBe(false);                 // below minItems
    expect(validate(schema, { pets: [{ id: 'nope', name: 'a' }] })).toBe(false); // bad item
  });

  it('plain arrays are position-exact with minItems', () => {
    const schema = compileMatcherExample([1, 2]);
    expect(validate(schema, [1, 2])).toBe(true);
    expect(validate(schema, [1])).toBe(false);
  });
});

describe('compileMatcherJson', () => {
  it('returns null for invalid JSON', () => {
    expect(compileMatcherJson('not json')).toBeNull();
  });
  it('parses and compiles valid JSON', () => {
    const schema = compileMatcherJson('{"a": 1}');
    expect(schema).not.toBeNull();
    expect(validate(schema!, { a: 1 })).toBe(true);
  });
});
