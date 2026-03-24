// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

import { useEffect, useRef } from 'react';
import { useStore } from '../store';

const { electron } = window;

/**
 * Watches for dirty collections and environments and persists them to disk.
 * Debounced so rapid edits (typing in URL bar) don't hammer the file system.
 */
export function useAutoSave() {
  const collections = useStore(s => s.collections);
  const _environments = useStore(s => s.environments);
  const workspace = useStore(s => s.workspace);
  const markCollectionClean = useStore(s => s.markCollectionClean);

  const colTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Save dirty collections (request/folder edits and deletes)
  useEffect(() => {
    const dirtyCollections = Object.values(collections).filter(c => c.dirty);
    if (dirtyCollections.length === 0) return;

    if (colTimerRef.current) clearTimeout(colTimerRef.current);

    colTimerRef.current = setTimeout(async () => {
      for (const { relPath, data, dirty } of dirtyCollections) {
        if (!dirty) continue;
        try {
          await electron.saveCollection(relPath, data);
          markCollectionClean(data.id);
        } catch (e) {
          console.error('Auto-save failed for', relPath, e);
        }
      }
    }, 600);

    return () => { if (colTimerRef.current) clearTimeout(colTimerRef.current); };
  }, [collections, markCollectionClean]);

  // Save workspace manifest whenever it changes (covers collection/env add & delete)
  useEffect(() => {
    if (!workspace) return;

    if (wsTimerRef.current) clearTimeout(wsTimerRef.current);

    wsTimerRef.current = setTimeout(async () => {
      try { await electron.saveWorkspace(workspace); } catch { /* best-effort */ }
    }, 300);

    return () => { if (wsTimerRef.current) clearTimeout(wsTimerRef.current); };
  }, [workspace]);
}
