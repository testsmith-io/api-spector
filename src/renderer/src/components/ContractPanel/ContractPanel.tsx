// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useState } from 'react';
import { useStore } from '../../store';
import { resolveEnvironmentById } from '../../hooks/useActiveEnvironment';
import { useT } from '../../i18n';
import type { ContractMode } from '../../../../shared/types';

const { electron } = window;

// Tabs shown in the panel. "Live" (provider-live) is no longer a peer tab; it
// is folded into Consumer as a toggle (verify against a running provider and
// seed provider states). Fuzzing is no longer a contract mode — it lives on the
// per-request fuzz button (and the CLI) instead.
type PanelTab = 'consumer' | 'provider' | 'bidirectional';

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ContractPanel() {
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
  const openContractDesigner = useStore(s => s.openContractDesigner);
  const t = useT();

  const [tab, setTab]                   = useState<PanelTab>('consumer');
  // Consumer sub-option: replay against a running provider and seed provider
  // states (the old "Live" / provider-live mode).
  const [liveVerify, setLiveVerify]     = useState(false);
  const cloudConnected = useStore(s => Boolean(s.workspace?.settings?.cloud?.enabled));
  const [providerName, setProviderName] = useState('');
  const [specVersion, setSpecVersion]   = useState('');
  const [publishingSpec, setPublishingSpec] = useState(false);
  const [publishNote, setPublishNote]   = useState<string | null>(null);
  const [specUrl, setSpecUrl]           = useState('');
  const [requestBaseUrl, setRequestBaseUrl] = useState('');
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [stateHandlerUrl, setStateHandlerUrl] = useState('');
  const [running, setRunning]           = useState(false);
  const [capturing, setCapturing]       = useState(false);
  const [error, setError]               = useState<string | null>(null);

  // The effective backend mode. Consumer + liveVerify becomes provider-live.
  const mode: ContractMode = tab === 'consumer' && liveVerify ? 'provider-live' : tab;
  const needsSpec = tab === 'provider' || tab === 'bidirectional';

  async function publishSpecToCloud() {
    setError(null); setPublishNote(null); setPublishingSpec(true);
    try {
      const res = await electron.cloudPushSpec({
        pacticipant: providerName.trim(),
        version: specVersion.trim(),
        specUrl: specUrl.trim(),
      });
      setPublishNote(t('Published :name@:version - :count contract(s) re-verified', { name: providerName.trim(), version: specVersion.trim(), count: res.verified_contracts }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishingSpec(false);
    }
  }

  const snapshotList = Object.entries(snapshots)
    .map(([relPath, snapshot]) => ({ relPath, snapshot }))
    .sort((a, b) => b.snapshot.capturedAt.localeCompare(a.snapshot.capturedAt));
  const activeSnapshot = activeSnapshotRelPath ? snapshots[activeSnapshotRelPath] ?? null : null;

  const allRequests = Object.values(collections).flatMap(c => Object.values(c.data.requests));
  const contractRequests = allRequests.filter(r =>
    r.contract && (r.contract.statusCode !== undefined || r.contract.bodySchema || r.contract.bodyMatcher || r.contract.headers?.length),
  );
  // Design-first contracts (authored in the Designer) run too, without a manual
  // pact-import; count their interactions so the panel reflects what will run.
  const designInteractionCount = (workspace?.designContracts ?? [])
    .reduce((n, cc) => n + cc.interactions.length, 0);
  const collectionVars = activeCollId
    ? (collections[activeCollId]?.data.collectionVariables ?? {})
    : {};
  const resolvedEnv = resolveEnvironmentById(environments, activeEnvId);
  const envVars = resolvedEnv
    ? Object.fromEntries(resolvedEnv.variables.filter(v => v.enabled).map(v => [v.key, v.value]))
    : {};

  async function runContracts() {
    // Spec-driven modes need a live URL or a pinned snapshot.
    if (needsSpec && !specUrl.trim() && !activeSnapshotRelPath) {
      setError(t('Provide an OpenAPI spec URL or pick a pinned snapshot for provider / bi-directional mode.'));
      return;
    }
    // Live provider verification needs a provider base URL to replay against.
    if (mode === 'provider-live' && !providerBaseUrl.trim()) {
      setError(t('Provide a provider base URL (e.g. http://localhost:3000) to replay contracts against.'));
      return;
    }
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      const requests = tab === 'provider'
        ? allRequests          // provider validates ALL requests against spec
        : contractRequests;     // consumer / bi-directional only run requests with contracts
      const result = await electron.runContracts({
        mode,
        requests,
        // Let the main process add design-first contracts (Designer + pacts/) so
        // they run without a manual pact-import.
        designContracts: workspace?.designContracts,
        envVars,
        collectionVars,
        specUrl:             specUrl.trim() || undefined,
        specSnapshotRelPath: activeSnapshotRelPath ?? undefined,
        requestBaseUrl:      requestBaseUrl.trim() || undefined,
        providerBaseUrl:     providerBaseUrl.trim() || undefined,
        stateHandlerUrl:     stateHandlerUrl.trim() || undefined,
      });
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

  async function captureSnapshot() {
    if (!specUrl.trim()) {
      setError(t('Enter a spec URL before pinning a snapshot.'));
      return;
    }
    setCapturing(true);
    setError(null);
    try {
      const { relPath, snapshot } = await electron.captureContractSnapshot({ specUrl: specUrl.trim() });
      loadContractSnapshot(relPath, snapshot);
      setActiveSnapshot(relPath);
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
    try {
      await electron.deleteContractSnapshot(activeSnapshotRelPath);
      removeContractSnapshot(activeSnapshotRelPath);
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
        {/* Design-first entry: author a consumer contract before any endpoint exists */}
        <button
          onClick={() => openContractDesigner()}
          className="flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-dashed border-surface-600 text-surface-300 hover:border-blue-500 hover:text-white transition-colors"
          title={t('Design a consumer-driven contract up front, with no endpoints, then publish it to the cloud')}
        >
          ✎ {t('Design a contract (no endpoint needed)')}
        </button>

        {/* Mode tabs */}
        <div className="flex gap-1 bg-surface-800 rounded-lg p-0.5">
          {([
            ['consumer', 'Consumer'],
            ['provider', 'Provider'],
            ['bidirectional', 'Bi-dir'],
          ] as [PanelTab, string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => { setTab(m); setReport(null); }}
              className={`flex-1 py-1 text-[10px] font-semibold rounded transition-colors ${
                tab === m ? 'bg-blue-600 text-white' : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              {t(label)}
            </button>
          ))}
        </div>

        {/* Mode description */}
        <p className="text-[10px] text-surface-500 leading-relaxed">
          {tab === 'consumer'
            ? t('Sends your contracts to the real provider and validates each response. Set a base URL for host-less (design-first) contracts, and turn on provider-side verification to seed provider states.')
            : tab === 'provider'
            ? t('Static analysis: validates that your requests conform to the provider\'s published OpenAPI spec (no HTTP calls).')
            : t('Checks static schema compatibility between consumer contracts and provider spec, then verifies live responses.')}
        </p>

        {/* Provider base URL + live verification (consumer) */}
        {tab === 'consumer' && (
          <div className="flex flex-col gap-2">
            <div>
              <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium block mb-1">
                {t('Provider base URL')} {!liveVerify && <span className="normal-case text-surface-600">{t('(optional)')}</span>}
              </label>
              <input
                value={providerBaseUrl}
                onChange={e => setProviderBaseUrl(e.target.value)}
                placeholder="http://localhost:3000"
                className="w-full text-xs bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono placeholder-surface-600"
              />
              <p className="text-[10px] text-surface-600 mt-1 leading-relaxed">
                {liveVerify
                  ? t('Each request is rebased onto this origin before being replayed against the live provider.')
                  : t('Optional. Rebase each request onto this origin before sending, so design-first contracts that carry only a path (e.g. /brands) can run. Requests with a full URL are sent as-is.')}
              </p>
            </div>

            <label className="flex items-center gap-2 text-[11px] text-surface-300 cursor-pointer">
              <input type="checkbox" checked={liveVerify} onChange={e => setLiveVerify(e.target.checked)} className="accent-blue-600" />
              {t('Provider-side verification (replay against a running provider, seed provider states)')}
            </label>

            {liveVerify && (
              <div>
                <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium block mb-1">
                  {t('State handler URL')} <span className="normal-case text-surface-600">{t('(optional)')}</span>
                </label>
                <input
                  value={stateHandlerUrl}
                  onChange={e => setStateHandlerUrl(e.target.value)}
                  placeholder="http://localhost:3000/_pact/provider-states"
                  className="w-full text-xs bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono placeholder-surface-600"
                />
                <p className="text-[10px] text-surface-600 mt-1 leading-relaxed">
                  {t('Before each interaction we POST')} {'{ state, action }'} {t('here so the provider can be seeded into a known state (Pact')} <code>given</code>{t(').')}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Spec source (provider / bidirectional) */}
        {needsSpec && (
          <div className="flex flex-col gap-2">
            {/* Snapshot picker */}
            <div>
              <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium block mb-1">
                {t('Spec version')}
              </label>
              <div className="flex gap-1">
                <select
                  value={activeSnapshotRelPath ?? ''}
                  onChange={e => setActiveSnapshot(e.target.value || null)}
                  disabled={!workspace}
                  className="flex-1 text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1.5 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  <option value="">{t('Live URL (latest from provider)')}</option>
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
                    title={t('Delete this snapshot')}
                    className="px-2 text-xs text-surface-500 hover:text-red-400 bg-surface-800 hover:bg-surface-700 rounded transition-colors"
                  >
                    ✕
                  </button>
                )}
              </div>
              {activeSnapshot && (
                <p className="text-[10px] text-surface-600 mt-1 font-mono truncate">
                  {t('Captured :when - sha :sha', { when: activeSnapshot.capturedAt.slice(0, 19).replace('T', ' '), sha: activeSnapshot.sha256.slice(0, 8) })}
                </p>
              )}
            </div>

            {/* Live URL (only meaningful when no snapshot is pinned) */}
            {!activeSnapshotRelPath && (
              <div>
                <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium block mb-1">
                  {t('OpenAPI Spec URL')}
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
                    title={t('Fetch and pin this spec as a versioned snapshot')}
                    className="px-2.5 text-xs bg-surface-800 hover:bg-surface-700 disabled:opacity-50 disabled:hover:bg-surface-800 rounded transition-colors"
                  >
                    {capturing ? '…' : t('Pin')}
                  </button>
                </div>
                <p className="text-[10px] text-surface-600 mt-1 leading-relaxed">
                  {t('Pin a snapshot to run against a specific spec version later, even after the provider ships an update.')}
                </p>

                {/* Provider side of bi-directional: publish the spec to the cloud broker. */}
                {cloudConnected && (
                  <div className="mt-2 pt-2 border-t border-surface-800 flex flex-col gap-1.5">
                    <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
                      {t('Publish spec to cloud')} <span className="text-surface-600 normal-case tracking-normal">{t('(provider side of bi-directional)')}</span>
                    </label>
                    <div className="flex gap-1">
                      <input
                        value={providerName}
                        onChange={e => setProviderName(e.target.value)}
                        placeholder={t('provider name')}
                        className="flex-1 text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1.5 focus:outline-none focus:border-blue-500 placeholder-surface-600"
                      />
                      <input
                        value={specVersion}
                        onChange={e => setSpecVersion(e.target.value)}
                        placeholder={t('version (git SHA)')}
                        className="w-32 text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1.5 focus:outline-none focus:border-blue-500 font-mono placeholder-surface-600"
                      />
                      <button
                        onClick={publishSpecToCloud}
                        disabled={publishingSpec || !specUrl.trim() || !providerName.trim() || !specVersion.trim()}
                        title={t('Publish this OpenAPI spec to the broker; consumers\' pacts are re-verified against it')}
                        className="px-2.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-surface-800 disabled:text-surface-600 rounded transition-colors"
                      >
                        {publishingSpec ? '…' : t('Publish')}
                      </button>
                    </div>
                    {publishNote && <p className="text-[10px] text-emerald-400 leading-relaxed">{publishNote}</p>}
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium block mb-1">
                {t('Request base URL')} <span className="normal-case text-surface-600">{t('(optional)')}</span>
              </label>
              <input
                value={requestBaseUrl}
                onChange={e => setRequestBaseUrl(e.target.value)}
                placeholder="https://api.example.com"
                className="w-full text-xs bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono placeholder-surface-600"
              />
              <p className="text-[10px] text-surface-600 mt-1 leading-relaxed">
                {t('If your requests point at a different host than the spec, enter that host here so paths match correctly.')}
              </p>
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-surface-500">
            {tab === 'provider'
              ? t(':count request|:count requests', { count: allRequests.length })
              : t(':count contract defined|:count contracts defined', { count: contractRequests.length + designInteractionCount })}
          </span>
          <button
            onClick={runContracts}
            disabled={running
              || (needsSpec && !specUrl.trim() && !activeSnapshotRelPath)
              || (mode === 'provider-live' && !providerBaseUrl.trim())}
            className="px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-surface-800 disabled:text-surface-600 rounded transition-colors font-medium"
          >
            {running ? t('Running…') : t('Run')}
          </button>
        </div>

        {error && <p className="text-[11px] text-red-400">{error}</p>}
      </div>

      {/* Status / hint */}
      <div className="flex-1 overflow-y-auto min-h-0 p-3">
        {running && (
          <p className="text-xs text-surface-500 text-center mt-4">{t('Running…')}</p>
        )}
        {!report && !running && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <p className="text-xs text-surface-500">{t('Configure a mode above and click Run.')}</p>
            {tab !== 'provider' && contractRequests.length === 0 && designInteractionCount === 0 && (
              <p className="text-[10px] text-surface-600 max-w-[200px]">
                {t('Design a contract above, or send a request to the designer, to define what the provider must return.')}
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
            <span className="font-semibold">{report.failed === 0 ? t('✓ All passed') : t('✗ :count failed', { count: report.failed })}</span>
            <span className="text-surface-500 ml-auto">{report.passed}/{report.total}</span>
          </div>
        )}
      </div>
    </div>
  );
}
