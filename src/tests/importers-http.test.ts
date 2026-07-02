// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { parseHttpFile, mapDynamicVars } from '../main/importers/http-file';
import { generateHttpFile } from '../main/generators/http-file';
import type { ApiRequest, Collection } from '../shared/types';

const SAMPLE = `@baseUrl = https://api.example.com
@token = abc123

### Get a pet
# @name getPet
GET {{baseUrl}}/pets/1
Authorization: Bearer {{token}}
Accept: application/json

### Create a pet
POST {{baseUrl}}/pets
Content-Type: application/json

{
  "name": "Fluffy",
  "id": {{$guid}}
}

### Search
GET {{baseUrl}}/pets
  ?status=available
  &limit=10
`;

function reqByName(col: Collection, name: string): ApiRequest {
  const r = Object.values(col.requests).find(r => r.name === name);
  if (!r) throw new Error(`no request named ${name}`);
  return r;
}

describe('parseHttpFile — import', () => {
  const col = parseHttpFile(SAMPLE, 'sample');

  it('collects file variables as collection variables', () => {
    expect(col.collectionVariables).toEqual({ baseUrl: 'https://api.example.com', token: 'abc123' });
  });

  it('parses each request block', () => {
    expect(Object.keys(col.requests)).toHaveLength(3);
    expect(col.rootFolder.requestIds).toHaveLength(3);
  });

  it('uses the # @name directive over the ### label', () => {
    const r = reqByName(col, 'getPet');
    expect(r.method).toBe('GET');
    expect(r.url).toBe('{{baseUrl}}/pets/1');
  });

  it('lifts Authorization: Bearer into structured auth', () => {
    const r = reqByName(col, 'getPet');
    expect(r.auth).toEqual({ type: 'bearer', token: '{{token}}' });
    expect(r.headers.some(h => h.key.toLowerCase() === 'authorization')).toBe(false);
    expect(r.headers).toEqual([{ key: 'Accept', value: 'application/json', enabled: true }]);
  });

  it('detects a JSON body and maps dynamic variables', () => {
    const r = reqByName(col, 'Create a pet');
    expect(r.body.mode).toBe('json');
    expect(r.body.json).toContain('"name": "Fluffy"');
    expect(r.body.json).toContain('{{$uuid}}');   // $guid → $uuid
  });

  it('folds wrapped query-string continuation lines into the URL', () => {
    const r = reqByName(col, 'Search');
    expect(r.url).toBe('{{baseUrl}}/pets?status=available&limit=10');
  });
});

describe('mapDynamicVars', () => {
  it('maps known REST Client dynamic vars and drops unrepresentable args', () => {
    expect(mapDynamicVars('{{$guid}}')).toBe('{{$uuid}}');
    expect(mapDynamicVars('{{$randomInt 1 100}}')).toBe('{{$randomInt}}');
    expect(mapDynamicVars('{{$timestamp}}')).toBe('{{$timestamp}}');
    expect(mapDynamicVars('literal {{token}} untouched')).toBe('literal {{token}} untouched');
  });
});

describe('generateHttpFile — export', () => {
  const col = parseHttpFile(SAMPLE, 'sample');
  const [file] = generateHttpFile(col, null);

  it('emits a single .http file named after the collection', () => {
    expect(file.path).toBe('sample.http');
  });

  it('emits collection variables as @declarations', () => {
    expect(file.content).toContain('@baseUrl = https://api.example.com');
    expect(file.content).toContain('@token = abc123');
  });

  it('serialises bearer auth back to an Authorization header', () => {
    expect(file.content).toContain('Authorization: Bearer {{token}}');
  });

  it('maps dynamic vars back to REST Client names', () => {
    expect(file.content).toContain('{{$guid}}');   // $uuid → $guid on the way out
  });

  it('re-emits separators and request names', () => {
    expect(file.content).toContain('### getPet');
    expect(file.content).toContain('GET {{baseUrl}}/pets/1');
  });
});

describe('round-trip: import → export → import', () => {
  it('preserves request count, methods, auth, and body across a round-trip', () => {
    const first = parseHttpFile(SAMPLE, 'sample');
    const [file] = generateHttpFile(first, null);
    const second = parseHttpFile(file.content, 'sample');

    expect(Object.keys(second.requests)).toHaveLength(Object.keys(first.requests).length);
    expect(second.collectionVariables).toEqual(first.collectionVariables);

    const getPet = reqByName(second, 'getPet');
    expect(getPet.method).toBe('GET');
    expect(getPet.auth).toEqual({ type: 'bearer', token: '{{token}}' });

    const create = reqByName(second, 'Create a pet');
    expect(create.body.mode).toBe('json');
    expect(create.body.json).toContain('"name": "Fluffy"');
  });
});
