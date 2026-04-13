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

  it('rewrites OpenAPI path templates {id} to {{id}}', async () => {
    const col = await importOpenApi(join(FIXTURES, 'openapi.json'));
    const getPet = Object.values(col.requests).find(r => r.name === 'Get pet');
    expect(getPet?.url).toBe('https://api.petstore.com/v1/pets/{{id}}');
  });

  it('imports path parameters into the request params table with paramType=path', async () => {
    const col = await importOpenApi(join(FIXTURES, 'openapi.json'));
    const getPet = Object.values(col.requests).find(r => r.name === 'Get pet');
    const idRow = getPet?.params.find(p => p.key === 'id');
    expect(idRow).toBeDefined();
    expect(idRow!.paramType).toBe('path');
    expect(idRow!.enabled).toBe(true);
  });

  it('imports response body schema into request.schema (resolves $refs)', async () => {
    const col = await importOpenApi(join(FIXTURES, 'openapi-contract.json'));
    const getPet = Object.values(col.requests).find(r => r.name === 'getPet');
    expect(getPet?.schema).toBeDefined();
    const parsed = JSON.parse(getPet!.schema!);
    // The Pet $ref should have been resolved inline
    expect(parsed.type).toBe('object');
    expect(parsed.required).toContain('id');
    expect(parsed.required).toContain('name');
    expect(parsed.properties.id.type).toBe('integer');
    expect(parsed.properties.name.type).toBe('string');
  });

  it('prefers 200 over other 2xx response schemas', async () => {
    const col = await importOpenApi(join(FIXTURES, 'openapi-contract.json'));
    const listPets = Object.values(col.requests).find(r => r.name === 'listPets');
    expect(listPets?.schema).toBeDefined();
    const parsed = JSON.parse(listPets!.schema!);
    expect(parsed.type).toBe('array');
    expect(parsed.items.type).toBe('object');
  });

  it('falls back to 201 when no 200 is defined', async () => {
    const col = await importOpenApi(join(FIXTURES, 'openapi-contract.json'));
    const createPet = Object.values(col.requests).find(r => r.name === 'createPet');
    expect(createPet?.schema).toBeDefined();
    const parsed = JSON.parse(createPet!.schema!);
    expect(parsed.type).toBe('object');
    expect(parsed.required).toContain('id');
  });

  it('omits request.schema when no JSON response schema is defined', async () => {
    const col = await importOpenApi(join(FIXTURES, 'openapi.json'));
    // openapi.json has no content schemas on its responses
    for (const req of Object.values(col.requests)) {
      expect(req.schema).toBeUndefined();
    }
  });
});

// ─── Inline-spec helper for narrow regression tests ──────────────────────────
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join as pjoin } from 'path';

async function importInlineSpec(spec: object) {
  const dir = mkdtempSync(pjoin(tmpdir(), 'oapi-'));
  const path = pjoin(dir, 'spec.json');
  writeFileSync(path, JSON.stringify(spec));
  return importOpenApi(path);
}

describe('importOpenApi response-schema content-type tolerance', () => {
  it('accepts application/json with a charset suffix', async () => {
    const col = await importInlineSpec({
      openapi: '3.0.0',
      info: { title: 'X', version: '1' },
      paths: {
        '/x': {
          put: {
            operationId: 'updateX',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json; charset=utf-8': {
                    schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const req = Object.values(col.requests)[0];
    expect(req.schema).toBeDefined();
    expect(JSON.parse(req.schema!).properties.ok.type).toBe('boolean');
  });

  it('accepts application/vnd.api+json', async () => {
    const col = await importInlineSpec({
      openapi: '3.0.0',
      info: { title: 'X', version: '1' },
      paths: {
        '/x': {
          put: {
            operationId: 'updateX',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/vnd.api+json': {
                    schema: { type: 'object', properties: { id: { type: 'string' } } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const req = Object.values(col.requests)[0];
    expect(req.schema).toBeDefined();
    expect(JSON.parse(req.schema!).properties.id.type).toBe('string');
  });

  it('follows a $ref to a shared response object in components.responses', async () => {
    const col = await importInlineSpec({
      openapi: '3.0.0',
      info: { title: 'X', version: '1' },
      paths: {
        '/x': {
          put: {
            operationId: 'updateX',
            responses: {
              '200': { $ref: '#/components/responses/UpdateResponse' },
            },
          },
        },
      },
      components: {
        responses: {
          UpdateResponse: {
            description: 'updated',
            content: {
              'application/json': {
                schema: { type: 'object', required: ['updatedAt'], properties: { updatedAt: { type: 'string' } } },
              },
            },
          },
        },
      },
    });
    const req = Object.values(col.requests)[0];
    expect(req.schema).toBeDefined();
    const parsed = JSON.parse(req.schema!);
    expect(parsed.required).toContain('updatedAt');
    expect(parsed.properties.updatedAt.type).toBe('string');
  });

  it('accepts the OpenAPI 2XX range form', async () => {
    const col = await importInlineSpec({
      openapi: '3.0.0',
      info: { title: 'X', version: '1' },
      paths: {
        '/x': {
          put: {
            operationId: 'updateX',
            responses: {
              '2XX': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { type: 'object', properties: { msg: { type: 'string' } } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const req = Object.values(col.requests)[0];
    expect(req.schema).toBeDefined();
    expect(JSON.parse(req.schema!).properties.msg.type).toBe('string');
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
