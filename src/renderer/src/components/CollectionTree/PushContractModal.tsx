// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { useStore } from '../../store';
import { hasContract, pushContractToCloud, pushProviderSpecToCloud, openCloudMatrix } from '../../lib/cloud-push';
import { getMethodColor } from '../../../../shared/colors';
import type { ApiRequest } from '../../../../shared/types';

/** Push a contract to the cloud broker: either a consumer pact built from the
 *  requests that carry a contract, or a provider OpenAPI spec (from a pinned
 *  contract snapshot) for bi-directional testing. */
export function PushContractModal({ requests, defaultConsumer, onClose }: {
  requests: ApiRequest[];
  defaultConsumer: string;
  onClose: () => void;
}) {
  const snapshots = useStore(s => s.contractSnapshots);
  const snapshotEntries = Object.entries(snapshots);
  const withContract = requests.filter(hasContract);

  const [mode, setMode] = useState<'consumer' | 'provider'>('consumer');
  const [consumer, setConsumer] = useState(defaultConsumer);
  const [provider, setProvider] = useState('');
  const [version, setVersion] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set(withContract.map(r => r.id)));
  const [pacticipant, setPacticipant] = useState('');
  const [snapshotPath, setSnapshotPath] = useState(snapshotEntries[0]?.[0] ?? '');
  // After a push we show the verification outcome (ok=green, warn=published but
  // not verified, err=failed) so the loop is visible without leaving the app.
  const [status, setStatus] = useState<{ state: 'idle' | 'pushing' | 'ok' | 'warn' | 'err'; msg?: string; detail?: string[] }>({ state: 'idle' });

  function toggle(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const canPush = mode === 'consumer'
    ? Boolean(consumer.trim() && provider.trim() && version.trim() && selected.size)
    : Boolean(pacticipant.trim() && version.trim() && snapshotPath);

  async function push() {
    setStatus({ state: 'pushing' });
    try {
      if (mode === 'consumer') {
        const chosen = withContract.filter(r => selected.has(r.id));
        const r = await pushContractToCloud(chosen, { consumer: consumer.trim(), provider: provider.trim(), version: version.trim() });
        const published = `Published ${consumer} → ${provider} (${chosen.length} interactions).`;
        if (!r.verification) {
          setStatus({ state: 'warn', msg: `${published} Not verified yet: ${provider} has not published its OpenAPI spec.` });
        } else if (r.verification.success) {
          setStatus({ state: 'ok', msg: `${published} Compatible with ${provider}. ✓` });
        } else {
          const failing = r.verification.checks.filter(c => !c.passed);
          setStatus({ state: 'err', msg: `${published} NOT compatible with ${provider} (${failing.length} failing).`, detail: failing.map(c => `${c.interaction}: ${c.error}`) });
        }
      } else {
        const spec = snapshots[snapshotPath]?.spec ?? '';
        const r = await pushProviderSpecToCloud({ pacticipant: pacticipant.trim(), version: version.trim(), spec });
        const failing = r.results.filter(x => !x.success);
        if (r.results.length === 0) {
          setStatus({ state: 'warn', msg: `Published ${pacticipant} spec. No consumer contracts to verify yet.` });
        } else if (failing.length === 0) {
          setStatus({ state: 'ok', msg: `Published ${pacticipant} spec. All ${r.results.length} consumer contract(s) compatible. ✓` });
        } else {
          setStatus({ state: 'err', msg: `Published ${pacticipant} spec. ${failing.length} of ${r.results.length} consumer(s) now incompatible.`, detail: failing.map(x => `${x.consumer} ${x.version}`) });
        }
      }
    } catch (e) {
      setStatus({ state: 'err', msg: (e as Error).message });
    }
  }

  return (
    <Modal
      onClose={onClose}
      overlayClassName="bg-black/50 z-50 flex items-start justify-center pt-24"
      panelClassName="bg-surface-900 border border-surface-800 rounded-lg shadow-2xl w-[520px] flex flex-col max-h-[75vh]"
      title="Push contract to cloud"
    >
      {/* Mode */}
      <div className="flex gap-1 px-4 pt-3 flex-shrink-0">
        {(['consumer', 'provider'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            disabled={m === 'provider' && snapshotEntries.length === 0}
            className={`px-3 py-1.5 text-xs rounded transition-colors disabled:opacity-30 ${
              mode === m ? 'bg-blue-600 text-white' : 'bg-surface-800 hover:bg-surface-700 text-surface-300'
            }`}
          >
            {m === 'consumer' ? 'Consumer pact' : 'Provider spec (OpenAPI)'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 text-xs">
        {mode === 'consumer' ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1"><span className="text-surface-500">Consumer</span>
                <input value={consumer} onChange={e => setConsumer(e.target.value)} className="bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500" /></label>
              <label className="flex flex-col gap-1"><span className="text-surface-500">Provider</span>
                <input value={provider} onChange={e => setProvider(e.target.value)} placeholder="orders-api" className="bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 placeholder-surface-600" /></label>
            </div>
            <label className="flex flex-col gap-1"><span className="text-surface-500">Version <span className="text-surface-600">(git sha / build)</span></span>
              <input value={version} onChange={e => setVersion(e.target.value)} placeholder="1.4.0" className="bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 placeholder-surface-600" /></label>

            <div>
              <div className="text-surface-500 mb-1.5">Interactions <span className="text-surface-600">(requests with a contract)</span></div>
              {withContract.length === 0 ? (
                <p className="text-surface-500 px-1 py-3">No requests here have a contract yet. Add expected status/schema on a request's Contract tab first.</p>
              ) : (
                <div className="rounded-lg border border-surface-800 max-h-56 overflow-y-auto">
                  {withContract.map(r => (
                    <label key={r.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-surface-800/50 cursor-pointer">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="accent-blue-500" />
                      <span className="font-mono font-semibold w-12 flex-shrink-0" style={{ color: getMethodColor(r.method) }}>{r.method}</span>
                      <span className="text-surface-300 truncate">{r.name}</span>
                      {r.contract?.statusCode && <span className="ml-auto text-surface-500 flex-shrink-0">{r.contract.statusCode}</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-surface-500">Publishes a pinned OpenAPI spec as the provider contract. Consumer pacts are then verified against it without running the provider.</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1"><span className="text-surface-500">Provider (pacticipant)</span>
                <input value={pacticipant} onChange={e => setPacticipant(e.target.value)} placeholder="orders-api" className="bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 placeholder-surface-600" /></label>
              <label className="flex flex-col gap-1"><span className="text-surface-500">Version</span>
                <input value={version} onChange={e => setVersion(e.target.value)} placeholder="2.1.0" className="bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 placeholder-surface-600" /></label>
            </div>
            <label className="flex flex-col gap-1"><span className="text-surface-500">Spec snapshot</span>
              <select value={snapshotPath} onChange={e => setSnapshotPath(e.target.value)} className="bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500">
                {snapshotEntries.map(([path, snap]) => <option key={path} value={path}>{snap.name ?? path}</option>)}
              </select></label>
          </>
        )}
      </div>

      {(status.state === 'ok' || status.state === 'warn' || status.state === 'err') && status.detail?.length ? (
        <div className="mx-4 mb-2 px-3 py-2 rounded bg-surface-800/60 border border-surface-700 text-[11px] text-surface-300 max-h-24 overflow-y-auto flex-shrink-0">
          {status.detail.map((d, i) => <div key={i} className="font-mono truncate">• {d}</div>)}
        </div>
      ) : null}

      <div className="px-4 py-3 border-t border-surface-800 flex items-center gap-2 flex-shrink-0">
        {status.state === 'ok' || status.state === 'warn' || status.state === 'err' ? (
          <>
            <span className={`text-[11px] flex-1 ${status.state === 'ok' ? 'text-green-400' : status.state === 'warn' ? 'text-amber-400' : 'text-red-400'}`}>
              {status.state === 'ok' ? '✓' : status.state === 'warn' ? '⚠' : '✗'} {status.msg}
            </span>
            <button onClick={() => openCloudMatrix()} className="px-3 py-1.5 bg-surface-800 hover:bg-surface-700 rounded text-xs">View matrix ↗</button>
            <button onClick={onClose} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium">Done</button>
          </>
        ) : (
          <>
            <button onClick={push} disabled={!canPush || status.state === 'pushing'} className="ml-auto px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-xs font-medium">
              {status.state === 'pushing' ? 'Publishing…' : 'Publish'}
            </button>
            <button onClick={onClose} className="px-4 py-1.5 bg-surface-800 hover:bg-surface-700 rounded text-xs">Cancel</button>
          </>
        )}
      </div>
    </Modal>
  );
}
