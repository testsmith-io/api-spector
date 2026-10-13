// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importPostmanEnvironment } from '../main/importers/postman-environment';

async function importInline(obj: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'pmenv-'));
  const path = join(dir, 'env.json');
  writeFileSync(path, JSON.stringify(obj));
  return importPostmanEnvironment(path);
}

const SAMPLE = {
  id: '978dbb96-1d9d-443a-ae9b-b9b46223cfab',
  name: 'acc',
  values: [
    { key: 'name', value: 'Jack', type: 'default', enabled: true },
    { key: 'base_url', value: '', type: 'default', enabled: true },
    { key: 'hellow', value: '', type: 'default', enabled: true },
  ],
  _postman_variable_scope: 'environment',
};

describe('importPostmanEnvironment', () => {
  it('maps a Postman environment export to an Environment', async () => {
    const env = await importInline(SAMPLE);
    expect(env.version).toBe('1.0');
    expect(env.name).toBe('acc');
    expect(env.id).toMatch(/[0-9a-f-]{36}/);
    expect(env.variables).toEqual([
      { key: 'name', value: 'Jack', enabled: true },
      { key: 'base_url', value: '', enabled: true },
      { key: 'hellow', value: '', enabled: true },
    ]);
  });

  it('generates a fresh id (does not reuse the Postman id)', async () => {
    const env = await importInline(SAMPLE);
    expect(env.id).not.toBe(SAMPLE.id);
  });

  it('treats disabled entries as disabled and coerces non-string values', async () => {
    const env = await importInline({
      name: 'x',
      values: [
        { key: 'off', value: 'v', enabled: false },
        { key: 'num', value: 42 },
        { key: 'nul', value: null },
      ],
    });
    expect(env.variables).toEqual([
      { key: 'off', value: 'v', enabled: false },
      { key: 'num', value: '42', enabled: true },
      { key: 'nul', value: '', enabled: true },
    ]);
  });

  it('skips entries without a key', async () => {
    const env = await importInline({ name: 'x', values: [{ value: 'orphan' }, { key: 'ok', value: '1' }] });
    expect(env.variables).toEqual([{ key: 'ok', value: '1', enabled: true }]);
  });

  it('falls back to a default name', async () => {
    const env = await importInline({ values: [] });
    expect(env.name).toBe('Imported Environment');
  });

  it('rejects a Postman collection (no values array)', async () => {
    await expect(importInline({ info: { name: 'c' }, item: [] })).rejects.toThrow(/not a postman environment/i);
  });

  it('rejects a collection-scoped variable export', async () => {
    await expect(importInline({ values: [{ key: 'a', value: 'b' }], _postman_variable_scope: 'collection' }))
      .rejects.toThrow(/not a postman environment/i);
  });
});
