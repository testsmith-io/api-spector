// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useState } from 'react';
import { useStore } from '../../store';
import { resolveEnvironmentById } from '../../hooks/useActiveEnvironment';
import { Modal } from '../common/Modal';
import { FuzzResultsPanel } from '../ContractPanel/FuzzResultsPanel';
import type { ApiRequest, FuzzReport } from '../../../../shared/types';

const { electron } = window;

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Per-request fuzzing: hammer THIS request with malformed inputs, inline, using
 * its own URL / auth / environment. Complements the batch fuzz in the Contracts
 * panel (which sweeps the whole workspace against a provider base URL). Both
 * call the same engine; here the request list is just [request].
 */
export function FuzzModal({ request, onClose }: { request: ApiRequest; onClose: () => void }) {
  const environments        = useStore(s => s.environments);
  const activeEnvironmentId = useStore(s => s.activeEnvironmentId);
  const activeCollectionId  = useStore(s => s.activeCollectionId);
  const collections         = useStore(s => s.collections);
  const snapshots           = useStore(s => s.contractSnapshots);
  const activeSnapshotRelPath = useStore(s => s.activeContractSnapshotRelPath);

  const [cases, setCases]       = useState(40);
  const [seed, setSeed]         = useState(1);
  const [trace, setTrace]       = useState(true);
  const [running, setRunning]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [report, setReport]     = useState<FuzzReport | null>(null);

  const isWrite = WRITE_METHODS.has(request.method);
  const snapshotList = Object.entries(snapshots).map(([relPath, s]) => ({ relPath, snapshot: s }));
  const [snapshotRelPath, setSnapshotRelPath] = useState<string>(activeSnapshotRelPath ?? '');

  async function run() {
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      const env = resolveEnvironmentById(environments, activeEnvironmentId);
      const envVars = env
        ? Object.fromEntries(env.variables.filter(v => v.enabled).map(v => [v.key, v.value]))
        : {};
      const collectionVars = activeCollectionId
        ? (collections[activeCollectionId]?.data.collectionVariables ?? {})
        : {};

      const result = await electron.fuzzContracts({
        requests: [request],
        envVars,
        collectionVars,
        specSnapshotRelPath: snapshotRelPath || undefined,
        // No providerBaseUrl: the request is fuzzed against its own URL.
        casesPerOperation: cases,
        seed,
        trace,
        includeWrites: true,   // a per-request run is an explicit choice to fuzz this request
      });
      setReport(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      title={`Fuzz: ${request.name}`}
      subtitle={`${request.method} ${request.url}`}
      panelClassName="bg-surface-900 border border-surface-800 rounded-lg shadow-2xl w-[720px] flex flex-col max-h-[85vh]"
    >
      <div className="flex flex-col min-h-0 flex-1">
        {/* Options */}
        <div className="flex items-end gap-3 px-4 py-3 border-b border-surface-800 flex-shrink-0 flex-wrap">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-surface-600 font-medium">Cases</span>
            <input
              type="number" min={1} value={cases}
              onChange={e => setCases(Math.max(1, Number(e.target.value)))}
              className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs w-20 focus:outline-none focus:border-blue-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-surface-600 font-medium">Seed</span>
            <input
              type="number" value={seed}
              onChange={e => setSeed(Number(e.target.value))}
              className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs w-20 focus:outline-none focus:border-blue-500"
            />
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <span className="text-[10px] uppercase tracking-wider text-surface-600 font-medium">Spec (optional)</span>
            <select
              value={snapshotRelPath}
              onChange={e => setSnapshotRelPath(e.target.value)}
              className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
            >
              <option value="">Request body (no spec)</option>
              {snapshotList.map(({ relPath, snapshot }) => (
                <option key={relPath} value={relPath}>{snapshot.name}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-surface-400 select-none">
            <input type="checkbox" checked={trace} onChange={e => setTrace(e.target.checked)} />
            Record all cases
          </label>
          <button
            onClick={run}
            disabled={running || !request.url}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-surface-800 disabled:text-surface-400 rounded text-sm font-medium transition-colors"
          >
            {running ? 'Fuzzing...' : 'Run fuzz'}
          </button>
        </div>

        {isWrite && (
          <p className="text-[11px] text-amber-400 px-4 py-2 border-b border-surface-800 flex-shrink-0">
            {request.method} sends malformed writes. Point this request at a staging environment or a mock, not production.
          </p>
        )}
        {error && (
          <p className="text-[11px] text-red-400 px-4 py-2 border-b border-surface-800 flex-shrink-0">{error}</p>
        )}

        {/* Results */}
        <div className="flex-1 min-h-0 flex flex-col">
          {report
            ? <FuzzResultsPanel report={report} onClear={() => setReport(null)} />
            : (
              <div className="flex-1 flex items-center justify-center text-center p-8">
                <p className="text-xs text-surface-500">
                  {running
                    ? 'Sending malformed inputs...'
                    : 'Generates malformed variants of this request body and flags responses that crash (5xx) or accept invalid input. Pick a pinned spec for richer inputs, or fuzz the request body as-is.'}
                </p>
              </div>
            )}
        </div>
      </div>
    </Modal>
  );
}
