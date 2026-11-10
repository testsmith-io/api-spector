// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// copyRequest duplicates a request into another folder/collection (drag with
// Ctrl/Cmd): the original stays put, the copy gets a fresh id, keeps the name,
// and lands in the destination folder.
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';

function freshCollection(name: string) {
  useStore.getState().addCollection(name);
  const colId = useStore.getState().activeCollectionId!;
  const rootId = useStore.getState().collections[colId].data.rootFolder.id;
  return { colId, rootId };
}

const reqNames = (colId: string, folderId: string) => {
  const col = useStore.getState().collections[colId].data;
  const folder = folderId === col.rootFolder.id
    ? col.rootFolder
    : col.rootFolder.folders.find(f => f.id === folderId)!;
  return folder.requestIds.map(id => col.requests[id].name);
};

describe('copyRequest', () => {
  beforeEach(() => { useStore.getState().closeWorkspace(); });

  it('copies a request into another collection, leaving the original in place', () => {
    const src = freshCollection('OpenAPI');
    const reqId = useStore.getState().addRequest(src.colId, src.rootId);
    useStore.getState().renameRequest(reqId, 'Get pets');

    const dest = freshCollection('Tests');
    useStore.getState().copyRequest(src.colId, reqId, dest.colId, dest.rootId);

    // Original still there.
    expect(reqNames(src.colId, src.rootId)).toEqual(['Get pets']);
    // Copy present in the destination with the same name and a NEW id.
    const destCol = useStore.getState().collections[dest.colId].data;
    const copyId = destCol.rootFolder.requestIds[0];
    expect(copyId).not.toBe(reqId);
    expect(destCol.requests[copyId].name).toBe('Get pets');
    expect(useStore.getState().collections[dest.colId].dirty).toBe(true);
  });

  it('inserts the copy at the given index within the destination folder', () => {
    const { colId, rootId } = freshCollection('C');
    const a = useStore.getState().addRequest(colId, rootId);
    useStore.getState().renameRequest(a, 'A');
    const b = useStore.getState().addRequest(colId, rootId);
    useStore.getState().renameRequest(b, 'B');

    // Copy A to index 1 (between A and B).
    useStore.getState().copyRequest(colId, a, colId, rootId, 1);
    expect(reqNames(colId, rootId)).toEqual(['A', 'A', 'B']);
    // The copy is a distinct request, not a second reference to the same id.
    const ids = useStore.getState().collections[colId].data.rootFolder.requestIds;
    expect(new Set(ids).size).toBe(ids.length);
  });
});
