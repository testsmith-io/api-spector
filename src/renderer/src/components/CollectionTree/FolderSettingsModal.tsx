// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useState } from 'react';
import type { Folder, AuthConfig, KeyValuePair } from '../../../../shared/types';
import { useStore } from '../../store';
import { KVTable } from '../RequestBuilder/KVTable';

type ModalTab = 'auth' | 'headers'

const AUTH_TYPES: AuthConfig['type'][] = ['none', 'bearer', 'basic', 'digest', 'ntlm', 'apikey'];

interface Props {
  collectionId: string
  folder: Folder
  onClose: () => void
}

export function FolderSettingsModal({ collectionId, folder, onClose }: Props) {
  const updateFolder = useStore(s => s.updateFolder);

  const [activeTab, setActiveTab] = useState<ModalTab>('auth');
  const [auth, setAuth]           = useState<AuthConfig>(folder.auth ?? { type: 'none' });
  const [headers, setHeaders]     = useState<KeyValuePair[]>(folder.headers ?? []);

  function patchAuth(patch: Partial<AuthConfig>) {
    setAuth(prev => ({ ...prev, ...patch }));
  }

  function save() {
    updateFolder(collectionId, folder.id, { auth, headers });
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
            <h2 className="text-sm font-semibold">Folder settings</h2>
            <p className="text-[10px] text-surface-600 mt-0.5">{folder.name} — auth and headers inherited by all requests in this folder</p>
          </div>
          <button onClick={onClose} className="text-surface-400 hover:text-white text-lg leading-none">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-800 px-4 shrink-0">
          {(['auth', 'headers'] as ModalTab[]).map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px capitalize ${
                activeTab === t
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-surface-400 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-4 py-3 flex-1 overflow-y-auto text-xs">
          {activeTab === 'auth' && (
            <FolderAuthPanel auth={auth} onChange={patchAuth} />
          )}
          {activeTab === 'headers' && (
            <KVTable
              rows={headers}
              onChange={setHeaders}
              keyPlaceholder="Header-Name"
              valuePlaceholder="value"
              headerMode
            />
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

// ─── Folder auth panel ────────────────────────────────────────────────────────

function FolderAuthPanel({ auth, onChange }: { auth: AuthConfig; onChange: (p: Partial<AuthConfig>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[10px] text-surface-600">
        Auth configured here is inherited by all requests in this folder unless the request overrides it with its own non-none auth type.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-surface-400">Type:</span>
        {AUTH_TYPES.map(t => (
          <label key={t} className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              value={t}
              checked={auth.type === t}
              onChange={() => onChange({ type: t })}
              className="accent-blue-500"
            />
            <span className={auth.type === t ? 'text-white' : 'text-surface-400'}>{t}</span>
          </label>
        ))}
      </div>

      {auth.type === 'bearer' && (
        <div className="flex flex-col gap-1">
          <label className="text-surface-400">Token</label>
          <input
            value={auth.token ?? ''}
            onChange={e => onChange({ token: e.target.value })}
            placeholder="Bearer token"
            className="bg-surface-800 border border-surface-700 rounded px-2 py-1 font-mono focus:outline-none focus:border-blue-500"
          />
        </div>
      )}

      {(auth.type === 'basic' || auth.type === 'digest') && (
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-surface-400">Username</label>
            <input
              value={auth.username ?? ''}
              onChange={e => onChange({ username: e.target.value })}
              className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex-1">
            <label className="text-surface-400">Password</label>
            <input
              type="password"
              value={auth.password ?? ''}
              onChange={e => onChange({ password: e.target.value })}
              className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      )}

      {auth.type === 'ntlm' && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-surface-400">Username</label>
              <input
                value={auth.username ?? ''}
                onChange={e => onChange({ username: e.target.value })}
                className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex-1">
              <label className="text-surface-400">Password</label>
              <input
                type="password"
                value={auth.password ?? ''}
                onChange={e => onChange({ password: e.target.value })}
                className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-surface-400">Domain</label>
              <input
                value={auth.ntlmDomain ?? ''}
                onChange={e => onChange({ ntlmDomain: e.target.value })}
                placeholder="WORKGROUP"
                className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex-1">
              <label className="text-surface-400">Workstation</label>
              <input
                value={auth.ntlmWorkstation ?? ''}
                onChange={e => onChange({ ntlmWorkstation: e.target.value })}
                placeholder="MACHINE"
                className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>
      )}

      {auth.type === 'apikey' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <div>
              <label className="text-surface-400">Key name</label>
              <input
                value={auth.apiKeyName ?? 'X-API-Key'}
                onChange={e => onChange({ apiKeyName: e.target.value })}
                className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-surface-400">In</label>
              <select
                value={auth.apiKeyIn ?? 'header'}
                onChange={e => onChange({ apiKeyIn: e.target.value as 'header' | 'query' })}
                className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              >
                <option value="header">Header</option>
                <option value="query">Query</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="text-surface-400">Value</label>
              <input
                value={auth.apiKeyValue ?? ''}
                onChange={e => onChange({ apiKeyValue: e.target.value })}
                placeholder="API key value"
                className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
