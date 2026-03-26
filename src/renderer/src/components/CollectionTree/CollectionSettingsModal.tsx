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

import React, { useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Collection } from '../../../../shared/types';
import { useStore } from '../../store';
import { atCompletionExtension } from '../RequestBuilder/atCompletions';
import { useVarNames } from '../../hooks/useVarNames';

type ModalTab = 'tls' | 'hooks'

interface Props {
  collection: Collection
  onClose: () => void
}

export function CollectionSettingsModal({ collection, onClose }: Props) {
  const updateCollectionTls   = useStore(s => s.updateCollectionTls);
  const updateCollectionHooks = useStore(s => s.updateCollectionHooks);
  const varNames              = useVarNames();

  const [activeTab, setActiveTab] = useState<ModalTab>('tls');

  // TLS state
  const existing = collection.tls;
  const [caCertPath,         setCaCertPath]         = useState(existing?.caCertPath ?? '');
  const [clientCertPath,     setClientCertPath]     = useState(existing?.clientCertPath ?? '');
  const [clientKeyPath,      setClientKeyPath]       = useState(existing?.clientKeyPath ?? '');
  const [rejectUnauthorized, setRejectUnauthorized] = useState(existing?.rejectUnauthorized !== false);

  // Hooks state
  const [setupScript,    setSetupScript]    = useState(collection.hooks?.setup    ?? '');
  const [teardownScript, setTeardownScript] = useState(collection.hooks?.teardown ?? '');

  const scriptExt = useMemo(
    () => [javascript(), atCompletionExtension(varNames)],
    [varNames],
  );

  function save() {
    // TLS
    const hasAny = caCertPath.trim() || clientCertPath.trim() || clientKeyPath.trim();
    updateCollectionTls(collection.id, hasAny ? {
      caCertPath:         caCertPath.trim()     || undefined,
      clientCertPath:     clientCertPath.trim() || undefined,
      clientKeyPath:      clientKeyPath.trim()  || undefined,
      rejectUnauthorized,
    } : undefined);

    // Hooks
    const hasHooks = setupScript.trim() || teardownScript.trim();
    updateCollectionHooks(collection.id, hasHooks ? {
      setup:    setupScript.trim()    || undefined,
      teardown: teardownScript.trim() || undefined,
    } : undefined);

    onClose();
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-16"
      onClick={onClose}
    >
      <div
        className="w-[600px] bg-surface-900 border border-surface-800 rounded-lg shadow-2xl flex flex-col max-h-[80vh]"
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

        {/* Tabs */}
        <div className="flex border-b border-surface-800 px-4 shrink-0">
          {(['tls', 'hooks'] as ModalTab[]).map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px capitalize ${
                activeTab === t
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-surface-400 hover:text-white'
              }`}
            >
              {t === 'tls' ? 'TLS' : 'Hooks'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-4 py-3 flex-1 overflow-y-auto text-xs flex flex-col gap-3">
          {activeTab === 'tls' && (
            <>
              <p className="text-surface-500">
                These settings override the workspace-level TLS configuration for every request in this collection. Leave all paths empty to inherit from the workspace.
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
            </>
          )}

          {activeTab === 'hooks' && (
            <div className="flex flex-col gap-4">
              <p className="text-surface-500">
                Hooks run once per collection run. Use <code className="text-surface-300">sp.collectionVariables.set()</code> and <code className="text-surface-300">sp.environment.set()</code> to share state across requests.
              </p>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-surface-600 font-medium">Setup</span>
                  <span className="text-[10px] text-surface-600">runs once before any request</span>
                </div>
                <div className="rounded overflow-hidden border border-surface-700">
                  <CodeMirror
                    value={setupScript}
                    height="140px"
                    theme={oneDark}
                    extensions={scriptExt}
                    onChange={setSetupScript}
                    basicSetup={{ lineNumbers: true, foldGutter: false, autocompletion: false }}
                    placeholder="// sp.environment.set('token', 'abc123');"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-surface-600 font-medium">Teardown</span>
                  <span className="text-[10px] text-surface-600">runs once after all requests complete</span>
                </div>
                <div className="rounded overflow-hidden border border-surface-700">
                  <CodeMirror
                    value={teardownScript}
                    height="140px"
                    theme={oneDark}
                    extensions={scriptExt}
                    onChange={setTeardownScript}
                    basicSetup={{ lineNumbers: true, foldGutter: false, autocompletion: false }}
                    placeholder="// cleanup logic here"
                  />
                </div>
              </div>
            </div>
          )}
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
