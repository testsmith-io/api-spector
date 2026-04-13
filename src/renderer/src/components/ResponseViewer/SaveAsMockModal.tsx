// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../../store';
import type { MockRoute, ResponsePayload } from '../../../../shared/types';

const { electron } = window;

/** Pull a sensible /path out of a (possibly absolute) URL. */
function extractPath(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    const match = url.match(/(?:https?:\/\/[^/]+)?(\/[^?]*)/);
    return match?.[1] ?? '/';
  }
}

export function SaveAsMockModal({ onClose }: { onClose: () => void }) {
  const mocks = useStore(s => s.mocks);
  const addMock = useStore(s => s.addMock);
  const updateMock = useStore(s => s.updateMock);
  const collections = useStore(s => s.collections);
  const activeTab = useStore(s => s.tabs.find(t => t.id === s.activeTabId));
  const response = (activeTab?.lastResponse ?? null) as ResponsePayload | null;

  const activeRequestId = activeTab?.requestId ?? null;

  // Get the active request for method + URL
  const activeRequest = activeRequestId
    ? Object.values(collections).find(c => c.data.requests[activeRequestId])?.data.requests[activeRequestId]
    : null;

  const [targetMockId, setTargetMockId] = useState<string>(Object.keys(mocks)[0] ?? '__new__');
  const [newServerName, setNewServerName] = useState('Mock Server');
  const [newServerPort, setNewServerPort] = useState('3900');
  const [method, setMethod] = useState<string>(activeRequest?.method ?? 'GET');
  const [path, setPath] = useState(extractPath(activeRequest?.url ?? '/'));
  const [statusCode, setStatusCode] = useState(response?.status ?? 200);
  const [body, setBody] = useState(() => {
    if (!response) return '';
    try { return JSON.stringify(JSON.parse(response.body), null, 2); } catch { return response.body; }
  });
  const [saving, setSaving] = useState(false);

  const mockList = Object.values(mocks);
  const isNew = targetMockId === '__new__' || mockList.length === 0;

  async function save() {
    setSaving(true);
    try {
      const route: MockRoute = {
        id: uuidv4(),
        method: method as MockRoute['method'],
        path,
        statusCode,
        headers: {},
        body,
      };

      let serverId = targetMockId;
      if (isNew) {
        addMock();
        const state = useStore.getState();
        serverId = state.activeMockId!;
        const entry = state.mocks[serverId];
        const updated = { ...entry.data, name: newServerName, port: Number(newServerPort), routes: [route] };
        updateMock(serverId, updated);
        await electron.saveMock(entry.relPath, updated);
        const ws = useStore.getState().workspace;
        if (ws) await electron.saveWorkspace(ws);
      } else {
        const entry = useStore.getState().mocks[serverId];
        const updated = { ...entry.data, routes: [...entry.data.routes, route] };
        updateMock(serverId, updated);
        await electron.saveMock(entry.relPath, updated);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-20">
      <div
        className="bg-surface-900 border border-surface-800 rounded-lg shadow-2xl w-[520px] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-800">
          <h2 className="text-sm font-semibold">Save as mock route</h2>
          <button onClick={onClose} className="text-surface-400 hover:text-[var(--text-primary)] text-lg leading-none">×</button>
        </div>

        <div className="px-4 py-4 flex flex-col gap-3 text-xs overflow-y-auto max-h-[70vh]">

          {/* Server selection */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-surface-400 uppercase tracking-wider font-medium">Mock server</label>
            {mockList.length > 0 ? (
              <select
                value={targetMockId}
                onChange={e => setTargetMockId(e.target.value)}
                className="bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                style={{ color: 'var(--text-primary)' }}
              >
                {mockList.map(m => (
                  <option key={m.data.id} value={m.data.id}>{m.data.name} :{m.data.port}</option>
                ))}
                <option value="__new__">+ Create new server</option>
              </select>
            ) : null}
          </div>

          {/* New server fields */}
          {isNew && (
            <div className="flex gap-2">
              <input
                value={newServerName}
                onChange={e => setNewServerName(e.target.value)}
                placeholder="Server name"
                className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              />
              <input
                value={newServerPort}
                onChange={e => setNewServerPort(e.target.value)}
                placeholder="Port"
                className="w-20 bg-surface-800 border border-surface-700 rounded px-2 py-1 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          {/* Route details */}
          <div className="flex gap-2">
            <select
              value={method}
              onChange={e => setMethod(e.target.value)}
              className="bg-surface-800 border border-surface-700 rounded px-2 py-1 font-bold text-[11px] focus:outline-none focus:border-blue-500"
              style={{ color: 'var(--text-primary)' }}
            >
              {['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              value={path}
              onChange={e => setPath(e.target.value)}
              placeholder="/path"
              className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 font-mono focus:outline-none focus:border-blue-500"
            />
            <input
              type="number"
              value={statusCode}
              onChange={e => setStatusCode(Number(e.target.value))}
              className="w-16 bg-surface-800 border border-surface-700 rounded px-2 py-1 font-mono text-center focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Body */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-surface-400 uppercase tracking-wider font-medium">Response body</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={6}
              className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1.5 font-mono text-[11px] focus:outline-none focus:border-blue-500 resize-y"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-surface-800 disabled:text-surface-400 rounded font-medium transition-colors"
            >
              {saving ? 'Saving…' : 'Add route'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-surface-800 hover:bg-surface-700 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
