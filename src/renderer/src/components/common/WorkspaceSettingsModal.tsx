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

import React, { useState } from 'react';
import { useStore } from '../../store';

const { electron } = window;

const DEFAULT_PII_PATTERNS = ['authorization', 'password', 'token', 'secret', 'api-key', 'x-api-key'];

type SettingsTab = 'proxy' | 'tls' | 'privacy'

export function WorkspaceSettingsModal({ onClose }: { onClose: () => void }) {
  const workspace = useStore(s => s.workspace);
  const updateWorkspaceSettings = useStore(s => s.updateWorkspaceSettings);

  const existing = workspace?.settings ?? {};

  const [activeTab, setActiveTab] = useState<SettingsTab>('proxy');

  // Proxy state
  const [proxyUrl,      setProxyUrl]      = useState(existing.proxy?.url ?? '');
  const [proxyUser,     setProxyUser]     = useState(existing.proxy?.auth?.username ?? '');
  const [proxyPass,     setProxyPass]     = useState(existing.proxy?.auth?.password ?? '');

  // TLS state
  const [caCertPath,      setCaCertPath]      = useState(existing.tls?.caCertPath ?? '');
  const [clientCertPath,  setClientCertPath]  = useState(existing.tls?.clientCertPath ?? '');
  const [clientKeyPath,   setClientKeyPath]   = useState(existing.tls?.clientKeyPath ?? '');
  const [rejectUnauthorized, setRejectUnauthorized] = useState(
    existing.tls?.rejectUnauthorized !== false, // default true
  );

  // Privacy state
  const [patterns, setPatterns] = useState<string[]>(
    existing.piiMaskPatterns ?? DEFAULT_PII_PATTERNS,
  );
  const [newPattern, setNewPattern] = useState('');

  function addPattern() {
    const p = newPattern.trim().toLowerCase();
    if (p && !patterns.includes(p)) setPatterns(prev => [...prev, p]);
    setNewPattern('');
  }

  function removePattern(p: string) {
    setPatterns(prev => prev.filter(x => x !== p));
  }

  async function save() {
    const settings: NonNullable<NonNullable<typeof workspace>['settings']> = {};

    if (proxyUrl.trim()) {
      settings.proxy = { url: proxyUrl.trim() };
      if (proxyUser.trim() || proxyPass.trim()) {
        settings.proxy.auth = { username: proxyUser, password: proxyPass };
      }
    }

    settings.tls = {
      caCertPath:     caCertPath.trim()     || undefined,
      clientCertPath: clientCertPath.trim() || undefined,
      clientKeyPath:  clientKeyPath.trim()  || undefined,
      rejectUnauthorized,
    };

    settings.piiMaskPatterns = patterns;

    updateWorkspaceSettings(settings);

    const updated = useStore.getState().workspace;
    if (updated) await electron.saveWorkspace(updated);
    onClose();
  }

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'proxy',   label: 'Proxy' },
    { id: 'tls',     label: 'TLS / Certificates' },
    { id: 'privacy', label: 'Privacy' },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-16"
      onClick={onClose}
    >
      <div
        className="bg-surface-900 border border-surface-800 rounded-lg shadow-2xl w-[560px] flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-800 flex-shrink-0">
          <h2 className="text-sm font-semibold">Workspace Settings</h2>
          <button
            onClick={onClose}
            className="text-surface-400 hover:text-[var(--text-primary)] text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-800 flex-shrink-0 px-4">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-2 text-xs border-b-2 -mb-px transition-colors ${
                activeTab === t.id
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-surface-600 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 text-xs flex flex-col gap-4">
          {activeTab === 'proxy' && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider text-surface-600 font-medium">
                  Proxy URL
                </label>
                <input
                  value={proxyUrl}
                  onChange={e => setProxyUrl(e.target.value)}
                  placeholder="http://proxy.example.com:8080"
                  className="bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono placeholder-surface-600"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider text-surface-600 font-medium">
                  Proxy Authentication (optional)
                </label>
                <div className="flex gap-2">
                  <input
                    value={proxyUser}
                    onChange={e => setProxyUser(e.target.value)}
                    placeholder="Username"
                    className="flex-1 bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 placeholder-surface-600"
                  />
                  <input
                    type="password"
                    value={proxyPass}
                    onChange={e => setProxyPass(e.target.value)}
                    placeholder="Password"
                    className="flex-1 bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 placeholder-surface-600"
                  />
                </div>
              </div>
            </>
          )}

          {activeTab === 'tls' && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider text-surface-600 font-medium">
                  CA Certificate path
                </label>
                <input
                  value={caCertPath}
                  onChange={e => setCaCertPath(e.target.value)}
                  placeholder="/path/to/ca.crt"
                  className="bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono placeholder-surface-600"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider text-surface-600 font-medium">
                  Client certificate path
                </label>
                <input
                  value={clientCertPath}
                  onChange={e => setClientCertPath(e.target.value)}
                  placeholder="/path/to/client.crt"
                  className="bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono placeholder-surface-600"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider text-surface-600 font-medium">
                  Client key path
                </label>
                <input
                  value={clientKeyPath}
                  onChange={e => setClientKeyPath(e.target.value)}
                  placeholder="/path/to/client.key"
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

          {activeTab === 'privacy' && (
            <>
              <p className="text-surface-600 text-[11px]">
                Header and variable names matching these patterns will be masked in logs and history.
              </p>

              <div className="flex flex-col gap-1">
                {patterns.map(p => (
                  <div
                    key={p}
                    className="flex items-center justify-between px-2.5 py-1 bg-surface-800 rounded border border-surface-700"
                  >
                    <span className="font-mono">{p}</span>
                    <button
                      onClick={() => removePattern(p)}
                      className="text-surface-600 hover:text-red-400 transition-colors text-sm leading-none ml-2"
                      title="Remove pattern"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  value={newPattern}
                  onChange={e => setNewPattern(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addPattern(); }}
                  placeholder="Add pattern…"
                  className="flex-1 bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono placeholder-surface-600"
                />
                <button
                  onClick={addPattern}
                  disabled={!newPattern.trim()}
                  className="px-3 py-1.5 bg-surface-700 hover:bg-surface-600 disabled:opacity-40 rounded transition-colors"
                >
                  Add
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-4 py-3 border-t border-surface-800 flex-shrink-0">
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
