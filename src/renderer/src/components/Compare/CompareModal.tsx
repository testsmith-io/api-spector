// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { Modal } from '../common/Modal';
import { diffSpecs, summarizeDiff, type SpecChange } from '../../../../shared/openapi-diff';
import { pathMatches } from '../../../../shared/coverage';
import type { ApiRequest } from '../../../../shared/types';

const { electron } = window;

interface SpecInput { source: string; text: string }

function SpecField({ label, value, onSource, onText }: { label: string; value: SpecInput; onSource: (s: string) => void; onText: (s: string) => void }) {
  return (
    <div className="flex-1">
      <label className="text-[11px] text-surface-400">{label}</label>
      <input
        value={value.source}
        onChange={e => onSource(e.target.value)}
        placeholder="./openapi.yaml or URL"
        className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-blue-500"
      />
      <details className="text-[10px] text-surface-500 mt-1">
        <summary className="cursor-pointer hover:text-surface-300">or paste</summary>
        <textarea value={value.text} onChange={e => onText(e.target.value)} rows={3}
          className="mt-1 w-full resize-y bg-surface-950 border border-surface-800 rounded px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:border-blue-500" />
      </details>
    </div>
  );
}

export function CompareModal() {
  const open        = useStore(s => s.compareOpen);
  const setOpen     = useStore(s => s.setCompareOpen);
  const collections = useStore(s => s.collections);
  const savedSpec   = useStore(s => s.workspace?.settings?.coverageSpec);

  const [oldIn, setOldIn] = useState<SpecInput>({ source: '', text: '' });
  const [newIn, setNewIn] = useState<SpecInput>({ source: savedSpec ?? '', text: '' });
  const [changes, setChanges] = useState<SpecChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Requests in the workspace, for impact mapping.
  const requests = useMemo(() => {
    const out: { name: string; method: string; url: string }[] = [];
    for (const entry of Object.values(collections)) {
      for (const req of Object.values(entry.data.requests) as ApiRequest[]) {
        if (req.disabled) continue;
        out.push({ name: `${entry.data.name} / ${req.name}`, method: req.method, url: req.url });
      }
    }
    return out;
  }, [collections]);

  const load = (i: SpecInput) => electron.coverageLoadSpec(i.text.trim() ? { text: i.text } : /^https?:\/\//i.test(i.source.trim()) ? { url: i.source.trim() } : { path: i.source.trim() });

  async function run() {
    setBusy(true); setError(null);
    try {
      const [oldSpec, newSpec] = await Promise.all([load(oldIn), load(newIn)]);
      setChanges(diffSpecs(oldSpec, newSpec));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setChanges(null);
    } finally {
      setBusy(false);
    }
  }

  // Impact: which tests each breaking change hits, and the overall verdict.
  const impact = useMemo(() => {
    if (!changes) return null;
    const affected = changes.filter(c => c.breaking && c.method).map(change => ({
      change,
      tests: requests.filter(r => r.method.toUpperCase() === change.method && pathMatches(r.url, change.path)).map(r => r.name),
    }));
    const hitTests = new Set(affected.flatMap(a => a.tests));
    return { affected, hitTests: hitTests.size };
  }, [changes, requests]);

  if (!open) return null;

  const sum = changes ? summarizeDiff(changes) : null;
  const canRun = (oldIn.source.trim() || oldIn.text.trim()) && (newIn.source.trim() || newIn.text.trim());

  return (
    <Modal
      onClose={() => setOpen(false)}
      overlayClassName="bg-black/50 z-50 flex items-start justify-center pt-16"
      panelClassName="bg-surface-900 border border-surface-800 rounded-lg shadow-2xl flex flex-col w-[760px] max-h-[82vh]"
      title="Compare API specs"
      subtitle="Breaking-change detection and impact on your tests"
    >
      <div className="px-4 py-3 border-b border-surface-800 flex-shrink-0">
        <div className="flex gap-3 items-start">
          <SpecField label="Baseline (old)" value={oldIn} onSource={s => setOldIn({ ...oldIn, source: s })} onText={t => setOldIn({ ...oldIn, text: t })} />
          <div className="text-surface-500 pt-6">-&gt;</div>
          <SpecField label="Candidate (new)" value={newIn} onSource={s => setNewIn({ ...newIn, source: s })} onText={t => setNewIn({ ...newIn, text: t })} />
        </div>
        <div className="flex justify-end mt-2">
          <button onClick={run} disabled={busy || !canRun}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-surface-800 disabled:text-surface-500 rounded text-sm font-medium">
            {busy ? '…' : 'Compare'}
          </button>
        </div>
        {error && <div className="text-xs text-red-400 mt-2">{error}</div>}
      </div>

      <div className="px-4 py-3 flex-1 overflow-y-auto min-h-0 text-xs">
        {!changes ? (
          <div className="text-surface-500 text-center py-10">Point at two spec versions and choose <span className="text-surface-300">Compare</span>.</div>
        ) : changes.length === 0 ? (
          <div className="text-emerald-400 text-center py-10">No differences between the specs.</div>
        ) : (
          <>
            {sum!.breaking > 0 && (
              <div className="mb-3">
                <div className="text-red-400 font-bold uppercase tracking-wide text-[11px] mb-1">Breaking changes</div>
                {changes.filter(c => c.breaking).map((c, i) => (
                  <div key={i} className="flex gap-2 text-surface-300 py-0.5"><span className="text-red-400">✗</span>{c.detail}</div>
                ))}
              </div>
            )}
            {sum!.nonBreaking > 0 && (
              <div className="mb-3">
                <div className="text-emerald-400 font-bold uppercase tracking-wide text-[11px] mb-1">Non-breaking</div>
                {changes.filter(c => !c.breaking).map((c, i) => (
                  <div key={i} className="flex gap-2 text-surface-400 py-0.5"><span className="text-emerald-400">✓</span>{c.detail}</div>
                ))}
              </div>
            )}

            {/* Impact + verdict */}
            <div className="mt-3 pt-3 border-t border-surface-800">
              {sum!.breaking === 0 ? (
                <div className="text-emerald-400 font-medium">No breaking changes. Safe to deploy.</div>
              ) : impact!.hitTests === 0 ? (
                <div className="text-amber-400">
                  {sum!.breaking} breaking change{sum!.breaking !== 1 ? 's' : ''}, but no test in this workspace exercises the affected operations. Add tests, then re-check.
                </div>
              ) : (
                <>
                  {impact!.affected.filter(a => a.tests.length).map((a, i) => (
                    <div key={i} className="mb-1">
                      <div className="text-amber-300">{a.change.detail}</div>
                      {a.tests.map(t => <div key={t} className="text-surface-500 pl-4">- {t}</div>)}
                    </div>
                  ))}
                  <div className="mt-2 text-red-400 font-bold">
                    Block deployment: {sum!.breaking} breaking change{sum!.breaking !== 1 ? 's' : ''} affect {impact!.hitTests} test{impact!.hitTests !== 1 ? 's' : ''}.
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
