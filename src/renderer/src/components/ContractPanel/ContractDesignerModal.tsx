// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useState } from 'react';
import { useStore } from '../../store';
import { Modal } from '../common/Modal';
import { useToast, Toast } from '../common/Toast';
import { designContractToMock } from '../../../../shared/design-mock';
import type { ConsumerContract, DesignInteraction, Workspace, MockServer, KeyValuePair } from '../../../../shared/types';

const { electron } = window;

// Design-first Consumer-Driven Contract authoring. You describe the requests a
// consumer will make and the responses it needs — before any endpoint exists —
// then publish the compiled pact to API Spector Cloud, where the provider
// verifies it and `deploy-check` gates on it.

function uid(): string {
  try { return crypto.randomUUID(); } catch { return `id-${Date.now()}-${Math.floor(performance.now())}`; }
}

function newInteraction(): DesignInteraction {
  return {
    id: uid(),
    description: 'get a resource',
    request: { method: 'GET', path: '/resource/{id}', headers: [] },
    response: { status: 200, body: '{\n  "id": 1\n}' },
  };
}

function newContract(): ConsumerContract {
  return { id: uid(), consumer: 'my-consumer', provider: 'my-provider', interactions: [newInteraction()] };
}

/** Editable key/value rows (query params, headers). Compiles into the pact. */
function KVRows({ label, rows, onChange, keyPlaceholder = 'name', valuePlaceholder = 'value' }: {
  label: string;
  rows: KeyValuePair[] | undefined;
  onChange: (rows: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const list = rows ?? [];
  const set = (i: number, patch: Partial<KeyValuePair>) => onChange(list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-surface-500">{label}</span>
      {list.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input value={r.key} onChange={e => set(i, { key: e.target.value })} placeholder={keyPlaceholder} spellCheck={false}
            className="flex-1 min-w-0 text-[11px] font-mono bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500" />
          <input value={r.value} onChange={e => set(i, { value: e.target.value })} placeholder={valuePlaceholder} spellCheck={false}
            className="flex-1 min-w-0 text-[11px] font-mono bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500" />
          <button onClick={() => onChange(list.filter((_, j) => j !== i))} className="text-surface-600 hover:text-red-400 text-xs px-0.5" title="Remove">✕</button>
        </div>
      ))}
      <button onClick={() => onChange([...list, { key: '', value: '', enabled: true }])} className="self-start text-[11px] text-blue-400 hover:text-blue-300">+ add</button>
    </div>
  );
}

export function ContractDesignerModal({ onClose }: { onClose: () => void }) {
  const workspace     = useStore(s => s.workspace);
  const workspacePath = useStore(s => s.workspacePath);
  const setWorkspace  = useStore(s => s.setWorkspace);
  const addMock       = useStore(s => s.addMock);
  const updateMock    = useStore(s => s.updateMock);
  const cloudConnected = useStore(s => Boolean(s.workspace?.settings?.cloud?.enabled));
  const { toast, show } = useToast();

  const contracts = workspace?.designContracts ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(contracts[0]?.id ?? null);
  const [version, setVersion] = useState('0.1.0');
  const [busy, setBusy] = useState(false);

  const selected = contracts.find(c => c.id === selectedId) ?? null;

  // Persist the whole list through the normal workspace-save path (writes the
  // .spector file as-is, so designContracts travel with the workspace).
  async function persist(next: ConsumerContract[]) {
    if (!workspace) return;
    const updated: Workspace = { ...workspace, designContracts: next };
    setWorkspace(updated, workspacePath ?? '');
    try { await electron.saveWorkspace(updated); } catch (e) { show((e as Error).message, false); }
  }

  function upsert(contract: ConsumerContract) {
    const stamped = { ...contract, updatedAt: new Date().toISOString() };
    const exists = contracts.some(c => c.id === contract.id);
    persist(exists ? contracts.map(c => (c.id === contract.id ? stamped : c)) : [...contracts, stamped]);
  }

  function addContract() {
    const c = newContract();
    setSelectedId(c.id);
    persist([...contracts, c]);
  }

  function deleteContract(id: string) {
    const next = contracts.filter(c => c.id !== id);
    if (selectedId === id) setSelectedId(next[0]?.id ?? null);
    persist(next);
  }

  function patchInteraction(ix: number, patch: Partial<DesignInteraction>) {
    if (!selected) return;
    const interactions = selected.interactions.map((it, i) => (i === ix ? { ...it, ...patch } : it));
    upsert({ ...selected, interactions });
  }

  async function saveLocally() {
    if (!selected) return;
    try {
      const relPath = await electron.exportDesignPact(selected);
      if (relPath) show(`Saved ${relPath} in the workspace`, true);
    } catch (e) {
      show((e as Error).message, false);
    }
  }

  // Turn the contract into a runnable mock the consumer can develop against
  // (no provider). Reuses addMock() so the mock is registered in the workspace,
  // then overwrites it with the contract-derived routes.
  async function createMock() {
    if (!selected) return;
    try {
      addMock();
      const st = useStore.getState();
      const id = st.activeMockId;
      const entry = id ? st.mocks[id] : null;
      if (!id || !entry) { show('Could not create the mock — open a workspace first.', false); return; }
      const mock: MockServer = { ...designContractToMock(selected), id, name: `${selected.consumer} → ${selected.provider} (contract mock)` };
      updateMock(id, mock);
      await electron.saveMock(entry.relPath, mock);
      const ws = useStore.getState().workspace;
      if (ws) await electron.saveWorkspace(ws);
      show(`Created mock with ${mock.routes.length} route${mock.routes.length === 1 ? '' : 's'} — open the Mocks panel to run it`, true);
    } catch (e) {
      show((e as Error).message, false);
    }
  }

  async function publish() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await electron.cloudPushDesignContract({ contract: selected, consumerVersion: version });
      const v = res.verification;
      if (v && !v.success) {
        const failed = v.checks.filter(c => !c.passed).map(c => c.interaction).join(', ');
        show(`Published, but bi-directional check failed: ${failed || 'see matrix'}`, false);
      } else {
        show(`Published ${selected.consumer}@${version} to the cloud`, true);
      }
    } catch (e) {
      show((e as Error).message, false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      title="Contract Designer"
      subtitle="Design a consumer-driven contract up front — no endpoint required — then publish it to API Spector Cloud."
      panelClassName="bg-surface-900 border border-surface-700 rounded-xl w-[min(1000px,94vw)] h-[min(760px,90vh)] flex flex-col"
    >
      <div className="flex flex-1 min-h-0">
        {/* Contract list */}
        <div className="w-56 shrink-0 border-r border-surface-800 flex flex-col">
          <div className="px-3 py-2 border-b border-surface-800 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Contracts</span>
            <button onClick={addContract} className="text-xs text-blue-400 hover:text-blue-300" title="New contract">+ New</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {contracts.length === 0 && (
              <p className="px-3 py-3 text-xs text-surface-500">No contracts yet. Click <span className="text-blue-400">+ New</span>.</p>
            )}
            {contracts.map(c => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-left px-3 py-2 border-b border-surface-800/60 transition-colors ${c.id === selectedId ? 'bg-surface-800' : 'hover:bg-surface-800/50'}`}
              >
                <div className="text-xs text-surface-200 truncate">{c.consumer} <span className="text-surface-600">→</span> {c.provider}</div>
                <div className="text-[10px] text-surface-500">{c.interactions.length} interaction{c.interactions.length === 1 ? '' : 's'}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Editor */}
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-surface-500 text-sm">Select or create a contract.</div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Pacticipants + publish */}
            <div className="px-4 py-3 border-b border-surface-800 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-surface-500">Consumer</span>
                <input value={selected.consumer} onChange={e => upsert({ ...selected, consumer: e.target.value })}
                  className="text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1 w-44 focus:outline-none focus:border-blue-500" />
              </label>
              <span className="text-surface-600 pb-1.5">→</span>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-surface-500">Provider</span>
                <input value={selected.provider} onChange={e => upsert({ ...selected, provider: e.target.value })}
                  className="text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1 w-44 focus:outline-none focus:border-blue-500" />
              </label>
              <div className="ml-auto flex items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-surface-500">Version</span>
                  <input value={version} onChange={e => setVersion(e.target.value)}
                    className="text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1 w-24 focus:outline-none focus:border-blue-500" />
                </label>
                <button onClick={createMock}
                  title="Turn this contract into a runnable mock the consumer can develop against (no provider needed)"
                  className="px-3 py-1.5 text-xs border border-surface-600 text-surface-200 hover:border-blue-500 hover:text-white rounded transition-colors whitespace-nowrap">
                  Create mock
                </button>
                <button onClick={saveLocally}
                  title="Write the compiled pact to pacts/ in this workspace (git-committable, no cloud needed)"
                  className="px-3 py-1.5 text-xs border border-surface-600 text-surface-200 hover:border-blue-500 hover:text-white rounded transition-colors whitespace-nowrap">
                  Save to workspace
                </button>
                <button onClick={publish} disabled={busy || !cloudConnected}
                  title={cloudConnected ? 'Publish the compiled pact to API Spector Cloud' : 'Connect to cloud in Settings → Cloud first'}
                  className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-surface-800 disabled:text-surface-600 rounded transition-colors whitespace-nowrap">
                  {busy ? 'Publishing…' : 'Publish to Cloud'}
                </button>
                <button onClick={() => deleteContract(selected.id)}
                  className="px-2 py-1.5 text-xs text-red-400 hover:bg-red-900/30 rounded transition-colors">Delete</button>
              </div>
            </div>
            {!cloudConnected && (
              <p className="px-4 py-1.5 text-[11px] text-amber-400 bg-amber-950/20 border-b border-surface-800">
                Not connected to API Spector Cloud — connect in Settings → Cloud to publish. You can still design and save the contract.
              </p>
            )}

            {/* Interactions */}
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
              {selected.interactions.map((it, ix) => (
                <div key={it.id} className="border border-surface-800 rounded-lg p-3 flex flex-col gap-2.5">
                  <div className="flex items-center gap-2">
                    <input value={it.description} onChange={e => patchInteraction(ix, { description: e.target.value })}
                      placeholder="what this interaction is"
                      className="flex-1 text-xs font-medium bg-transparent border-b border-surface-800 focus:border-blue-500 focus:outline-none py-0.5" />
                    <button onClick={() => upsert({ ...selected, interactions: selected.interactions.filter((_, i) => i !== ix) })}
                      className="text-surface-600 hover:text-red-400 text-xs" title="Remove interaction">✕</button>
                  </div>

                  <div className="flex gap-2">
                    <select value={it.request.method} onChange={e => patchInteraction(ix, { request: { ...it.request, method: e.target.value } })}
                      className="text-xs bg-surface-800 border border-surface-700 rounded px-1.5 py-1 focus:outline-none focus:border-blue-500">
                      {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map(m => <option key={m}>{m}</option>)}
                    </select>
                    <input value={it.request.path} onChange={e => patchInteraction(ix, { request: { ...it.request, path: e.target.value } })}
                      placeholder="/brands/{id}"
                      className="flex-1 text-xs font-mono bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500" />
                  </div>

                  <input value={it.providerState ?? ''} onChange={e => patchInteraction(ix, { providerState: e.target.value })}
                    placeholder="provider state (e.g. &quot;brand 1 exists&quot;) — optional"
                    className="text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500" />

                  <div className="grid grid-cols-2 gap-4">
                    {/* Request contract */}
                    <div className="flex flex-col gap-2.5 border-r border-surface-800 pr-4">
                      <span className="text-[10px] uppercase tracking-wider text-surface-400 font-semibold">Request</span>
                      <KVRows label="Query params" rows={it.request.query}
                        onChange={q => patchInteraction(ix, { request: { ...it.request, query: q } })}
                        keyPlaceholder="e.g. discontinued" valuePlaceholder="true" />
                      <KVRows label="Headers" rows={it.request.headers}
                        onChange={h => patchInteraction(ix, { request: { ...it.request, headers: h } })}
                        keyPlaceholder="Accept" valuePlaceholder="application/json" />
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase tracking-wider text-surface-500">Body (JSON, optional)</span>
                        <textarea value={it.request.body ?? ''} onChange={e => patchInteraction(ix, { request: { ...it.request, body: e.target.value } })}
                          rows={3} placeholder="{ }" spellCheck={false}
                          className="text-[11px] font-mono bg-surface-800 border border-surface-700 rounded px-2 py-1.5 focus:outline-none focus:border-blue-500 resize-y" />
                      </label>
                    </div>

                    {/* Expected response contract */}
                    <div className="flex flex-col gap-2.5">
                      <span className="text-[10px] uppercase tracking-wider text-surface-400 font-semibold flex items-center gap-2">
                        Expected response
                        <input type="number" value={it.response.status} title="expected status code"
                          onChange={e => patchInteraction(ix, { response: { ...it.response, status: Number(e.target.value) || 0 } })}
                          className="w-16 text-[11px] bg-surface-900 border border-surface-700 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500" />
                      </span>
                      <KVRows label="Headers" rows={it.response.headers}
                        onChange={h => patchInteraction(ix, { response: { ...it.response, headers: h } })}
                        keyPlaceholder="Content-Type" valuePlaceholder="application/json" />
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase tracking-wider text-surface-500">Body</span>
                        <textarea value={it.response.body ?? ''} onChange={e => patchInteraction(ix, { response: { ...it.response, body: e.target.value } })}
                          rows={3} placeholder="[{ id: string, name: string, slug: string }]  — or a JSON example" spellCheck={false}
                          className="text-[11px] font-mono bg-surface-800 border border-surface-700 rounded px-2 py-1.5 focus:outline-none focus:border-blue-500 resize-y" />
                        <span className="text-[10px] text-surface-500 leading-relaxed">
                          A JSON example (matched by type when the toggle is on), or a <span className="text-surface-300">type shape</span> to check each property&apos;s type: <span className="font-mono text-surface-300">string, number, integer, boolean, null</span> plus nested <span className="font-mono">{'{ }'}</span> / <span className="font-mono">[ ]</span>. E.g. <span className="font-mono text-surface-300">{'[{ id: string, qty: integer }]'}</span>. Compiles to Pact <span className="font-mono">matchingRules</span>.
                        </span>
                      </label>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-[11px] text-surface-400">
                    <input type="checkbox" checked={it.looseMatch !== false}
                      onChange={e => patchInteraction(ix, { looseMatch: e.target.checked })} className="accent-blue-500" />
                    Match a JSON example by type, not exact value (tolerant — recommended)
                  </label>
                </div>
              ))}
              <button onClick={() => upsert({ ...selected, interactions: [...selected.interactions, newInteraction()] })}
                className="self-start text-xs text-blue-400 hover:text-blue-300">+ Add interaction</button>
            </div>
          </div>
        )}
      </div>
      {toast && <div className="fixed bottom-4 right-4 z-[120] w-96"><Toast toast={toast} /></div>}
    </Modal>
  );
}
