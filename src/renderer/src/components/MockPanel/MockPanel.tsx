// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useState } from 'react';
import { useStore } from '../../store';

const { electron } = window;

export function MockPanel() {
  const mocks         = useStore(s => s.mocks);
  const activeMockId  = useStore(s => s.activeMockId);
  const setActiveMock = useStore(s => s.setActiveMockId);
  const addMock    = useStore(s => s.addMock);
  const deleteMock = useStore(s => s.deleteMock);
  const setRunning     = useStore(s => s.setMockRunning);
  const loadMock       = useStore(s => s.loadMock);

  const recorderOpen          = useStore(s => s.recorderOpen);
  const recorderRunning       = useStore(s => s.recorderRunning);
  const recorderUpstream      = useStore(s => s.recorderUpstream);
  const recorderPort          = useStore(s => s.recorderPort);
  const setRecorderOpen           = useStore(s => s.setRecorderOpen);
  const setRecorderRunning        = useStore(s => s.setRecorderRunning);
  const setRecorderUpstream       = useStore(s => s.setRecorderUpstream);
  const setRecorderPort           = useStore(s => s.setRecorderPort);

  const [recorderError, setRecorderError] = useState('');

  // WSDL import mini-form
  const [wsdlOpen, setWsdlOpen]     = useState(false);
  const [wsdlUrl, setWsdlUrl]       = useState('');
  const [wsdlImporting, setWsdlImporting] = useState(false);
  const [wsdlError, setWsdlError]   = useState('');

  const mockList = Object.values(mocks);

  async function handleImportWsdl() {
    setWsdlError('');
    if (!wsdlUrl.trim()) return;
    setWsdlImporting(true);
    try {
      const existingPorts = mockList.map(m => m.data.port);
      const { mock } = await electron.wsdlImport({ url: wsdlUrl.trim(), existingMockPorts: existingPorts });
      const relPath = `mocks/${mock.id}.mock.json`;
      loadMock(relPath, mock);
      await electron.saveMock(relPath, mock);
      const ws = useStore.getState().workspace;
      if (ws) {
        if (!ws.mocks) ws.mocks = [];
        ws.mocks.push(relPath);
        await electron.saveWorkspace(ws);
      }
      setActiveMock(mock.id);
      setWsdlOpen(false);
      setWsdlUrl('');
    } catch (err) {
      setWsdlError(err instanceof Error ? err.message : String(err));
    } finally {
      setWsdlImporting(false);
    }
  }

  async function handleAddMock() {
    addMock();
    const ws = useStore.getState().workspace;
    if (ws) await electron.saveWorkspace(ws);
    const state = useStore.getState();
    const newId = state.activeMockId;
    if (newId) {
      const entry = state.mocks[newId];
      await electron.saveMock(entry.relPath, entry.data);
      setActiveMock(newId);
    }
  }

  async function handleDelete(e: React.MouseEvent, mockId: string) {
    e.stopPropagation();
    const entry = useStore.getState().mocks[mockId];
    if (!entry) return;
    if (entry.running) await electron.mockStop(mockId);
    deleteMock(mockId);
    const ws = useStore.getState().workspace;
    if (ws) await electron.saveWorkspace(ws);
  }

  async function handleStartRecorder() {
    setRecorderError('');
    try {
      await electron.recordStart({ upstream: recorderUpstream, port: recorderPort });
      setRecorderRunning(true);
    } catch (err) {
      setRecorderError(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleRunning(e: React.MouseEvent, mockId: string) {
    e.stopPropagation();
    const entry = useStore.getState().mocks[mockId];
    if (!entry) return;
    try {
      if (entry.running) {
        await electron.mockStop(mockId);
        setRunning(mockId, false);
      } else {
        const latest = useStore.getState().mocks[mockId].data;
        await electron.saveMock(entry.relPath, latest);
        await electron.mockStart(latest);
        setRunning(mockId, true);
      }
    } catch { /* errors shown in detail panel */ }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* ── Recorder section ── */}
      <div className="border-b border-surface-800 flex-shrink-0">
        <button
          onClick={() => setRecorderOpen(!recorderOpen)}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-surface-800/40 transition-colors"
        >
          <div className="flex items-center gap-1.5">
            {recorderRunning && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
            <span className="text-[10px] font-semibold uppercase tracking-widest text-surface-600">
              Recorder
            </span>
          </div>
          <span className="text-[10px] text-surface-600">{recorderOpen ? '▲' : '▼'}</span>
        </button>

        {recorderOpen && !recorderRunning && (
          <div className="px-3 pb-3 flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-surface-500">Upstream URL</label>
              <input
                value={recorderUpstream}
                onChange={e => setRecorderUpstream(e.target.value)}
                placeholder="https://api.example.com"
                className="w-full bg-surface-900 border border-surface-700 rounded px-2 py-1 text-[11px] text-surface-100 placeholder-surface-600 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-surface-500">Local port</label>
              <input
                type="number"
                value={recorderPort}
                onChange={e => setRecorderPort(Number(e.target.value))}
                className="w-full bg-surface-900 border border-surface-700 rounded px-2 py-1 text-[11px] text-surface-100 focus:outline-none focus:border-blue-500"
              />
            </div>
{recorderError && (
              <p className="text-[10px] text-red-400">{recorderError}</p>
            )}
            <button
              onClick={handleStartRecorder}
              disabled={!recorderUpstream}
              className="w-full py-1 rounded text-[11px] bg-red-900/40 text-red-400 hover:bg-red-800/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ⏺ Start recording
            </button>
          </div>
        )}

        {recorderOpen && recorderRunning && (
          <div className="px-3 pb-2 text-[10px] text-surface-400">
            Recording → {recorderUpstream}
            <span className="ml-2 text-surface-600">(open panel to manage)</span>
          </div>
        )}
      </div>

      {/* ── Mock servers section ── */}
      <div className="px-3 py-2 flex items-center justify-between border-b border-surface-800 flex-shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-surface-600">
          Mock Servers
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setWsdlOpen(o => !o); setWsdlError(''); }}
            className="text-[11px] text-surface-400 hover:text-blue-300 transition-colors"
            title="Generate a mock server from a WSDL"
          >
            Import WSDL
          </button>
          <button
            onClick={handleAddMock}
            className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
          >
            + New
          </button>
        </div>
      </div>

      {wsdlOpen && (
        <div className="px-3 py-2 flex flex-col gap-2 bg-surface-900/40 border-b border-surface-800 flex-shrink-0">
          <input
            value={wsdlUrl}
            onChange={e => setWsdlUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !wsdlImporting) handleImportWsdl(); }}
            placeholder="https://example.com/service?WSDL"
            className="w-full bg-surface-900 border border-surface-700 rounded px-2 py-1 text-[11px] font-mono placeholder-surface-600 focus:outline-none focus:border-blue-500"
          />
          <div className="flex gap-2">
            <button
              onClick={handleImportWsdl}
              disabled={wsdlImporting || !wsdlUrl.trim()}
              className="flex-1 py-1 rounded text-[11px] bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:hover:bg-blue-700 transition-colors"
            >
              {wsdlImporting ? 'Importing…' : 'Generate mock'}
            </button>
            <button
              onClick={() => { setWsdlOpen(false); setWsdlError(''); }}
              className="px-2 py-1 rounded text-[11px] bg-surface-800 hover:bg-surface-700 transition-colors"
            >
              Cancel
            </button>
          </div>
          {wsdlError && <p className="text-[10px] text-red-400">{wsdlError}</p>}
          <p className="text-[10px] text-surface-600 leading-relaxed">
            One dispatch route per service endpoint. SOAPAction (or operation element in the body) selects which response envelope is returned.
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {mockList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
            <p className="text-surface-400 text-xs">No mock servers yet.</p>
            <button
              onClick={handleAddMock}
              className="px-3 py-1.5 bg-surface-800 hover:bg-surface-700 rounded text-xs transition-colors"
            >
              Create mock server
            </button>
          </div>
        ) : (
          mockList.map(entry => {
            const mock    = entry.data;
            const active  = activeMockId === mock.id;
            return (
              <button
                key={mock.id}
                onClick={() => setActiveMock(mock.id)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors border-b border-surface-800/50 group ${
                  active ? 'bg-surface-800' : 'hover:bg-surface-800/50'
                }`}
              >
                {/* Running indicator */}
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  entry.running ? 'bg-emerald-400' : 'bg-surface-700'
                }`} />

                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{mock.name}</div>
                  <div className="text-[10px] text-surface-400 font-mono">
                    :{mock.port} · {(mock.routes ?? []).length} route{(mock.routes ?? []).length !== 1 ? 's' : ''}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={e => toggleRunning(e, mock.id)}
                    className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                      entry.running
                        ? 'text-emerald-400 hover:text-red-400'
                        : 'text-surface-400 hover:text-emerald-400 opacity-0 group-hover:opacity-100'
                    }`}
                    title={entry.running ? 'Stop' : 'Start'}
                  >
                    {entry.running ? '■' : '▶'}
                  </button>
                  <button
                    onClick={e => handleDelete(e, mock.id)}
                    className="text-[10px] px-1 py-0.5 rounded text-surface-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-colors"
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
