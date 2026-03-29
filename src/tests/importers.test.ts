// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { importOpenApi } from '../main/importers/openapi';
import { importPostman } from '../main/importers/postman';

const FIXTURES = join(import.meta.dirname, 'fixtures');

// ─── OpenAPI importer ─────────────────────────────────────────────────────────

describe('importOpenApi', () => {
  it('returns a collection with the spec title as name', async () => {
    const col = await importOpenApi(join(FIXTURES, 'openapi.json'));
    expect(col.name).toBe('Pet Store');
  });

  it('returns version 1.0', async () => {
    const col = await importOpenApi(join(FIXTURES, 'openapi.json'));
    expect(col.version).toBe('1.0');
  });

  it('assigns a unique id', async () => {
    const col = await importOpenApi(join(FIXTURES, 'openapi.json'));
    expect(col.id).toBeTruthy();
  });

  it('imports all 4 operations as requests', async () => {
    const col = await importOpenApi(join(FIXTURES, 'openapi.json'));
    expect(Object.keys(col.requests)).toHaveLength(4);
  });

  it('groups requests by tag into folders', async () => {
    const col = await importOpenApi(join(FIXTURES, 'openapi.json'));
    const folder = col.rootFolder.folders.find(f => f.name === 'pets');
    expect(folder).toBeDefined();
    expect(folder!.requestIds).toHaveLength(4);
  });

  it('sets correct HTTP methods on requests', async () => {
    const col = await importOpenApi(join(FIXTURES, 'openapi.json'));
    const methods = Object.values(col.requests).map(r => r.method);
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
    expect(methods).toContain('DELETE');
  });

  it('prefixes URLs with the server base URL', async () => {
    const col = await importOpenApi(join(FIXTURES, 'openapi.json'));
    for (const req of Object.values(col.requests)) {
      expect(req.url).toMatch(/^https:\/\/api\.petstore\.com\/v1/);
    }
  });

  it('imports query parameters', async () => {
    const col = await importOpenApi(join(FIXTURES, 'openapi.json'));
    const listPets = Object.values(col.requests).find(r => r.name === 'List pets');
    expect(listPets?.params.some(p => p.key === 'limit')).toBe(true);
  });

  it('imports request body for POST', async () => {
    const col = await importOpenApi(join(FIXTURES, 'openapi.json'));
    const createPet = Object.values(col.requests).find(r => r.name === 'Create pet');
    expect(createPet?.body.mode).toBe('json');
  });

  it('throws on a non-existent file', async () => {
    await expect(importOpenApi('/nonexistent/file.json')).rejects.toThrow();
  });
});

// ─── Postman importer ─────────────────────────────────────────────────────────

describe('importPostman', () => {
  it('returns a collection with the collection name', async () => {
    const col = await importPostman(join(FIXTURES, 'postman-collection.json'));
    expect(col.name).toBe('Pet Store');
  });

  it('returns version 1.0', async () => {
    const col = await importPostman(join(FIXTURES, 'postman-collection.json'));
    expect(col.version).toBe('1.0');
  });

  it('imports all requests', async () => {
    const col = await importPostman(join(FIXTURES, 'postman-collection.json'));
    expect(Object.keys(col.requests)).toHaveLength(2);
  });

  it('creates a folder for each Postman folder', async () => {
    const col = await importPostman(join(FIXTURES, 'postman-collection.json'));
    const folder = col.rootFolder.folders.find(f => f.name === 'Pets');
    expect(folder).toBeDefined();
  });

  it('sets correct HTTP methods', async () => {
    const col = await importPostman(join(FIXTURES, 'postman-collection.json'));
    const methods = Object.values(col.requests).map(r => r.method);
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
  });

  it('preserves request names', async () => {
    const col = await importPostman(join(FIXTURES, 'postman-collection.json'));
    const names = Object.values(col.requests).map(r => r.name);
    expect(names).toContain('List pets');
    expect(names).toContain('Create pet');
  });

  it('imports headers', async () => {
    const col = await importPostman(join(FIXTURES, 'postman-collection.json'));
    const listPets = Object.values(col.requests).find(r => r.name === 'List pets');
    expect(listPets?.headers.some(h => h.key === 'Accept')).toBe(true);
  });

  it('imports JSON body for POST', async () => {
    const col = await importPostman(join(FIXTURES, 'postman-collection.json'));
    const createPet = Object.values(col.requests).find(r => r.name === 'Create pet');
    expect(createPet?.body.mode).toBe('json');
  });

  it('throws on a non-existent file', async () => {
    await expect(importPostman('/nonexistent/file.json')).rejects.toThrow();
  });
});
