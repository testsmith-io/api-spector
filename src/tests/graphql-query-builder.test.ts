// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { parse } from 'graphql';
import { insertField, mergeVariables } from '../renderer/src/lib/graphql-query-builder';
import type { ParsedSchema, GqlType, GqlField, GqlTypeRef } from '../renderer/src/lib/graphql-introspection';

// ── tiny schema builders ──
const scalar = (name: string): GqlTypeRef => ({ kind: 'SCALAR', name, ofType: null });
const obj = (name: string): GqlTypeRef => ({ kind: 'OBJECT', name, ofType: null });
const union = (name: string): GqlTypeRef => ({ kind: 'UNION', name, ofType: null });
const nn = (ref: GqlTypeRef): GqlTypeRef => ({ kind: 'NON_NULL', name: null, ofType: ref });
const list = (ref: GqlTypeRef): GqlTypeRef => ({ kind: 'LIST', name: null, ofType: ref });
const field = (name: string, type: GqlTypeRef, args: GqlField['args'] = []): GqlField => ({ name, type, args });

const typeMap = new Map<string, GqlType>([
  ['Query', { name: 'Query', kind: 'OBJECT', fields: [
    field('user', obj('User'), [{ name: 'id', type: nn(scalar('ID')) }]),
    field('products', list(obj('Product')), [{ name: 'first', type: scalar('Int') }]),
    field('search', union('Result')),
  ] }],
  ['User', { name: 'User', kind: 'OBJECT', fields: [
    field('id', nn(scalar('ID'))), field('name', scalar('String')), field('address', obj('Address')),
  ] }],
  ['Address', { name: 'Address', kind: 'OBJECT', fields: [field('city', scalar('String'))] }],
  ['Product', { name: 'Product', kind: 'OBJECT', fields: [field('id', nn(scalar('ID'))), field('price', scalar('Float'))] }],
  ['Result', { name: 'Result', kind: 'UNION', fields: null }],
  // brands(page: Int) -> BrandConn { data: [Brand { name }] } : optional-arg chain.
  ['BrandConn', { name: 'BrandConn', kind: 'OBJECT', fields: [field('data', list(obj('Brand')))] }],
  ['Brand', { name: 'Brand', kind: 'OBJECT', fields: [
    'name', 'code', 'slug', 'active', 'createdAt', 'updatedAt', 'description', 'sku',
  ].map(n => field(n, scalar('String'))) }],
]);
typeMap.get('Query')!.fields!.push(field('brands', obj('BrandConn'), [{ name: 'page', type: scalar('Int') }]));
// Lighthouse-style mandatory pagination: first is Int! (required, no default).
typeMap.get('Query')!.fields!.push(field('catalog', obj('BrandConn'), [{ name: 'first', type: nn(scalar('Int')) }]));
// Non-null arg WITH a default (first: Int! = 10): optional to provide.
typeMap.get('Query')!.fields!.push(field('feed', obj('BrandConn'), [{ name: 'first', type: nn(scalar('Int')), defaultValue: '10' }]));

const schema: ParsedSchema = { queryType: 'Query', mutationType: null, subscriptionType: null, typeMap };

function valid(query: string) { expect(() => parse(query)).not.toThrow(); }

describe('insertField', () => {
  it('inserts a root field with a required arg as a typed variable, producing valid syntax', () => {
    const { query, variables } = insertField('', '', schema, 'query', [], typeMap.get('Query')!.fields![0]);
    valid(query);
    expect(query).toMatch(/user\(id: \$id\)/);
    expect(query).toMatch(/query \(\$id: ID!\)/);      // variable added to the signature
    expect(query).toMatch(/\bid\b/);                   // leaf selection
    expect(JSON.parse(variables)).toHaveProperty('id', '');
  });

  it('leaves optional args out entirely (clean field, no args or variables)', () => {
    const { query, variables } = insertField('', '', schema, 'query', [], typeMap.get('Query')!.fields![1]);
    valid(query);
    expect(query).toMatch(/products \{/);   // no (first: ...) argument list
    expect(query).not.toContain('(');
    expect(variables).toBe('');
  });

  it('gives a union field a valid selection (__typename)', () => {
    const { query } = insertField('', '', schema, 'query', [], typeMap.get('Query')!.fields![2]);
    valid(query);
    expect(query).toMatch(/search \{[^}]*__typename/s);
  });

  it('inserts a nested field under a path, creating the ancestor if missing', () => {
    const address = typeMap.get('User')!.fields!.find(f => f.name === 'address')!;
    const { query } = insertField('', '', schema, 'query', ['user'], address);
    valid(query);
    expect(query).toMatch(/user\(id: \$id\)/);         // ancestor created with its required arg
    expect(query).toMatch(/address \{[\s\S]*city/);    // nested field with a leaf
  });

  it('builds a clean nested query by inserting the leaf, with no args or variables', () => {
    const nameField = typeMap.get('Brand')!.fields![0];
    const { query, variables } = insertField('', '', schema, 'query', ['brands', 'data'], nameField);
    valid(query);
    expect(query).not.toContain('(');           // no page / args anywhere
    expect(query).not.toContain('__typename');  // ancestors get real selections, not a placeholder
    expect(variables).toBe('');                 // no variables
    expect(query.replace(/\s+/g, ' ').trim()).toBe('{ brands { data { name } } }');
  });

  it('all-fields insert selects every leaf field of the entity, no args or variables', () => {
    const dataField = typeMap.get('BrandConn')!.fields![0];   // data: [Brand]
    const all = insertField('', '', schema, 'query', ['brands'], dataField, undefined, { allFields: true });
    valid(all.query);
    for (const f of typeMap.get('Brand')!.fields!) expect(all.query).toContain(f.name);   // every Brand field
    expect(all.query).not.toContain('(');
    expect(all.variables).toBe('');

    // The default insert caps the selection, so it omits the later fields.
    const some = insertField('', '', schema, 'query', ['brands'], dataField);
    expect(some.query).not.toContain('sku');
  });

  it('inlines a required pagination arg as a number, no variable', () => {
    const dataField = typeMap.get('BrandConn')!.fields![0];
    const { query, variables } = insertField('', '', schema, 'query', ['catalog'], dataField, undefined, { allFields: true });
    valid(query);
    expect(query).toMatch(/catalog\(first: 100\)/);
    expect(query).not.toContain('$first');
    expect(variables).toBe('');
  });

  it('treats a non-null arg with a default value as optional (omits it)', () => {
    const dataField = typeMap.get('BrandConn')!.fields![0];
    const { query, variables } = insertField('', '', schema, 'query', ['feed'], dataField, undefined, { allFields: true });
    valid(query);
    expect(query).toMatch(/feed \{/);   // no (first: ...) despite Int!
    expect(query).not.toContain('first');
    expect(variables).toBe('');
  });

  it('merges into an existing query without duplicating and stays valid', () => {
    const first = insertField('', '', schema, 'query', [], typeMap.get('Query')!.fields![0]);
    const second = insertField(first.query, first.variables, schema, 'query', [], typeMap.get('Query')!.fields![1]);
    valid(second.query);
    expect(second.query).toMatch(/user\(id: \$id\)/);
    expect(second.query).toMatch(/products \{/);
    // inserting user again does not duplicate it
    const third = insertField(second.query, second.variables, schema, 'query', [], typeMap.get('Query')!.fields![0]);
    expect(third.query.match(/user\(/g)).toHaveLength(1);
  });
});

describe('mergeVariables', () => {
  it('adds seeds without clobbering existing values', () => {
    expect(JSON.parse(mergeVariables('{"id":"abc"}', { id: '', page: 0 }))).toEqual({ id: 'abc', page: 0 });
  });
  it('returns input unchanged when there are no seeds', () => {
    expect(mergeVariables('{"a":1}', {})).toBe('{"a":1}');
  });
});
