// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Collections and folders open as tabs (like requests), and the legacy panel
// flags (collectionPanelOpen / folderPanel) track the active tab so the main
// area shows exactly one thing — no overlap.
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';

function setup() {
  const st = useStore.getState();
  st.closeWorkspace();
  st.addCollection('Shop');
  const colId = useStore.getState().activeCollectionId!;
  const rootId = useStore.getState().collections[colId].data.rootFolder.id;
  st.addFolder(colId, rootId, 'Pets');
  const folderId = useStore.getState().collections[colId].data.rootFolder.folders[0].id;
  return { colId, rootId, folderId };
}

const s = () => useStore.getState();
const activeTab = () => s().tabs.find(t => t.id === s().activeTabId);

describe('collection / folder tabs', () => {
  beforeEach(() => { useStore.getState().closeWorkspace(); });

  it('opens a collection as a tab and points the panel flags at it', () => {
    const { colId } = setup();
    useStore.getState().openCollectionTab(colId);
    expect(activeTab()?.kind).toBe('collection');
    expect(s().collectionPanelOpen).toBe(true);
    expect(s().folderPanel).toBeNull();
  });

  it('opens a folder as a tab with folderPanel set', () => {
    const { colId, folderId } = setup();
    useStore.getState().openFolderTab(colId, folderId);
    expect(activeTab()?.kind).toBe('folder');
    expect(s().folderPanel).toEqual({ collectionId: colId, folderId });
    expect(s().collectionPanelOpen).toBe(false);
  });

  it('reuses an existing tab instead of opening duplicates', () => {
    const { colId, folderId } = setup();
    useStore.getState().openCollectionTab(colId);
    useStore.getState().openCollectionTab(colId);
    useStore.getState().openFolderTab(colId, folderId);
    useStore.getState().openFolderTab(colId, folderId);
    expect(s().tabs.filter(t => t.kind === 'collection').length).toBe(1);
    expect(s().tabs.filter(t => t.kind === 'folder').length).toBe(1);
  });

  it('switching to a request tab clears the data panels', () => {
    const { colId, rootId } = setup();
    useStore.getState().openCollectionTab(colId);
    expect(s().collectionPanelOpen).toBe(true);
    const reqId = useStore.getState().addRequest(colId, rootId);   // opens a request tab
    expect(activeTab()?.kind).toBe('request');
    expect(activeTab()?.requestId).toBe(reqId);
    expect(s().collectionPanelOpen).toBe(false);
    expect(s().folderPanel).toBeNull();
  });

  it('closing all tabs clears the data panels (no leftover window)', () => {
    const { colId, folderId } = setup();
    useStore.getState().openCollectionTab(colId);
    useStore.getState().openFolderTab(colId, folderId);
    useStore.getState().closeAllTabs();
    expect(s().tabs).toHaveLength(0);
    expect(s().activeTabId).toBeNull();
    expect(s().collectionPanelOpen).toBe(false);
    expect(s().folderPanel).toBeNull();
  });

  it('closing a folder deletes its tab and re-syncs the panels', () => {
    const { colId, folderId } = setup();
    useStore.getState().openFolderTab(colId, folderId);
    useStore.getState().deleteFolder(colId, folderId);
    expect(s().tabs.some(t => t.kind === 'folder')).toBe(false);
    expect(s().folderPanel).toBeNull();
  });
});
