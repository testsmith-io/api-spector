// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// No two folders may share a name at the same level. create/duplicate dedupe the
// name (" 2", " 3", …); rename rejects a collision outright.
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';

function freshCollection() {
  useStore.getState().closeWorkspace();
  useStore.getState().addCollection('Shop');
  const colId = useStore.getState().activeCollectionId!;
  const rootId = useStore.getState().collections[colId].data.rootFolder.id;
  return { colId, rootId };
}

const folders = (colId: string) => useStore.getState().collections[colId].data.rootFolder.folders;

describe('folder name uniqueness at one level', () => {
  beforeEach(() => { useStore.getState().closeWorkspace(); });

  it('addFolder dedupes a repeated name', () => {
    const { colId, rootId } = freshCollection();
    useStore.getState().addFolder(colId, rootId, 'New Folder');
    useStore.getState().addFolder(colId, rootId, 'New Folder');
    useStore.getState().addFolder(colId, rootId, 'New Folder');
    expect(folders(colId).map(f => f.name)).toEqual(['New Folder', 'New Folder 2', 'New Folder 3']);
  });

  it('renameFolder rejects a name already used by a sibling', () => {
    const { colId, rootId } = freshCollection();
    useStore.getState().addFolder(colId, rootId, 'Pets');
    useStore.getState().addFolder(colId, rootId, 'Orders');
    const orders = folders(colId).find(f => f.name === 'Orders')!;
    useStore.getState().renameFolder(colId, orders.id, 'Pets');   // collision → no-op
    expect(folders(colId).map(f => f.name).sort()).toEqual(['Orders', 'Pets']);
  });

  it('renameFolder allows a free name', () => {
    const { colId, rootId } = freshCollection();
    useStore.getState().addFolder(colId, rootId, 'Pets');
    const pets = folders(colId).find(f => f.name === 'Pets')!;
    useStore.getState().renameFolder(colId, pets.id, 'Animals');
    expect(folders(colId).map(f => f.name)).toEqual(['Animals']);
  });

  it('duplicateFolder works and gives the copy a unique name', () => {
    // Regression: cloneAndReId used structuredClone on the immer draft (a Proxy),
    // which threw DataCloneError — so "Duplicate folder" silently did nothing.
    const { colId, rootId } = freshCollection();
    useStore.getState().addFolder(colId, rootId, 'Pets');
    const pets = folders(colId).find(f => f.name === 'Pets')!;
    useStore.getState().duplicateFolder(colId, pets.id);
    const names = folders(colId).map(f => f.name);
    expect(names).toContain('Pets');
    expect(names).toContain('Pets (copy)');
  });

  it('a nested folder may reuse a name used at a different level', () => {
    const { colId, rootId } = freshCollection();
    useStore.getState().addFolder(colId, rootId, 'Pets');
    const pets = folders(colId).find(f => f.name === 'Pets')!;
    // "Pets" is free *inside* Pets (different level), so no dedupe.
    useStore.getState().addFolder(colId, pets.id, 'Pets');
    expect(folders(colId).find(f => f.id === pets.id)!.folders.map(f => f.name)).toEqual(['Pets']);
  });
});
