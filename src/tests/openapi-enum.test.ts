// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// The OpenAPI importer captures a parameter's `enum` as the row's allowed
// values, so the params table edits it as a dropdown instead of free text.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { importOpenApi } from '../main/importers/openapi';

const FIXTURES = join(import.meta.dirname, 'fixtures');

describe('importOpenApi enum capture', () => {
  it('captures a query parameter enum as allowed values', async () => {
    const col = await importOpenApi(join(FIXTURES, 'openapi-enum.json'));
    const req = Object.values(col.requests).find(r => r.name === 'List items');
    const sort = req?.params.find(p => p.key === 'sort');
    expect(sort?.enum).toEqual(['asc', 'desc']);
  });

  it('defaults a query enum param to its first allowed value', async () => {
    const col = await importOpenApi(join(FIXTURES, 'openapi-enum.json'));
    const req = Object.values(col.requests).find(r => r.name === 'List items');
    const sort = req?.params.find(p => p.key === 'sort');
    expect(sort?.value).toBe('asc');
  });

  it('leaves a non-enum parameter free text (no allowed values)', async () => {
    const col = await importOpenApi(join(FIXTURES, 'openapi-enum.json'));
    const req = Object.values(col.requests).find(r => r.name === 'List items');
    const q = req?.params.find(p => p.key === 'q');
    expect(q?.enum).toBeUndefined();
  });

  it('captures a path parameter enum as allowed values', async () => {
    const col = await importOpenApi(join(FIXTURES, 'openapi-enum.json'));
    const req = Object.values(col.requests).find(r => r.name === 'Items by status');
    const status = req?.params.find(p => p.key === 'status');
    expect(status?.paramType).toBe('path');
    expect(status?.enum).toEqual(['open', 'closed', 'archived']);
  });
});
