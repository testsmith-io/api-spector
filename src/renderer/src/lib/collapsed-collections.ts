// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Remembers which collections the user has collapsed in the sidebar, so the
// tree opens the same way next launch. Only collapsed ids are stored (the
// default is expanded), keyed by the stable collection id. All access is
// read-modify-write against a single localStorage key; effect calls run
// sequentially on the JS thread, so concurrent writes (e.g. collapse-all
// toggling every node at once) don't clobber each other.

import { STORAGE_KEYS } from './storage-keys';

function readSet(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.collapsedCollections);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeSet(set: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.collapsedCollections, JSON.stringify([...set]));
  } catch { /* storage disabled / private mode */ }
}

/** True if this collection was left collapsed in a previous session. */
export function isCollectionCollapsed(id: string): boolean {
  return readSet().has(id);
}

/** Persist a collection's expanded/collapsed state (expanded is the default, so
 *  an expanded collection is simply removed from the stored set). */
export function setCollectionCollapsed(id: string, collapsed: boolean): void {
  const set = readSet();
  if (collapsed) set.add(id); else set.delete(id);
  writeSet(set);
}
