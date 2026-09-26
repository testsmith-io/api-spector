// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { externalizeDataSets, inlineDataSets } from '../main/data-files';
import type { Collection } from '../shared/types';

function makeCollection(): Collection {
  return {
    version: '1.0',
    id: 'col-1',
    name: 'Data',
    dataSet: { columns: ['token', 'userId'], rows: [['a', '1'], ['b,x', '2']] },
    rootFolder: {
      id: 'root', name: 'root', description: '', requestIds: [],
      folders: [
        { id: 'f-users', name: 'Users', description: '', folders: [], requestIds: [],
          dataSet: { columns: ['role'], rows: [['admin'], ['guest']] } },
        { id: 'f-empty', name: 'Empty', description: '', folders: [], requestIds: [] },
      ],
    },
    requests: {},
  };
}

describe('data-files externalize/inline', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'apispector-data-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('writes each data table to data/<id>.csv and replaces it with a ref', async () => {
    const out = await externalizeDataSets(makeCollection(), dir);
    // Inline datasets are stripped, refs point at data/<id>.csv.
    expect(out.dataSet).toBeUndefined();
    expect(out.dataSetRef).toBe('data/col-1.csv');
    expect(out.rootFolder.folders[0].dataSetRef).toBe('data/f-users.csv');
    // A folder with no rows gets neither.
    expect(out.rootFolder.folders[1].dataSet).toBeUndefined();
    expect(out.rootFolder.folders[1].dataSetRef).toBeUndefined();

    const files = (await readdir(join(dir, 'data'))).sort();
    expect(files).toEqual(['col-1.csv', 'f-users.csv']);
    // CSV escapes a value containing a comma.
    const csv = await readFile(join(dir, 'data', 'col-1.csv'), 'utf8');
    expect(csv).toBe('token,userId\na,1\n"b,x",2');
  });

  it('round-trips: inlineDataSets restores what externalizeDataSets wrote', async () => {
    const persisted = await externalizeDataSets(makeCollection(), dir);
    const restored = await inlineDataSets(JSON.parse(JSON.stringify(persisted)) as Collection, dir);
    expect(restored.dataSet).toEqual({ columns: ['token', 'userId'], rows: [['a', '1'], ['b,x', '2']] });
    expect(restored.dataSetRef).toBeUndefined();
    expect(restored.rootFolder.folders[0].dataSet).toEqual({ columns: ['role'], rows: [['admin'], ['guest']] });
  });

  it('leaves an older inline dataSet untouched (no ref present)', async () => {
    const legacy = makeCollection(); // has inline dataSet, no refs
    const out = await inlineDataSets(legacy, dir);
    expect(out.dataSet?.rows.length).toBe(2);
  });
});
