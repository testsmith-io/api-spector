// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { importInsomnia } from '../main/importers/insomnia';
import { importBruno } from '../main/importers/bruno';
import { parseBruFile } from '../main/importers/bruno';

const FIXTURES = join(import.meta.dirname, 'fixtures');

// ─── Insomnia importer ────────────────────────────────────────────────────────

describe('importInsomnia', () => {
  it('returns the workspace name as collection name', async () => {
    const col = await importInsomnia(join(FIXTURES, 'insomnia-collection.json'));
    expect(col.name).toBe('Pet Store');
  });

  it('returns version 1.0', async () => {
    const col = await importInsomnia(join(FIXTURES, 'insomnia-collection.json'));
    expect(col.version).toBe('1.0');
  });

  it('assigns a unique id', async () => {
    const col = await importInsomnia(join(FIXTURES, 'insomnia-collection.json'));
    expect(col.id).toBeTruthy();
  });

  it('imports all 2 requests', async () => {
    const col = await importInsomnia(join(FIXTURES, 'insomnia-collection.json'));
    expect(Object.keys(col.requests)).toHaveLength(2);
  });

  it('creates a folder for the request_group', async () => {
    const col = await importInsomnia(join(FIXTURES, 'insomnia-collection.json'));
    const folder = col.rootFolder.folders.find(f => f.name === 'Pets');
    expect(folder).toBeDefined();
  });

  it('places requests inside their folder', async () => {
    const col = await importInsomnia(join(FIXTURES, 'insomnia-collection.json'));
    const folder = col.rootFolder.folders.find(f => f.name === 'Pets')!;
    expect(folder.requestIds).toHaveLength(2);
  });

  it('sets correct HTTP methods', async () => {
    const col = await importInsomnia(join(FIXTURES, 'insomnia-collection.json'));
    const methods = Object.values(col.requests).map(r => r.method);
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
  });

  it('preserves request names', async () => {
    const col = await importInsomnia(join(FIXTURES, 'insomnia-collection.json'));
    const names = Object.values(col.requests).map(r => r.name);
    expect(names).toContain('List pets');
    expect(names).toContain('Create pet');
  });

  it('imports headers', async () => {
    const col = await importInsomnia(join(FIXTURES, 'insomnia-collection.json'));
    const listPets = Object.values(col.requests).find(r => r.name === 'List pets');
    expect(listPets?.headers.some(h => h.key === 'Accept')).toBe(true);
  });

  it('imports query parameters', async () => {
    const col = await importInsomnia(join(FIXTURES, 'insomnia-collection.json'));
    const listPets = Object.values(col.requests).find(r => r.name === 'List pets');
    expect(listPets?.params.some(p => p.key === 'limit')).toBe(true);
  });

  it('imports JSON body for POST', async () => {
    const col = await importInsomnia(join(FIXTURES, 'insomnia-collection.json'));
    const createPet = Object.values(col.requests).find(r => r.name === 'Create pet');
    expect(createPet?.body.mode).toBe('json');
  });

  it('imports bearer auth', async () => {
    const col = await importInsomnia(join(FIXTURES, 'insomnia-collection.json'));
    const createPet = Object.values(col.requests).find(r => r.name === 'Create pet');
    expect(createPet?.auth.type).toBe('bearer');
    expect(createPet?.auth.token).toBe('{{AUTH_TOKEN}}');
  });

  it('throws on a non-existent file', async () => {
    await expect(importInsomnia('/nonexistent/file.json')).rejects.toThrow();
  });
});

// ─── parseBruFile ─────────────────────────────────────────────────────────────

describe('parseBruFile', () => {
  const GET_BRU = `
meta {
  name: List pets
  type: http
  seq: 1
}

get {
  url: https://api.petstore.com/v1/pets
  body: none
  auth: none
}

headers {
  Accept: application/json
}

params:query {
  limit: 10
}
`;

  const POST_BRU = `
meta {
  name: Create pet
  type: http
  seq: 2
}

post {
  url: https://api.petstore.com/v1/pets
  body: json
  auth: bearer
}

body:json {
  {
    "name": "Fido",
    "age": 3
  }
}

auth:bearer {
  token: {{AUTH_TOKEN}}
}
`;

  const BASIC_BRU = `
meta {
  name: Login
  type: http
  seq: 1
}

post {
  url: https://api.example.com/login
  body: none
  auth: basic
}

auth:basic {
  username: admin
  password: secret
}
`;

  it('parses the request name from meta block', () => {
    const req = parseBruFile(GET_BRU, 'list-pets.bru');
    expect(req.name).toBe('List pets');
  });

  it('parses GET method', () => {
    const req = parseBruFile(GET_BRU, 'list-pets.bru');
    expect(req.method).toBe('GET');
  });

  it('parses POST method', () => {
    const req = parseBruFile(POST_BRU, 'create-pet.bru');
    expect(req.method).toBe('POST');
  });

  it('parses the URL', () => {
    const req = parseBruFile(GET_BRU, 'list-pets.bru');
    expect(req.url).toBe('https://api.petstore.com/v1/pets');
  });

  it('parses headers', () => {
    const req = parseBruFile(GET_BRU, 'list-pets.bru');
    expect(req.headers.some(h => h.key === 'Accept' && h.value === 'application/json')).toBe(true);
  });

  it('parses query params', () => {
    const req = parseBruFile(GET_BRU, 'list-pets.bru');
    expect(req.params.some(p => p.key === 'limit' && p.value === '10')).toBe(true);
  });

  it('parses JSON body with nested braces', () => {
    const req = parseBruFile(POST_BRU, 'create-pet.bru');
    expect(req.body.mode).toBe('json');
    expect(req.body.json).toContain('"name"');
    expect(req.body.json).toContain('"Fido"');
  });

  it('parses bearer auth', () => {
    const req = parseBruFile(POST_BRU, 'create-pet.bru');
    expect(req.auth.type).toBe('bearer');
    expect(req.auth.token).toBe('{{AUTH_TOKEN}}');
  });

  it('parses basic auth', () => {
    const req = parseBruFile(BASIC_BRU, 'login.bru');
    expect(req.auth.type).toBe('basic');
    expect(req.auth.username).toBe('admin');
    expect(req.auth.password).toBe('secret');
  });

  it('uses filename as fallback name when meta name is absent', () => {
    const req = parseBruFile('get {\n  url: https://example.com\n  body: none\n  auth: none\n}', 'my-request.bru');
    expect(req.name).toBe('my-request');
  });

  it('defaults to GET when no method block found', () => {
    const req = parseBruFile('meta {\n  name: Test\n}', 'test.bru');
    expect(req.method).toBe('GET');
  });
});

// ─── importBruno ─────────────────────────────────────────────────────────────

describe('importBruno', () => {
  it('returns the collection name from bruno.json', async () => {
    const col = await importBruno(join(FIXTURES, 'bruno-collection/bruno.json'));
    expect(col.name).toBe('Pet Store');
  });

  it('returns version 1.0', async () => {
    const col = await importBruno(join(FIXTURES, 'bruno-collection/bruno.json'));
    expect(col.version).toBe('1.0');
  });

  it('imports all .bru files as requests', async () => {
    const col = await importBruno(join(FIXTURES, 'bruno-collection/bruno.json'));
    expect(Object.keys(col.requests)).toHaveLength(2);
  });

  it('creates a folder for each subdirectory', async () => {
    const col = await importBruno(join(FIXTURES, 'bruno-collection/bruno.json'));
    const folder = col.rootFolder.folders.find(f => f.name === 'pets');
    expect(folder).toBeDefined();
  });

  it('places requests inside the correct folder', async () => {
    const col = await importBruno(join(FIXTURES, 'bruno-collection/bruno.json'));
    const folder = col.rootFolder.folders.find(f => f.name === 'pets')!;
    expect(folder.requestIds).toHaveLength(2);
  });

  it('preserves request names from meta blocks', async () => {
    const col = await importBruno(join(FIXTURES, 'bruno-collection/bruno.json'));
    const names = Object.values(col.requests).map(r => r.name);
    expect(names).toContain('List pets');
    expect(names).toContain('Create pet');
  });

  it('sets correct HTTP methods', async () => {
    const col = await importBruno(join(FIXTURES, 'bruno-collection/bruno.json'));
    const methods = Object.values(col.requests).map(r => r.method);
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
  });

  it('preserves seq ordering within a folder', async () => {
    const col = await importBruno(join(FIXTURES, 'bruno-collection/bruno.json'));
    const folder = col.rootFolder.folders.find(f => f.name === 'pets')!;
    const first = col.requests[folder.requestIds[0]];
    expect(first.name).toBe('List pets');
  });

  it('throws on a non-existent file', async () => {
    await expect(importBruno('/nonexistent/bruno.json')).rejects.toThrow();
  });
});
