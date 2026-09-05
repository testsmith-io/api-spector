// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { Modal } from '../common/Modal';
import { computeCoverage, flattenValuePaths, type CoverageReport, type CoverageRequestInput, type CoverageObservation } from '../../../../shared/coverage';
import { generateTests, toApiRequest } from '../../../../shared/openapi-testgen';
import type { ApiRequest, Collection } from '../../../../shared/types';

const { electron } = window;

function Bar({ pct }: { pct: number }) {
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="h-2 w-full rounded bg-surface-800 overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="flex-1">
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-[11px] text-surface-400">{label}</div>
    </div>
  );
}

export function CoverageModal() {
  const open           = useStore(s => s.coverageOpen);
  const setOpen        = useStore(s => s.setCoverageOpen);
  const collections    = useStore(s => s.collections);
  const history        = useStore(s => s.history);
  const savedSpec      = useStore(s => s.workspace?.settings?.coverageSpec);
  const setCoverageSpec = useStore(s => s.setCoverageSpec);
  const addCollectionObject = useStore(s => s.addCollectionObject);

  const [source, setSource]   = useState(savedSpec ?? '');
  const [pasted, setPasted]   = useState('');
  const [report, setReport]   = useState<CoverageReport | null>(null);
  const [spec, setSpec]       = useState<unknown>(null);
  const [error, setError]     = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [generated, setGenerated] = useState<string | null>(null);

  // All non-example requests in the workspace, reduced for the engine.
  const requests = useMemo<CoverageRequestInput[]>(() => {
    const out: CoverageRequestInput[] = [];
    for (const entry of Object.values(collections)) {
      for (const req of Object.values(entry.data.requests) as ApiRequest[]) {
        if (req.disabled) continue;
        out.push({ name: `${entry.data.name} / ${req.name}`, method: req.method, url: req.url, expectedStatus: req.contract?.statusCode });
      }
    }
    return out;
  }, [collections]);

  // Recent runs (this session's history) let coverage credit response codes and
  // response-shape actually seen, not only what the contracts declare.
  const observations = useMemo<CoverageObservation[]>(() => {
    return history.map(h => {
      let responsePaths: string[] | undefined;
      try { if (h.response?.body) responsePaths = flattenValuePaths(JSON.parse(h.response.body)); } catch { /* non-JSON */ }
      return { method: h.request.method, url: h.resolvedUrl, status: h.response?.status ?? 0, responsePaths };
    });
  }, [history]);

  async function compute() {
    setBusy(true); setError(null);
    try {
      const isUrl = /^https?:\/\//i.test(source.trim());
      const spec = await electron.coverageLoadSpec(
        pasted.trim() ? { text: pasted } : isUrl ? { url: source.trim() } : { path: source.trim() },
      );
      if (source.trim() && !pasted.trim()) setCoverageSpec(source.trim());
      setSpec(spec);
      setReport(computeCoverage(spec, requests, observations));
      setGenerated(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setReport(null);
    } finally {
      setBusy(false);
    }
  }

  // Generate tests for the operations with no test yet and add them as a new
  // collection in the workspace.
  function generateForGaps() {
    if (!spec || !report) return;
    const only = new Set(report.operations.filter(o => !o.tested).map(o => `${o.method} ${o.path}`));
    if (only.size === 0) return;
    const tests = generateTests(spec, { only });
    const requestIds: string[] = [];
    const requestMap: Record<string, ApiRequest> = {};
    for (const t of tests) {
      const id = crypto.randomUUID();
      requestMap[id] = toApiRequest(t, id);
      requestIds.push(id);
    }
    const name = `${report.spec.title ?? 'API'} tests (generated)`;
    const collection: Collection = {
      version: '1.0',
      id: crypto.randomUUID(),
      name,
      description: 'Generated for untested operations from the OpenAPI spec.',
      rootFolder: { id: crypto.randomUUID(), name: 'root', description: '', folders: [], requestIds },
      requests: requestMap,
    };
    addCollectionObject(collection);
    setGenerated(`Added ${tests.length} tests for ${only.size} untested operations as "${collection.name}".`);
  }

  if (!open) return null;

  const t = report?.totals;
  const shownOps = report?.operations.filter(o => !onlyGaps || !o.tested || !o.hasNegativeTest) ?? [];

  return (
    <Modal
      onClose={() => setOpen(false)}
      overlayClassName="bg-black/50 z-50 flex items-start justify-center pt-16"
      panelClassName="bg-surface-900 border border-surface-800 rounded-lg shadow-2xl flex flex-col w-[760px] max-h-[82vh]"
      title="API test coverage"
      subtitle="How much of an OpenAPI contract this workspace tests"
    >
      {/* Spec source */}
      <div className="px-4 py-3 border-b border-surface-800 flex flex-col gap-2 flex-shrink-0">
        <label className="text-[11px] text-surface-400">OpenAPI spec (file path or URL)</label>
        <div className="flex gap-2">
          <input
            value={source}
            onChange={e => setSource(e.target.value)}
            placeholder="./openapi.yaml  or  https://api.example.com/openapi.json"
            className="flex-1 bg-surface-800 border border-surface-700 rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={compute}
            disabled={busy || (!source.trim() && !pasted.trim())}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-surface-800 disabled:text-surface-500 rounded text-sm font-medium"
          >
            {busy ? '…' : 'Measure'}
          </button>
        </div>
        <details className="text-[11px] text-surface-500">
          <summary className="cursor-pointer hover:text-surface-300">or paste spec</summary>
          <textarea
            value={pasted}
            onChange={e => setPasted(e.target.value)}
            rows={4}
            placeholder="Paste OpenAPI JSON or YAML here"
            className="mt-1 w-full resize-y bg-surface-950 border border-surface-800 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-500"
          />
        </details>
        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>

      {/* Report */}
      <div className="px-4 py-3 flex-1 overflow-y-auto min-h-0">
        {!report ? (
          <div className="text-sm text-surface-500 text-center py-10">
            Point at your OpenAPI spec and choose <span className="text-surface-300">Measure</span> to see which operations are tested.
          </div>
        ) : (
          <>
            <div className="mb-3">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-surface-300">{report.spec.title ?? 'API'}{report.spec.version ? ` v${report.spec.version}` : ''}</span>
                <span className="text-surface-400">{t!.operationPct}% operations tested</span>
              </div>
              <Bar pct={t!.operationPct} />
            </div>
            <div className="flex gap-4 mb-4 border-b border-surface-800 pb-3">
              <Stat value={`${t!.tested}/${t!.operations}`} label="operations tested" />
              <Stat value={`${t!.coveredStatuses}/${t!.declaredStatuses}`} label="response codes covered" />
              {t!.declaredProperties > 0 && (
                <Stat value={`${t!.propertyPct}%`} label="response shape seen in runs" />
              )}
              <Stat value={<span className={t!.untested ? 'text-amber-400' : 'text-emerald-400'}>{t!.untested}</span>} label="never tested" />
              <Stat value={<span className={t!.withoutNegativeTest ? 'text-amber-400' : 'text-emerald-400'}>{t!.withoutNegativeTest}</span>} label="no negative test" />
            </div>

            <div className="flex items-center justify-between mb-2 gap-3">
              <label className="flex items-center gap-2 text-xs text-surface-400">
                <input type="checkbox" checked={onlyGaps} onChange={e => setOnlyGaps(e.target.checked)} />
                Show only gaps (untested or missing a negative test)
              </label>
              {t!.untested > 0 && (
                <button
                  onClick={generateForGaps}
                  title="Generate happy-path, negative, and boundary tests for the untested operations"
                  className="px-3 py-1 text-xs bg-violet-600 hover:bg-violet-500 rounded font-medium shrink-0"
                >
                  Generate tests for {t!.untested} gap{t!.untested !== 1 ? 's' : ''}
                </button>
              )}
            </div>
            {generated && (
              <div className="mb-2 px-3 py-1.5 rounded bg-emerald-900/20 border border-emerald-800/40 text-xs text-emerald-300">
                {generated} Re-measure to see the coverage rise.
              </div>
            )}

            <div className="flex flex-col gap-0.5">
              {shownOps.map((op, i) => (
                <div key={`${op.method}-${op.path}-${i}`} className="flex items-center gap-2 text-xs py-1 border-b border-surface-800/50">
                  <span className={op.tested ? 'text-emerald-400' : 'text-red-400'}>{op.tested ? '✓' : '✗'}</span>
                  <span className="font-mono font-bold text-surface-300 w-14 shrink-0">{op.method}</span>
                  <span className={`font-mono flex-1 ${op.tested ? 'text-white' : 'text-surface-500'}`}>{op.path}</span>
                  {op.declaredStatuses.length > 0 && (
                    <span className="text-surface-500 shrink-0">{op.coveredStatuses.length}/{op.declaredStatuses.length} codes</span>
                  )}
                  {op.tested && !op.hasNegativeTest && <span className="text-amber-400 shrink-0">no negative</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
