// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

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
  const flows = useStore(s => s.flows);
  const workspace = useStore(s => s.workspace);
  const markCollectionClean = useStore(s => s.markCollectionClean);
  const markFlowClean = useStore(s => s.markFlowClean);

  const colTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Save dirty flows (node/edge edits, rename)
  useEffect(() => {
    const dirtyFlows = Object.values(flows).filter(f => f.dirty);
    if (dirtyFlows.length === 0) return;

    if (flowTimerRef.current) clearTimeout(flowTimerRef.current);

    flowTimerRef.current = setTimeout(async () => {
      for (const { relPath, data, dirty } of dirtyFlows) {
        if (!dirty) continue;
        try {
          await electron.saveFlow(relPath, data);
          markFlowClean(data.id);
        } catch (e) {
          console.error('Auto-save failed for', relPath, e);
        }
      }
    }, 600);

    return () => { if (flowTimerRef.current) clearTimeout(flowTimerRef.current); };
  }, [flows, markFlowClean]);

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
