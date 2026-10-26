// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { pushMockToCloud, getCloudMockRoutes } from '../../lib/cloud-push';
import { getMethodColor } from '../../../../shared/colors';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import type { MockServer } from '../../../../shared/types';

const { electron } = window;

/** Normalised key for matching a route to what the cloud already has. */
function routeKey(method: string, path: string): string {
  return `${(method || 'GET').toUpperCase()} /${String(path || '').replace(/^\/+/, '')}`;
}

/** Pick which routes of a mock to push to the cloud (defaults to all). Routes
 *  merge into the cloud mock: new ones are added, matching ones overwritten. */
export function PushToCloudModal({ mock, onClose }: { readonly mock: MockServer; readonly onClose: () => void }) {
  const t = useT();
  const routes = mock.routes ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set(routes.map(r => r.id)));
  const [status, setStatus] = useState<{ state: 'idle' | 'pushing' | 'ok' | 'err'; msg?: string; url?: string }>({ state: 'idle' });
  const [copied, setCopied] = useState(false);
  const updateMock = useStore(s => s.updateMock);
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
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function push() {
    setStatus({ state: 'pushing' });
    try {
      const r = await pushMockToCloud(mock, [...selected]);
      // Persist the shareable URL on the mock so the panel can surface it later
      // without a re-push.
      const entry = useStore.getState().mocks[mock.id];
      if (entry) {
        const next: MockServer = { ...entry.data, cloud: { id: r.id, url: r.url, pushedAt: Date.now() } };
        updateMock(mock.id, next);
        await electron.saveMock(entry.relPath, next);
      }
      setStatus({ state: 'ok', url: r.url });
    } catch (e) {
      setStatus({ state: 'err', msg: (e as Error).message });
    }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  }

  return (
    <Modal
      onClose={onClose}
      overlayClassName="bg-black/50 z-50 flex items-start justify-center pt-24"
      panelClassName="bg-surface-900 border border-surface-800 rounded-lg shadow-2xl w-[480px] flex flex-col max-h-[70vh]"
      title={t('Push ":name" to cloud', { name: mock.name })}
    >
      {overwriteCount > 0 && (
        <div className="mx-4 mt-3 px-3 py-2 rounded bg-amber-900/30 border border-amber-800/50 text-amber-300 text-[11px] flex-shrink-0">
          ⚠ {t(':count selected route already exist in the cloud and will be overwritten.|:count selected routes already exist in the cloud and will be overwritten.', { count: overwriteCount })} {t('New routes are added; others are kept.')}
        </div>
      )}

      <div className="px-4 py-2.5 border-b border-surface-800 flex items-center justify-between text-xs flex-shrink-0">
        <span className="text-surface-400">{t(':selected of :total routes selected', { selected: selected.size, total: routes.length })}</span>
        {routes.length > 0 && (
          <button
            onClick={() => setSelected(allSelected ? new Set() : new Set(routes.map(r => r.id)))}
            className="text-blue-400 hover:text-blue-300"
          >
            {allSelected ? t('Deselect all') : t('Select all')}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {routes.length === 0 ? (
          <p className="text-surface-500 text-xs px-2 py-6 text-center">{t('This mock has no routes.')}</p>
        ) : (
          routes.map(r => (
            <label key={r.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-800/50 cursor-pointer text-xs">
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="accent-blue-500" />
              <span className="font-mono font-semibold w-14 flex-shrink-0" style={{ color: getMethodColor(r.method) }}>{r.method}</span>
              <span className="font-mono text-surface-300 truncate">{r.path}</span>
              {isExisting(r) && <span className="text-[9px] uppercase tracking-wider text-amber-400 border border-amber-800/50 rounded px-1 py-0.5 flex-shrink-0">{t('in cloud')}</span>}
              <span className="ml-auto text-surface-500 flex-shrink-0">{r.statusCode}</span>
            </label>
          ))
        )}
      </div>

      {status.state === 'ok' ? (
        <div className="px-4 py-3 border-t border-surface-800 flex flex-col gap-2 flex-shrink-0">
          <span className="text-green-400 text-[11px]">✓ {t('Pushed :count route to the cloud. Share this link with your team:|Pushed :count routes to the cloud. Share this link with your team:', { count: selected.size })}</span>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={status.url ?? ''}
              onFocus={e => e.currentTarget.select()}
              className="flex-1 min-w-0 bg-surface-900 border border-surface-700 rounded px-2 py-1 text-[11px] font-mono text-surface-200 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => copyUrl(status.url ?? '')}
              className="px-3 py-1 rounded text-[11px] bg-surface-800 hover:bg-surface-700 transition-colors"
            >
              {copied ? t('Copied') : t('Copy')}
            </button>
            <button
              onClick={() => { if (status.url) void electron.openExternal(status.url); }}
              className="px-3 py-1 rounded text-[11px] bg-surface-800 hover:bg-surface-700 transition-colors"
            >
              {t('Open')}
            </button>
          </div>
          <div className="flex justify-end">
            <button onClick={onClose} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium">{t('Done')}</button>
          </div>
        </div>
      ) : (
        <div className="px-4 py-3 border-t border-surface-800 flex items-center gap-2 flex-shrink-0">
          {status.state === 'err' && <span className="text-red-400 text-[11px] flex-1 truncate">✗ {status.msg}</span>}
          <button
            onClick={push}
            disabled={status.state === 'pushing' || selected.size === 0}
            className="ml-auto px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-xs font-medium"
          >
            {status.state === 'pushing'
              ? t('Pushing…')
              : overwriteCount > 0
                ? t('Push :count (:add new, :overwrite overwrite)', { count: selected.size, add: addCount, overwrite: overwriteCount })
                : t('Push :count route|Push :count routes', { count: selected.size })}
          </button>
          <button onClick={onClose} className="px-4 py-1.5 bg-surface-800 hover:bg-surface-700 rounded text-xs">{t('Cancel')}</button>
        </div>
      )}
    </Modal>
  );
}
