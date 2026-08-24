// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { pushMockToCloud, getCloudMockRoutes } from '../../lib/cloud-push';
import { getMethodColor } from '../../../../shared/colors';
import type { MockServer } from '../../../../shared/types';

/** Normalised key for matching a route to what the cloud already has. */
function routeKey(method: string, path: string): string {
  return `${(method || 'GET').toUpperCase()} /${String(path || '').replace(/^\/+/, '')}`;
}

/** Pick which routes of a mock to push to the cloud (defaults to all). Routes
 *  merge into the cloud mock: new ones are added, matching ones overwritten. */
export function PushToCloudModal({ mock, onClose }: { mock: MockServer; onClose: () => void }) {
  const routes = mock.routes ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set(routes.map(r => r.id)));
  const [status, setStatus] = useState<{ state: 'idle' | 'pushing' | 'ok' | 'err'; msg?: string }>({ state: 'idle' });
  // Keys of routes that already exist in the cloud mock (null = still loading).
  const [existing, setExisting] = useState<Set<string> | null>(null);

  useEffect(() => {
    let live = true;
    getCloudMockRoutes(mock.name).then(cloudRoutes => {
      if (!live) return;
      setExisting(cloudRoutes ? new Set(cloudRoutes.map(r => routeKey(r.method, r.path))) : new Set());
    });
    return () => { live = false; };
  }, [mock.name]);

  const isExisting = (r: { method: string; path: string }) => existing?.has(routeKey(r.method, r.path)) ?? false;
  const selectedRoutes = routes.filter(r => selected.has(r.id));
  const overwriteCount = selectedRoutes.filter(isExisting).length;
  const addCount = selectedRoutes.length - overwriteCount;

  const allSelected = routes.length > 0 && selected.size === routes.length;

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function push() {
    setStatus({ state: 'pushing' });
    try {
      const r = await pushMockToCloud(mock, [...selected]);
      setStatus({ state: 'ok', msg: r.url });
    } catch (e) {
      setStatus({ state: 'err', msg: (e as Error).message });
    }
  }

  return (
    <Modal
      onClose={onClose}
      overlayClassName="bg-black/50 z-50 flex items-start justify-center pt-24"
      panelClassName="bg-surface-900 border border-surface-800 rounded-lg shadow-2xl w-[480px] flex flex-col max-h-[70vh]"
      title={`Push "${mock.name}" to cloud`}
    >
      {overwriteCount > 0 && (
        <div className="mx-4 mt-3 px-3 py-2 rounded bg-amber-900/30 border border-amber-800/50 text-amber-300 text-[11px] flex-shrink-0">
          ⚠ {overwriteCount} selected {overwriteCount === 1 ? 'route' : 'routes'} already exist in the cloud and will be overwritten. New routes are added; others are kept.
        </div>
      )}

      <div className="px-4 py-2.5 border-b border-surface-800 flex items-center justify-between text-xs flex-shrink-0">
        <span className="text-surface-400">{selected.size} of {routes.length} routes selected</span>
        {routes.length > 0 && (
          <button
            onClick={() => setSelected(allSelected ? new Set() : new Set(routes.map(r => r.id)))}
            className="text-blue-400 hover:text-blue-300"
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {routes.length === 0 ? (
          <p className="text-surface-500 text-xs px-2 py-6 text-center">This mock has no routes.</p>
        ) : (
          routes.map(r => (
            <label key={r.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-800/50 cursor-pointer text-xs">
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="accent-blue-500" />
              <span className="font-mono font-semibold w-14 flex-shrink-0" style={{ color: getMethodColor(r.method) }}>{r.method}</span>
              <span className="font-mono text-surface-300 truncate">{r.path}</span>
              {isExisting(r) && <span className="text-[9px] uppercase tracking-wider text-amber-400 border border-amber-800/50 rounded px-1 py-0.5 flex-shrink-0">in cloud</span>}
              <span className="ml-auto text-surface-500 flex-shrink-0">{r.statusCode}</span>
            </label>
          ))
        )}
      </div>

      <div className="px-4 py-3 border-t border-surface-800 flex items-center gap-2 flex-shrink-0">
        {status.state === 'ok' ? (
          <>
            <span className="text-green-400 text-[11px] flex-1 truncate">✓ Pushed {selected.size} route{selected.size !== 1 ? 's' : ''} → {status.msg}</span>
            <button onClick={onClose} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium">Done</button>
          </>
        ) : (
          <>
            {status.state === 'err' && <span className="text-red-400 text-[11px] flex-1 truncate">✗ {status.msg}</span>}
            <button
              onClick={push}
              disabled={status.state === 'pushing' || selected.size === 0}
              className="ml-auto px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-xs font-medium"
            >
              {status.state === 'pushing'
                ? 'Pushing…'
                : overwriteCount > 0
                  ? `Push ${selected.size} (${addCount} new, ${overwriteCount} overwrite)`
                  : `Push ${selected.size} route${selected.size !== 1 ? 's' : ''}`}
            </button>
            <button onClick={onClose} className="px-4 py-1.5 bg-surface-800 hover:bg-surface-700 rounded text-xs">Cancel</button>
          </>
        )}
      </div>
    </Modal>
  );
}
