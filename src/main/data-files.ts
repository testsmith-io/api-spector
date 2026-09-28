// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { join } from 'node:path';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import type { Collection, Folder, DataSet } from '../shared/types';
import { toCSV, parseCSV } from '../shared/data-csv';

// Data tables (DataSet) defined on a collection or folder are stored as separate
// CSV files under a `data/` folder next to the collection, rather than inline in
// the .spector JSON — so they are git-diffable and editable. On disk the holder
// carries a `dataSetRef` (path to the CSV); in memory only `dataSet` is used.

const DATA_DIR = 'data';
const hasRows = (ds?: DataSet): boolean => !!ds && ds.columns.length > 0;
const refFor = (id: string): string => `${DATA_DIR}/${id}.csv`;

interface DataHolder { id: string; dataSet?: DataSet; dataSetRef?: string }

/** Deep-clone `col` for persistence: write each non-empty data table to a CSV
 *  under <colDir>/data/ and replace the inline `dataSet` with a `dataSetRef`.
 *  The in-memory collection is never mutated. Emptied tables drop their ref and
 *  their stale CSV is removed. */
export async function externalizeDataSets(col: Collection, colDir: string): Promise<Collection> {
  const clone: Collection = structuredClone(col);
  const writes: { path: string; content: string }[] = [];
  const removals: string[] = [];

  const handle = (h: DataHolder) => {
    if (hasRows(h.dataSet)) {
      const ref = refFor(h.id);
      writes.push({ path: join(colDir, ref), content: toCSV(h.dataSet!) });
      h.dataSetRef = ref;
    } else if (h.dataSet || h.dataSetRef) {
      removals.push(join(colDir, refFor(h.id)));
      delete h.dataSetRef;
    }
    delete h.dataSet;
  };

  handle(clone as unknown as DataHolder); // collection-level (keyed by collection id)
  const walk = (f: Folder) => { handle(f as unknown as DataHolder); f.folders.forEach(walk); };
  walk(clone.rootFolder);

  if (writes.length) await mkdir(join(colDir, DATA_DIR), { recursive: true });
  await Promise.all(writes.map(w => writeFile(w.path, w.content, 'utf8')));
  await Promise.all(removals.map(p => unlink(p).catch(() => { /* nothing to remove */ })));
  return clone;
}

/** Resolve any `dataSetRef` back into an inline `dataSet` (mutates `col`), so the
 *  rest of the app only ever sees `dataSet`. Older files with inline datasets are
 *  left untouched (and migrate to a CSV on the next save). */
export async function inlineDataSets(col: Collection, colDir: string): Promise<Collection> {
  const load = async (h: DataHolder) => {
    if (!h.dataSetRef) return;
    try {
      const text = await readFile(join(colDir, h.dataSetRef), 'utf8');
      h.dataSet = parseCSV(text);
    } catch { /* missing data file → treat as no dataset */ }
    delete h.dataSetRef;
  };
  await load(col as unknown as DataHolder);
  const walk = async (f: Folder) => { await load(f as unknown as DataHolder); await Promise.all(f.folders.map(walk)); };
  await walk(col.rootFolder);
  return col;
}
