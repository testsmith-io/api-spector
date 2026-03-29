// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useState } from 'react';
import type { Collection } from '../../../../shared/types';
import { useStore } from '../../store';

interface Props {
  collection: Collection
  onClose: () => void
}

export function CollectionSettingsModal({ collection, onClose }: Props) {
  const updateCollectionTls = useStore(s => s.updateCollectionTls);

  const existing = collection.tls;
  const [caCertPath,         setCaCertPath]         = useState(existing?.caCertPath ?? '');
  const [clientCertPath,     setClientCertPath]     = useState(existing?.clientCertPath ?? '');
  const [clientKeyPath,      setClientKeyPath]       = useState(existing?.clientKeyPath ?? '');
  const [rejectUnauthorized, setRejectUnauthorized] = useState(existing?.rejectUnauthorized !== false);

  function save() {
    const hasAny = caCertPath.trim() || clientCertPath.trim() || clientKeyPath.trim();
    updateCollectionTls(collection.id, hasAny ? {
      caCertPath:         caCertPath.trim()     || undefined,
      clientCertPath:     clientCertPath.trim() || undefined,
      clientKeyPath:      clientKeyPath.trim()  || undefined,
      rejectUnauthorized,
    } : undefined);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-16"
      onClick={onClose}
    >
      <div
        className="w-[560px] bg-surface-900 border border-surface-800 rounded-lg shadow-2xl flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-800 shrink-0">
          <div>
            <h2 className="text-sm font-semibold">Collection settings</h2>
            <p className="text-[10px] text-surface-600 mt-0.5">{collection.name}</p>
          </div>
          <button onClick={onClose} className="text-surface-400 hover:text-white text-lg leading-none">×</button>
        </div>

        {/* Content */}
        <div className="px-4 py-3 flex-1 overflow-y-auto text-xs flex flex-col gap-3">
          <p className="text-surface-500">
            TLS settings override the workspace-level configuration for every request in this collection. Leave all paths empty to inherit from the workspace.
          </p>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-surface-600 font-medium">CA Certificate path</label>
            <input
              value={caCertPath}
              onChange={e => setCaCertPath(e.target.value)}
              placeholder="/path/to/ca.crt  (leave empty to inherit)"
              className="bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono placeholder-surface-600"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-surface-600 font-medium">Client certificate path</label>
            <input
              value={clientCertPath}
              onChange={e => setClientCertPath(e.target.value)}
              placeholder="/path/to/client.crt  (leave empty to inherit)"
              className="bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono placeholder-surface-600"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-surface-600 font-medium">Client key path</label>
            <input
              value={clientKeyPath}
              onChange={e => setClientKeyPath(e.target.value)}
              placeholder="/path/to/client.key  (leave empty to inherit)"
              className="bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono placeholder-surface-600"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={rejectUnauthorized}
              onChange={e => setRejectUnauthorized(e.target.checked)}
              className="accent-blue-500"
            />
            <span>Reject unauthorized / self-signed certificates</span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-4 py-3 border-t border-surface-800 shrink-0">
          <button
            onClick={save}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium transition-colors"
          >
            Save
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-surface-800 hover:bg-surface-700 rounded text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
