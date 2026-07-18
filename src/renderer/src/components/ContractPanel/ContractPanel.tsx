// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useState } from 'react';
import { useStore } from '../../store';
import { resolveEnvironmentById } from '../../hooks/useActiveEnvironment';
import type { ContractMode, FuzzReport } from '../../../../shared/types';

const { electron } = window;

/** The contract modes plus the sibling fuzz mode, which is UI-local only. */
type PanelMode = ContractMode | 'fuzz';

interface ContractPanelProps {
  /** Lifted so the parent can decide which results panel to render. */
  fuzzReport: FuzzReport | null;
  setFuzzReport: (report: FuzzReport | null) => void;
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ContractPanel({ fuzzReport, setFuzzReport }: ContractPanelProps) {
  const collections          = useStore(s => s.collections);
  const environments         = useStore(s => s.environments);
  const activeEnvId          = useStore(s => s.activeEnvironmentId);
  const activeCollId         = useStore(s => s.activeCollectionId);
  const report               = useStore(s => s.lastContractReport);
  const setReport            = useStore(s => s.setLastContractReport);
  const snapshots            = useStore(s => s.contractSnapshots);
  const activeSnapshotRelPath = useStore(s => s.activeContractSnapshotRelPath);
  const setActiveSnapshot    = useStore(s => s.setActiveContractSnapshot);
  const loadContractSnapshot  = useStore(s => s.loadContractSnapshot);
  const removeContractSnapshot = useStore(s => s.removeContractSnapshot);
  const workspace = useStore(s => s.workspace);

  const [mode, setMode]               = useState<PanelMode>('consumer');
  const [specUrl, setSpecUrl]         = useState('');
  const [requestBaseUrl, setRequestBaseUrl] = useState('');
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [stateHandlerUrl, setStateHandlerUrl] = useState('');
  const [running, setRunning]         = useState(false);
  const [capturing, setCapturing]     = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // Fuzz-specific options (fuzz is a sibling feature, kept out of the contract store).
  const [casesPerOperation, setCasesPerOperation] = useState(40);
  const [seed, setSeed]                 = useState(1);
  const [includeWrites, setIncludeWrites] = useState(false);
  const [strictStatus, setStrictStatus] = useState(false);
  const [checkResponses, setCheckResponses] = useState(false);
  const [trace, setTrace] = useState(false);

  const snapshotList = Object.entries(snapshots)
    .map(([relPath, snapshot]) => ({ relPath, snapshot }))
    .sort((a, b) => b.snapshot.capturedAt.localeCompare(a.snapshot.capturedAt));
  const activeSnapshot = activeSnapshotRelPath ? snapshots[activeSnapshotRelPath] ?? null : null;

  const allRequests = Object.values(collections).flatMap(c => Object.values(c.data.requests));
  const contractRequests = allRequests.filter(r =>
    r.contract && (r.contract.statusCode !== undefined || r.contract.bodySchema || r.contract.bodyMatcher || r.contract.headers?.length),
  );
  const isFuzz = mode === 'fuzz';
  const needsSpec = mode === 'provider' || mode === 'bidirectional';
  // Fuzz can use a spec (mutating spec-derived inputs) but also works without one.
  const showSpec = needsSpec || isFuzz;
  const collectionVars = activeCollId
    ? (collections[activeCollId]?.data.collectionVariables ?? {})
    : {};
  const resolvedEnv = resolveEnvironmentById(environments, activeEnvId);
  const envVars = resolvedEnv
    ? Object.fromEntries(
        resolvedEnv.variables
          .filter(v => v.enabled)
          .map(v => [v.key, v.value]),
      )
    : {};

  async function runContracts() {
    if (mode === 'fuzz') return; // fuzz has its own runner
    // Spec-driven modes need a live URL or a pinned snapshot.
    if (needsSpec && !specUrl.trim() && !activeSnapshotRelPath) {
      setError('Provide an OpenAPI spec URL or pick a pinned snapshot for provider / bi-directional mode.');
      return;
    }
    // Live provider verification needs a provider base URL to replay against.
    if (mode === 'provider-live' && !providerBaseUrl.trim()) {
      setError('Provide a provider base URL (e.g. http://localhost:3000) to replay contracts against.');
      return;
    }
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      const requests = mode === 'provider'
        ? allRequests          // provider validates ALL requests against spec
        : contractRequests;     // consumer / provider-live / bidirectional only run requests with contracts
      const result = await electron.runContracts({
        mode,
        requests,
        envVars,
        collectionVars,
        specUrl:             specUrl.trim() || undefined,
        specSnapshotRelPath: activeSnapshotRelPath ?? undefined,
        requestBaseUrl:      requestBaseUrl.trim() || undefined,
        providerBaseUrl:     providerBaseUrl.trim() || undefined,
        stateHandlerUrl:     stateHandlerUrl.trim() || undefined,
      });
      // Label the run context so the exported HTML report header is filled in
      // (the CLI gets the same info from its flags).
      const activeSnap = activeSnapshotRelPath ? snapshots[activeSnapshotRelPath] : undefined;
      const specLabel = activeSnap
        ? `${activeSnap.name}${activeSnap.specVersion ? ` v${activeSnap.specVersion}` : ''} (pinned)`
        : specUrl.trim() || undefined;
      setReport(result, {
        spec: needsSpec ? specLabel : undefined,
        provider: providerBaseUrl.trim() || undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function runFuzz() {
    // Fuzzing replays live requests, so it always needs a provider base URL.
    if (!providerBaseUrl.trim()) {
      setError('Provide a provider base URL (e.g. http://localhost:3000) to fuzz against.');
      return;
    }
    setRunning(true);
    setError(null);
    setFuzzReport(null);
    try {
      const result = await electron.fuzzContracts({
        requests: allRequests, // fuzz every request in the workspace, like provider mode
        envVars,
        collectionVars,
        specUrl:             specUrl.trim() || undefined,
        specSnapshotRelPath: activeSnapshotRelPath ?? undefined,
        providerBaseUrl:     providerBaseUrl.trim(),
        requestBaseUrl:      requestBaseUrl.trim() || undefined,
        casesPerOperation,
        seed,
        includeWrites,
        strictStatus,
        checkResponses,
        trace,
      });
      setFuzzReport(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function captureSnapshot() {
    if (!specUrl.trim()) {
      setError('Enter a spec URL before pinning a snapshot.');
      return;
    }
    setCapturing(true);
    setError(null);
    try {
      const { relPath, snapshot } = await electron.captureContractSnapshot({ specUrl: specUrl.trim() });
      loadContractSnapshot(relPath, snapshot);
      setActiveSnapshot(relPath);
      // Persist workspace so `contracts` array is saved to disk.
      const ws = useStore.getState().workspace;
      if (ws) await electron.saveWorkspace(ws);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCapturing(false);
    }
  }

  async function deleteActiveSnapshot() {
    if (!activeSnapshotRelPath) return;
    const relPath = activeSnapshotRelPath;
    try {
      await electron.deleteContractSnapshot(relPath);
      removeContractSnapshot(relPath);
      const ws = useStore.getState().workspace;
      if (ws) await electron.saveWorkspace(ws);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Config area */}
      <div className="flex flex-col gap-3 px-3 py-3 border-b border-surface-800 flex-shrink-0">
        {/* Mode tabs */}
        <div className="flex gap-1 bg-surface-800 rounded-lg p-0.5">
          {([
            ['consumer', 'Consumer'],
            ['provider', 'Provider'],
            ['provider-live', 'Live'],
            ['bidirectional', 'Bi-dir'],
            ['fuzz', 'Fuzz'],
          ] as [PanelMode, string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => { setMode(m); setReport(null); setFuzzReport(null); }}
              className={`flex-1 py-1 text-[10px] font-semibold rounded transition-colors ${
                mode === m ? 'bg-blue-600 text-white' : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Mode description */}
        <p className="text-[10px] text-surface-500 leading-relaxed">
          {mode === 'consumer'
            ? 'Sends requests to the real provider and validates each response against the contract defined in the Contract tab.'
            : mode === 'provider'
            ? 'Static analysis: validates that your requests conform to the provider\'s published OpenAPI spec (no HTTP calls).'
            : mode === 'provider-live'
            ? 'Replays each contract against a running provider, seeding provider states first. The real provider verification.'
            : mode === 'fuzz'
            ? 'Sends malformed inputs generated from the spec (or, with no spec, the request body) and flags responses that crash (5xx) or accept invalid input.'
            : 'Checks static schema compatibility between consumer contracts and provider spec, then verifies live responses.'}
        </p>

        {/* Provider base URL + state handler (provider-live / fuzz) */}
        {(mode === 'provider-live' || isFuzz) && (
          <div className="flex flex-col gap-2">
            <div>
              <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium block mb-1">
                Provider base URL
              </label>
              <input
                value={providerBaseUrl}
                onChange={e => setProviderBaseUrl(e.target.value)}
                placeholder="http://localhost:3000"
                className="w-full text-xs bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono placeholder-surface-600"
              />
              <p className="text-[10px] text-surface-600 mt-1 leading-relaxed">
                {isFuzz
                  ? 'Required. Each fuzzed request is rebased onto this origin before it is sent.'
                  : 'Each request is rebased onto this origin before being replayed against the live provider.'}
              </p>
            </div>
            {mode === 'provider-live' && (
            <div>
              <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium block mb-1">
                State handler URL <span className="normal-case text-surface-600">(optional)</span>
              </label>
              <input
                value={stateHandlerUrl}
                onChange={e => setStateHandlerUrl(e.target.value)}
                placeholder="http://localhost:3000/_pact/provider-states"
                className="w-full text-xs bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono placeholder-surface-600"
              />
              <p className="text-[10px] text-surface-600 mt-1 leading-relaxed">
                Before each interaction we POST {'{ state, action }'} here so the provider can be seeded into a known state (Pact <code>given</code>).
              </p>
            </div>
            )}
          </div>
        )}

        {/* Spec source (provider / bidirectional / fuzz) */}
        {showSpec && (
          <div className="flex flex-col gap-2">
            {/* Snapshot picker */}
            <div>
              <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium block mb-1">
                Spec version {isFuzz && <span className="normal-case text-surface-600">(optional)</span>}
              </label>
              <div className="flex gap-1">
                <select
                  value={activeSnapshotRelPath ?? ''}
                  onChange={e => setActiveSnapshot(e.target.value || null)}
                  disabled={!workspace}
                  className="flex-1 text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1.5 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  <option value="">Live URL (latest from provider)</option>
                  {snapshotList.map(({ relPath, snapshot }) => (
                    <option key={relPath} value={relPath}>
                      {snapshot.name}
                      {snapshot.specVersion ? '' : ` - ${snapshot.capturedAt.slice(0, 10)}`}
                    </option>
                  ))}
                </select>
                {activeSnapshotRelPath && (
                  <button
                    onClick={deleteActiveSnapshot}
                    title="Delete this snapshot"
                    className="px-2 text-xs text-surface-500 hover:text-red-400 bg-surface-800 hover:bg-surface-700 rounded transition-colors"
                  >
                    ✕
                  </button>
                )}
              </div>
              {activeSnapshot && (
                <p className="text-[10px] text-surface-600 mt-1 font-mono truncate">
                  Captured {activeSnapshot.capturedAt.slice(0, 19).replace('T', ' ')} - sha {activeSnapshot.sha256.slice(0, 8)}
                </p>
              )}
            </div>

            {/* Live URL (only meaningful when no snapshot is pinned) */}
            {!activeSnapshotRelPath && (
              <div>
                <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium block mb-1">
                  OpenAPI Spec URL
                </label>
                <div className="flex gap-1">
                  <input
                    value={specUrl}
                    onChange={e => setSpecUrl(e.target.value)}
                    placeholder="https://api.example.com/openapi.json"
                    className="flex-1 text-xs bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono placeholder-surface-600"
                  />
                  <button
                    onClick={captureSnapshot}
                    disabled={capturing || !specUrl.trim() || !workspace}
                    title="Fetch and pin this spec as a versioned snapshot"
                    className="px-2.5 text-xs bg-surface-800 hover:bg-surface-700 disabled:opacity-50 disabled:hover:bg-surface-800 rounded transition-colors"
                  >
                    {capturing ? '…' : 'Pin'}
                  </button>
                </div>
                <p className="text-[10px] text-surface-600 mt-1 leading-relaxed">
                  Pin a snapshot to run against a specific spec version later, even after the provider ships an update.
                </p>
              </div>
            )}

            <div>
              <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium block mb-1">
                Request base URL <span className="normal-case text-surface-600">(optional)</span>
              </label>
              <input
                value={requestBaseUrl}
                onChange={e => setRequestBaseUrl(e.target.value)}
                placeholder="https://api.example.com"
                className="w-full text-xs bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono placeholder-surface-600"
              />
              <p className="text-[10px] text-surface-600 mt-1 leading-relaxed">
                If your requests point at a different host than the spec, enter that host here so paths match correctly.
              </p>
            </div>
          </div>
        )}

        {/* Fuzz options */}
        {isFuzz && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium block mb-1">
                  Cases per operation
                </label>
                <input
                  type="number"
                  min={1}
                  value={casesPerOperation}
                  onChange={e => setCasesPerOperation(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full text-xs bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium block mb-1">
                  Seed
                </label>
                <input
                  type="number"
                  value={seed}
                  onChange={e => setSeed(Number(e.target.value) || 0)}
                  className="w-full text-xs bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-[11px] text-surface-300 cursor-pointer">
              <input
                type="checkbox"
                checked={includeWrites}
                onChange={e => setIncludeWrites(e.target.checked)}
                className="accent-blue-600"
              />
              Include write methods (POST/PUT/PATCH/DELETE)
            </label>
            {includeWrites && (
              <p className="text-[10px] text-amber-400 leading-relaxed -mt-1 ml-6">
                This sends malformed writes to the provider. Target staging or a mock, not production.
              </p>
            )}

            <label className="flex items-center gap-2 text-[11px] text-surface-300 cursor-pointer">
              <input
                type="checkbox"
                checked={strictStatus}
                onChange={e => setStrictStatus(e.target.checked)}
                className="accent-blue-600"
              />
              Strict status
            </label>

            <label className="flex items-center gap-2 text-[11px] text-surface-300 cursor-pointer">
              <input
                type="checkbox"
                checked={checkResponses}
                onChange={e => setCheckResponses(e.target.checked)}
                className="accent-blue-600"
              />
              Check response schemas
            </label>

            <label className="flex items-center gap-2 text-[11px] text-surface-300 cursor-pointer">
              <input
                type="checkbox"
                checked={trace}
                onChange={e => setTrace(e.target.checked)}
                className="accent-blue-600"
              />
              Record all cases
            </label>
          </div>
        )}

        {/* Summary */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-surface-500">
            {mode === 'provider' || isFuzz
              ? `${allRequests.length} request${allRequests.length !== 1 ? 's' : ''}`
              : `${contractRequests.length} contract${contractRequests.length !== 1 ? 's' : ''} defined`}
          </span>
          <button
            onClick={isFuzz ? runFuzz : runContracts}
            disabled={running
              || (needsSpec && !specUrl.trim() && !activeSnapshotRelPath)
              || ((mode === 'provider-live' || isFuzz) && !providerBaseUrl.trim())}
            className="px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-surface-800 disabled:text-surface-600 rounded transition-colors font-medium"
          >
            {running ? 'Running…' : isFuzz ? 'Run fuzz' : 'Run'}
          </button>
        </div>

        {error && <p className="text-[11px] text-red-400">{error}</p>}
      </div>

      {/* Status / hint */}
      <div className="flex-1 overflow-y-auto min-h-0 p-3">
        {running && (
          <p className="text-xs text-surface-500 text-center mt-4">Running…</p>
        )}
        {isFuzz ? (
          !fuzzReport && !running && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
              <p className="text-xs text-surface-500">Configure fuzzing above and click Run fuzz.</p>
              <p className="text-[10px] text-surface-600 max-w-[180px]">
                Fuzzing needs a provider base URL. A spec is optional: without one, request bodies are mutated.
              </p>
            </div>
          )
        ) : (
          <>
            {!report && !running && (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                <p className="text-xs text-surface-500">Configure a mode above and click Run.</p>
                {mode !== 'provider' && contractRequests.length === 0 && (
                  <p className="text-[10px] text-surface-600 max-w-[180px]">
                    Define a contract on a request via the Contract tab first.
                  </p>
                )}
              </div>
            )}
            {report && !running && (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${
                report.failed === 0
                  ? 'bg-emerald-800/30 border-emerald-400/50 text-emerald-400'
                  : 'bg-red-900/30 border-red-700 text-red-300'
              }`}>
                <span className="font-semibold">{report.failed === 0 ? '✓ All passed' : `✗ ${report.failed} failed`}</span>
                <span className="text-surface-500 ml-auto">{report.passed}/{report.total}</span>
              </div>
            )}
          </>
        )}
        {isFuzz && fuzzReport && !running && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${
            fuzzReport.totalFindings === 0
              ? 'bg-emerald-800/30 border-emerald-400/50 text-emerald-400'
              : 'bg-red-900/30 border-red-700 text-red-300'
          }`}>
            <span className="font-semibold">
              {fuzzReport.totalFindings === 0
                ? '✓ No findings'
                : `✗ ${fuzzReport.totalFindings} finding${fuzzReport.totalFindings !== 1 ? 's' : ''}`}
            </span>
            <span className="text-surface-500 ml-auto">{fuzzReport.totalCases} cases</span>
          </div>
        )}
      </div>
    </div>
  );
}
