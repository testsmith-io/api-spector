import { useState } from 'react';
import { useStore } from '../../store';
import type { ContractMode } from '../../../../shared/types';

const { electron } = window;

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ContractPanel() {
  const collections          = useStore(s => s.collections);
  const environments         = useStore(s => s.environments);
  const activeEnvId          = useStore(s => s.activeEnvironmentId);
  const activeCollId         = useStore(s => s.activeCollectionId);
  const report               = useStore(s => s.lastContractReport);
  const setReport            = useStore(s => s.setLastContractReport);

  const [mode, setMode]               = useState<ContractMode>('consumer');
  const [specUrl, setSpecUrl]         = useState('');
  const [requestBaseUrl, setRequestBaseUrl] = useState('');
  const [running, setRunning]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const allRequests = Object.values(collections).flatMap(c => Object.values(c.data.requests));
  const contractRequests = allRequests.filter(r =>
    r.contract && (r.contract.statusCode !== undefined || r.contract.bodySchema || r.contract.headers?.length),
  );
  const collectionVars = activeCollId
    ? (collections[activeCollId]?.data.collectionVariables ?? {})
    : {};
  const envVars = activeEnvId
    ? Object.fromEntries(
        (environments[activeEnvId]?.data.variables ?? [])
          .filter(v => v.enabled)
          .map(v => [v.key, v.value]),
      )
    : {};

  async function runContracts() {
    if (mode !== 'consumer' && !specUrl.trim()) {
      setError('Provide an OpenAPI spec URL for provider / bi-directional mode.');
      return;
    }
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      const requests = mode === 'provider'
        ? allRequests          // provider validates ALL requests against spec
        : contractRequests;     // consumer / bidirectional only runs requests with contracts
      const result = await electron.runContracts({
        mode,
        requests,
        envVars,
        collectionVars,
        specUrl:        specUrl.trim() || undefined,
        requestBaseUrl: requestBaseUrl.trim() || undefined,
      });
      setReport(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Config area */}
      <div className="flex flex-col gap-3 px-3 py-3 border-b border-surface-800 flex-shrink-0">
        {/* Mode tabs */}
        <div className="flex gap-1 bg-surface-800 rounded-lg p-0.5">
          {(['consumer', 'provider', 'bidirectional'] as ContractMode[]).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setReport(null); }}
              className={`flex-1 py-1 text-[10px] font-semibold rounded capitalize transition-colors ${
                mode === m ? 'bg-blue-600 text-white' : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              {m === 'bidirectional' ? 'Bi-dir' : m}
            </button>
          ))}
        </div>

        {/* Mode description */}
        <p className="text-[10px] text-surface-500 leading-relaxed">
          {mode === 'consumer'
            ? 'Sends requests to the real provider and validates each response against the contract defined in the Contract tab.'
            : mode === 'provider'
            ? 'Static analysis — validates that your requests conform to the provider\'s published OpenAPI spec (no HTTP calls).'
            : 'Checks static schema compatibility between consumer contracts and provider spec, then verifies live responses.'}
        </p>

        {/* Spec URL + Request base URL (provider / bidirectional) */}
        {mode !== 'consumer' && (
          <div className="flex flex-col gap-2">
            <div>
              <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium block mb-1">
                OpenAPI Spec URL
              </label>
              <input
                value={specUrl}
                onChange={e => setSpecUrl(e.target.value)}
                placeholder="https://api.example.com/openapi.json"
                className="w-full text-xs bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono placeholder-surface-600"
              />
            </div>
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

        {/* Summary */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-surface-500">
            {mode === 'provider'
              ? `${allRequests.length} request${allRequests.length !== 1 ? 's' : ''}`
              : `${contractRequests.length} contract${contractRequests.length !== 1 ? 's' : ''} defined`}
          </span>
          <button
            onClick={runContracts}
            disabled={running || (mode !== 'consumer' && !specUrl.trim())}
            className="px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-surface-800 disabled:text-surface-600 rounded transition-colors font-medium"
          >
            {running ? 'Running…' : 'Run'}
          </button>
        </div>

        {error && <p className="text-[11px] text-red-400">{error}</p>}
      </div>

      {/* Status / hint */}
      <div className="flex-1 overflow-y-auto min-h-0 p-3">
        {running && (
          <p className="text-xs text-surface-500 text-center mt-4">Running…</p>
        )}
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
              ? 'bg-emerald-900/20 border-emerald-700 text-emerald-300'
              : 'bg-red-900/20 border-red-700 text-red-300'
          }`}>
            <span className="font-semibold">{report.failed === 0 ? '✓ All passed' : `✗ ${report.failed} failed`}</span>
            <span className="text-surface-500 ml-auto">{report.passed}/{report.total}</span>
          </div>
        )}
      </div>
    </div>
  );
}
