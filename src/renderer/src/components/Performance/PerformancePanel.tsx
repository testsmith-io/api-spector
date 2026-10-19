// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Performance (load) testing view. Plans live inline in the workspace (see
// PerfPlansPanel). A plan targets a single request OR a Flow (so authenticated,
// multi-step scenarios load test too), and shapes load with one of four
// patterns (basic / stepping / arrivals / custom) over a unified schedule shown
// as a live profile preview. Results report whole-iteration throughput and
// latency, a per-step breakdown, status codes and errors. The run happens in
// the main process (perf-runner.ts).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store';
import { useVarValues } from '../../hooks/useVarValues';
import { resolveEnvironmentById } from '../../hooks/useActiveEnvironment';
import { useT } from '../../i18n';
import { deriveLoad, targetAt, THRESHOLD_METRIC_LABELS, THRESHOLD_OP_LABELS } from '../../../../shared/perf-stages';
import { buildRunPlan } from '../../../../shared/request-collection';
import type { ApiRequest, Folder, PerfPattern, PerfPlan, PerfProgress, PerfResult, PerfStage, PerfTarget, PerfThreshold, PerfThresholdMetric, PerfThresholdOp, Workspace } from '../../../../shared/types';

type SeqTarget = Extract<PerfTarget, { kind: 'sequence' }>;

// Flatten a collection's folder tree into {id, label} with indentation.
function listFolders(root: Folder, depth = 0, out: { id: string; label: string }[] = []): { id: string; label: string }[] {
  for (const f of root.folders ?? []) {
    out.push({ id: f.id, label: `${'  '.repeat(depth)}${f.name}` });
    listFolders(f, depth + 1, out);
  }
  return out;
}

const { electron } = window;

function fmtMs(ms: number): string {
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
function statusColor(code: string): string {
  if (code === 'error') return 'text-red-400 border-red-500/40';
  const n = Number(code);
  if (n >= 200 && n < 300) return 'text-emerald-400 border-emerald-500/40';
  if (n >= 300 && n < 400) return 'text-sky-400 border-sky-500/40';
  if (n >= 400 && n < 500) return 'text-amber-400 border-amber-500/40';
  return 'text-red-400 border-red-500/40';
}
function fmtDur(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

const PATTERNS: { id: PerfPattern; label: string; blurb: string }[] = [
  { id: 'basic', label: 'Basic', blurb: 'Hold a set number of users, with optional ramp up and down.' },
  { id: 'stepping', label: 'Stepping', blurb: 'Raise users in steps to find the breaking point.' },
  { id: 'arrivals', label: 'Arrivals', blurb: 'Open model: a target rate of iterations per second.' },
  { id: 'custom', label: 'Custom', blurb: 'Author your own stages (ramp / hold / spike).' },
];

function Seg<T extends string>({ value, options, onChange, disabled }: { readonly value: T; readonly options: { id: T; label: string }[]; readonly onChange: (v: T) => void; readonly disabled?: boolean }) {
  return (
    <div className="inline-flex rounded border border-surface-700 overflow-hidden">
      {options.map(o => (
        <button key={o.id} disabled={disabled} onClick={() => onChange(o.id)}
          className={`px-3 py-1 text-xs transition-colors ${value === o.id ? 'bg-amber-700 text-amber-50' : 'bg-surface-800 text-surface-400 hover:text-surface-200'} disabled:opacity-50`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Num({ label, value, onChange, disabled, min = 0, max = 100000, suffix }: { readonly label: string; readonly value: number; readonly onChange: (v: number) => void; readonly disabled?: boolean; readonly min?: number; readonly max?: number; readonly suffix?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-surface-500">{label}</span>
      <div className="flex items-center gap-1">
        <input type="number" min={min} max={max} value={value} disabled={disabled}
          onChange={e => onChange(Math.max(min, Math.min(max, Math.floor(Number(e.target.value) || 0))))}
          className="w-20 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-sm tabular-nums focus:outline-none focus:border-amber-500 disabled:opacity-50" />
        {suffix && <span className="text-xs text-surface-500">{suffix}</span>}
      </div>
    </label>
  );
}

function Stat({ label, value, sub, accent }: { readonly label: string; readonly value: string; readonly sub?: string; readonly accent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 bg-surface-900 border border-surface-800 rounded px-3 py-2 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-surface-500">{label}</span>
      <span className={`text-lg font-semibold tabular-nums ${accent ? 'text-amber-400' : 'text-surface-100'}`}>{value}</span>
      {sub && <span className="text-[10px] text-surface-500">{sub}</span>}
    </div>
  );
}

// The load profile over time, from the derived schedule.
function ProfilePreview({ plan }: { readonly plan: PerfPlan }) {
  const t = useT();
  const load = useMemo(() => deriveLoad(plan), [plan]);
  const unit = load.executor === 'arrival' ? t('iter/s') : t('VUs');
  if (load.totalSec <= 0) return null;
  const w = 100, h = 30, N = 160;
  const pts: { x: number; y: number }[] = [];
  let peak = 0;
  for (let i = 0; i <= N; i++) {
    const tt = (i / N) * load.totalSec;
    const v = targetAt(load, Math.min(tt, load.totalSec - 0.001));
    peak = Math.max(peak, v);
    pts.push({ x: (i / N) * w, y: v });
  }
  const max = Math.max(1, peak);
  const area = `0,${h} ` + pts.map(p => `${p.x.toFixed(2)},${(h - (p.y / max) * h).toFixed(2)}`).join(' ') + ` ${w},${h}`;
  return (
    <div className="bg-surface-950 border border-surface-800 rounded p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-surface-500">{t('Load profile')}</span>
        <span className="text-[10px] text-surface-500 tabular-nums">{t('peak')} {Math.round(peak)} {unit} · {fmtDur(load.totalSec)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-16">
        <polygon points={area} className="fill-amber-500/25 stroke-amber-400" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function SeriesChart({ series }: { readonly series: PerfResult['series'] }) {
  const t = useT();
  if (series.length === 0) return null;
  const w = 100, h = 36;
  const maxRps = Math.max(1, ...series.map(s => s.rps));
  const maxP95 = Math.max(1, ...series.map(s => s.p95));
  const bw = w / series.length;
  const linePts = series.map((s, i) => `${(i + 0.5) * bw},${h - (s.p95 / maxP95) * h}`).join(' ');
  return (
    <div className="bg-surface-950 border border-surface-800 rounded p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-surface-500">{t('Over time (per second)')}</span>
        <span className="text-[10px] text-surface-500"><span className="text-amber-400">▮</span> {t('iter/s')} <span className="text-fuchsia-400 ml-2">—</span> {t('p95')}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-24">
        {series.map((s, i) => {
          const bh = (s.rps / maxRps) * h;
          return <rect key={i} x={i * bw + bw * 0.1} y={h - bh} width={bw * 0.8} height={bh} className="fill-amber-500/50" />;
        })}
        <polyline points={linePts} fill="none" className="stroke-fuchsia-400" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

// Realtime results: a live line of instantaneous iterations/sec (amber) and p95
// (fuchsia), updated from the progress stream while the run is in flight.
function LiveChart({ samples }: { readonly samples: PerfProgress[] }) {
  const t = useT();
  if (samples.length < 2) return null;
  const inst: { rps: number; p95: number }[] = [];
  for (let i = 1; i < samples.length; i++) {
    const dIter = samples[i].iterations - samples[i - 1].iterations;
    const dMs = Math.max(1, samples[i].elapsedMs - samples[i - 1].elapsedMs);
    inst.push({ rps: (dIter / dMs) * 1000, p95: samples[i].p95 });
  }
  const w = 100, h = 30;
  const maxRps = Math.max(1, ...inst.map(s => s.rps));
  const maxP95 = Math.max(1, ...inst.map(s => s.p95));
  const line = (sel: (s: { rps: number; p95: number }) => number, max: number) =>
    inst.map((s, i) => `${(i / (inst.length - 1)) * w},${h - (sel(s) / max) * h}`).join(' ');
  return (
    <div className="bg-surface-950 border border-surface-800 rounded p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-surface-500">{t('Live')}</span>
        <span className="text-[10px] text-surface-500"><span className="text-amber-400">—</span> {t('iter/s')} <span className="text-fuchsia-400 ml-2">—</span> {t('p95')}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-16">
        <polyline points={line(s => s.rps, maxRps)} fill="none" className="stroke-amber-400" strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
        <polyline points={line(s => s.p95, maxP95)} fill="none" className="stroke-fuchsia-400" strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export function PerformancePanel() {
  const t = useT();
  const collections = useStore(s => s.collections);
  const flows = useStore(s => s.flows);
  const environments = useStore(s => s.environments);
  const activeEnvironmentId = useStore(s => s.activeEnvironmentId);
  const globals = useStore(s => s.globals);
  const workspace = useStore(s => s.workspace);
  const workspacePath = useStore(s => s.workspacePath);
  const setWorkspace = useStore(s => s.setWorkspace);
  const activeId = useStore(s => s.activePerfPlanId);
  const vars = useVarValues();

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<PerfProgress | null>(null);
  const [samples, setSamples] = useState<PerfProgress[]>([]);
  const [result, setResult] = useState<PerfResult | null>(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const plans = useMemo(() => workspace?.perfPlans ?? [], [workspace]);
  const plan = useMemo(() => plans.find(p => p.id === activeId) ?? null, [plans, activeId]);

  useEffect(() => { setResult(null); setProgress(null); setSamples([]); setError(''); }, [activeId]);
  useEffect(() => {
    electron.onPerfProgress((p: PerfProgress) => { setProgress(p); setSamples(s => [...s, p].slice(-240)); });
    return () => electron.offPerfEvents();
  }, []);

  const requestOptions = useMemo(() => {
    const out: { id: string; name: string; method: string; collection: string }[] = [];
    for (const c of Object.values(collections)) {
      for (const r of Object.values(c.data.requests) as ApiRequest[]) {
        const proto = r.protocol ?? 'http';
        if (proto === 'http' || proto === 'soap') out.push({ id: r.id, name: r.name, method: r.method, collection: c.data.name });
        else if (proto === 'grpc') out.push({ id: r.id, name: r.name, method: 'gRPC', collection: c.data.name });
      }
    }
    return out.sort((a, b) => a.collection.localeCompare(b.collection) || a.name.localeCompare(b.name));
  }, [collections]);
  const flowOptions = useMemo(() => Object.values(flows).map(f => ({ id: f.data.id, name: f.data.name })).sort((a, b) => a.name.localeCompare(b.name)), [flows]);

  const selectedRequest = useMemo<ApiRequest | null>(() => {
    if (plan?.target.kind !== 'request' || !plan.target.requestId) return null;
    for (const c of Object.values(collections)) {
      const r = c.data.requests[plan.target.requestId];
      if (r) return r;
    }
    return null;
  }, [collections, plan]);
  const selectedFlow = useMemo(() => {
    if (plan?.target.kind !== 'flow' || !plan.target.flowId) return null;
    return flows[plan.target.flowId]?.data ?? null;
  }, [flows, plan]);
  const sequenceInfo = useMemo(() => {
    if (plan?.target.kind !== 'sequence' || !plan.target.collectionId) return null;
    const col = collections[plan.target.collectionId]?.data;
    if (!col) return null;
    let count = 0;
    try { count = buildRunPlan(col, plan.target.folderId ?? null, []).filter(i => !i.isHook).length; } catch { count = 0; }
    return { col, count };
  }, [collections, plan]);
  const hasTarget = plan?.target.kind === 'request' ? !!selectedRequest
    : plan?.target.kind === 'sequence' ? !!sequenceInfo && sequenceInfo.count > 0
    : !!selectedFlow;

  function patch(partial: Partial<PerfPlan>) {
    if (!plan || !workspace) return;
    const next = plans.map(p => p.id === plan.id ? { ...p, ...partial } : p);
    const updated: Workspace = { ...workspace, perfPlans: next };
    setWorkspace(updated, workspacePath ?? '');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const ws = useStore.getState().workspace;
      if (ws) void electron.saveWorkspace(ws);
    }, 500);
  }

  async function run() {
    if (!plan || !hasTarget || running) return;
    setRunning(true); setResult(null); setProgress(null); setSamples([]); setError('');
    try {
      const common = {
        environment: resolveEnvironmentById(environments, activeEnvironmentId),
        globals,
        proxy: workspace?.settings?.proxy,
        tls: workspace?.settings?.tls,
        secretsConfig: workspace?.settings?.secrets,
      };
      const payload = plan.target.kind === 'request'
        ? { plan, request: selectedRequest ?? undefined, vars }
        : plan.target.kind === 'sequence'
          ? { plan, collection: sequenceInfo?.col, ...common }
          : {
              plan,
              flow: selectedFlow ?? undefined,
              flows: Object.values(flows).map(f => f.data),
              collections: Object.values(collections).map(c => c.data),
              ...common,
            };
      setResult(await electron.perfRun(payload));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }
  async function stop() { await electron.perfStop(); }

  async function exportReport() {
    if (!result || !plan) return;
    setExporting(true);
    try {
      const target = plan.target.kind === 'request' ? (selectedRequest?.name ?? 'request') : (selectedFlow?.name ?? 'flow');
      await electron.perfExportHtml(result, { planName: plan.name, target });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  if (!plan) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-surface-500 px-6 text-center">
        {plans.length === 0 ? t('Create a performance test plan in the left panel to get started.') : t('Select a performance test plan in the left panel.')}
      </div>
    );
  }

  const b = plan.basic, st = plan.stepping, ar = plan.arrivals;
  const think = plan.thinkTime ?? { minSec: 0, maxSec: 0 };
  const thresholds = plan.thresholds ?? [];
  const errorRate = result && result.iterations > 0 ? (result.iterationsFailed / result.iterations) * 100 : 0;
  // Not a hook (it runs after the early return above), so compute it plainly.
  const total = deriveLoad(plan).totalSec;
  const frac = progress && total > 0 ? Math.min(1, progress.elapsedMs / (total * 1000)) : 0;
  const unit = plan.pattern === 'arrivals' ? t('iter/s') : t('VUs');

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-2 px-5 pt-4 pb-3 flex-shrink-0">
        <span className="text-xs font-bold text-amber-100 bg-amber-700 rounded px-2 py-1">{t('PERF')}</span>
        <h2 className="text-sm font-semibold text-surface-100 truncate">{plan.name}</h2>
        <span className="text-[11px] text-surface-500">{t('Load test a request or a flow, separate from your functional tests.')}</span>
      </div>

      <div className="px-5 pb-3 flex-shrink-0 flex flex-col gap-4">
        {/* Target */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-surface-500">{t('Target')}</span>
            <Seg value={plan.target.kind} disabled={running}
              options={[{ id: 'request', label: t('Request') }, { id: 'sequence', label: t('Sequence') }, { id: 'flow', label: t('Flow') }]}
              onChange={kind => patch({ target:
                kind === 'request' ? { kind: 'request', requestId: '' }
                : kind === 'sequence' ? { kind: 'sequence', collectionId: '', folderId: undefined }
                : { kind: 'flow', flowId: '' } })} />
          </div>

          {plan.target.kind === 'request' && (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-surface-500">{t('Request')}</span>
              <select value={plan.target.requestId} disabled={running}
                onChange={e => patch({ target: { kind: 'request', requestId: e.target.value } })}
                className="w-80 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-amber-500 disabled:opacity-50">
                <option value="">{t('Select a request…')}</option>
                {requestOptions.map(o => <option key={o.id} value={o.id}>{o.collection} / {o.method} {o.name}</option>)}
              </select>
            </label>
          )}

          {plan.target.kind === 'sequence' && (() => {
            const seq = plan.target as SeqTarget;
            const colOpts = Object.values(collections).map(c => ({ id: c.data.id, name: c.data.name }));
            const selCol = collections[seq.collectionId]?.data;
            const folderOpts = selCol ? listFolders(selCol.rootFolder) : [];
            return <>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-surface-500">{t('Collection')}</span>
                <select value={seq.collectionId} disabled={running}
                  onChange={e => patch({ target: { kind: 'sequence', collectionId: e.target.value, folderId: undefined } })}
                  className="w-56 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-amber-500 disabled:opacity-50">
                  <option value="">{t('Select a collection…')}</option>
                  {colOpts.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-surface-500">{t('Folder')}</span>
                <select value={seq.folderId ?? ''} disabled={running || !selCol}
                  onChange={e => patch({ target: { kind: 'sequence', collectionId: seq.collectionId, folderId: e.target.value || undefined } })}
                  className="w-48 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-amber-500 disabled:opacity-50">
                  <option value="">{t('Whole collection')}</option>
                  {folderOpts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
            </>;
          })()}

          {plan.target.kind === 'flow' && (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-surface-500">{t('Flow')}</span>
              <select value={plan.target.flowId} disabled={running}
                onChange={e => patch({ target: { kind: 'flow', flowId: e.target.value } })}
                className="w-80 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-amber-500 disabled:opacity-50">
                <option value="">{t('Select a flow…')}</option>
                {flowOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          )}

          <div className="text-[11px] text-surface-500 self-center">
            {plan.target.kind === 'flow' ? t('Each iteration runs the whole flow.')
              : plan.target.kind === 'sequence' ? (sequenceInfo ? t('Each iteration runs :n requests in order; variables carry between them.', { n: sequenceInfo.count }) : t('Each iteration runs the collection or folder in order; variables carry between them.'))
              : t('Each iteration sends this one request.')}
          </div>
        </div>

        {/* Pattern */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-wider text-surface-500">{t('Load pattern')}</span>
            <Seg value={plan.pattern} disabled={running}
              options={PATTERNS.map(p => ({ id: p.id, label: t(p.label) }))}
              onChange={pattern => patch({ pattern })} />
            <span className="text-[11px] text-surface-500">{t(PATTERNS.find(p => p.id === plan.pattern)!.blurb)}</span>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            {plan.pattern === 'basic' && <>
              <Num label={t('Virtual users')} value={b.vus} min={1} max={5000} disabled={running} onChange={v => patch({ basic: { ...b, vus: v } })} />
              <Num label={t('Ramp up')} value={b.rampUpSec} max={36000} suffix={t('s')} disabled={running} onChange={v => patch({ basic: { ...b, rampUpSec: v } })} />
              <Num label={t('Hold')} value={b.durationSec} min={1} max={36000} suffix={t('s')} disabled={running} onChange={v => patch({ basic: { ...b, durationSec: v } })} />
              <Num label={t('Ramp down')} value={b.rampDownSec} max={36000} suffix={t('s')} disabled={running} onChange={v => patch({ basic: { ...b, rampDownSec: v } })} />
            </>}
            {plan.pattern === 'stepping' && <>
              <Num label={t('Start users')} value={st.startUsers} min={1} max={5000} disabled={running} onChange={v => patch({ stepping: { ...st, startUsers: v } })} />
              <Num label={t('Step users')} value={st.stepUsers} min={1} max={5000} disabled={running} onChange={v => patch({ stepping: { ...st, stepUsers: v } })} />
              <Num label={t('Step duration')} value={st.stepDurationSec} min={1} max={36000} suffix={t('s')} disabled={running} onChange={v => patch({ stepping: { ...st, stepDurationSec: v } })} />
              <Num label={t('Max users')} value={st.maxUsers} min={1} max={5000} disabled={running} onChange={v => patch({ stepping: { ...st, maxUsers: v } })} />
              <Num label={t('Ramp per step')} value={st.rampStepSec} max={36000} suffix={t('s')} disabled={running} onChange={v => patch({ stepping: { ...st, rampStepSec: v } })} />
              <Num label={t('Hold at peak')} value={st.holdFinalSec} max={36000} suffix={t('s')} disabled={running} onChange={v => patch({ stepping: { ...st, holdFinalSec: v } })} />
            </>}
            {plan.pattern === 'arrivals' && <>
              <Num label={t('Rate')} value={ar.rate} min={1} max={100000} suffix={t('iter/s')} disabled={running} onChange={v => patch({ arrivals: { ...ar, rate: v } })} />
              <Num label={t('Duration')} value={ar.durationSec} min={1} max={36000} suffix={t('s')} disabled={running} onChange={v => patch({ arrivals: { ...ar, durationSec: v } })} />
              <Num label={t('Max users')} value={ar.maxVus} min={1} max={20000} disabled={running} onChange={v => patch({ arrivals: { ...ar, maxVus: v } })} />
            </>}
            {plan.pattern === 'custom' && (
              <div className="flex flex-col gap-1.5 w-full">
                {plan.custom.stages.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[10px] text-surface-600 w-14">{t('Stage :n', { n: i + 1 })}</span>
                    <input type="number" min={1} max={36000} value={s.durationSec} disabled={running}
                      onChange={e => patch({ custom: { stages: plan.custom.stages.map((x, j) => j === i ? { ...x, durationSec: Math.max(1, Math.floor(Number(e.target.value) || 1)) } : x) } })}
                      className="w-20 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs tabular-nums focus:outline-none focus:border-amber-500 disabled:opacity-50" />
                    <span className="text-[10px] text-surface-500">{t('s to')}</span>
                    <input type="number" min={0} max={20000} value={s.target} disabled={running}
                      onChange={e => patch({ custom: { stages: plan.custom.stages.map((x, j) => j === i ? { ...x, target: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : x) } })}
                      className="w-20 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs tabular-nums focus:outline-none focus:border-amber-500 disabled:opacity-50" />
                    <span className="text-[10px] text-surface-500">{t('VUs')}</span>
                    <label className="flex items-center gap-1 text-[11px] text-surface-400">
                      <input type="checkbox" checked={s.ramp} disabled={running}
                        onChange={e => patch({ custom: { stages: plan.custom.stages.map((x, j) => j === i ? { ...x, ramp: e.target.checked } : x) } })}
                        className="accent-amber-500" />
                      {t('ramp')}
                    </label>
                    <button disabled={running || plan.custom.stages.length <= 1}
                      onClick={() => patch({ custom: { stages: plan.custom.stages.filter((_, j) => j !== i) } })}
                      className="text-surface-600 hover:text-red-400 text-xs disabled:opacity-30">×</button>
                  </div>
                ))}
                <button disabled={running}
                  onClick={() => patch({ custom: { stages: [...plan.custom.stages, { durationSec: 30, target: 20, ramp: false } as PerfStage] } })}
                  className="self-start text-[11px] text-amber-500 hover:text-amber-400 disabled:opacity-50">+ {t('Add stage')}</button>
              </div>
            )}
            <Num label={t('Timeout (s, 0 = none)')} value={plan.timeoutSec} max={300} suffix={t('s')} disabled={running} onChange={v => patch({ timeoutSec: v })} />
            {plan.pattern !== 'arrivals' && <>
              <Num label={t('Think min (s)')} value={think.minSec} max={3600} suffix={t('s')} disabled={running} onChange={v => patch({ thinkTime: { minSec: v, maxSec: Math.max(v, think.maxSec) } })} />
              <Num label={t('Think max (s)')} value={think.maxSec} max={3600} suffix={t('s')} disabled={running} onChange={v => patch({ thinkTime: { minSec: Math.min(v, think.minSec || v), maxSec: v } })} />
            </>}
          </div>
        </div>

        {/* Thresholds (optional pass/fail gates) */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-surface-500">{t('Thresholds')}</span>
            <span className="text-[11px] text-surface-500">{t('Optional pass/fail gates checked against the result.')}</span>
          </div>
          {thresholds.map((th, i) => (
            <div key={i} className="flex items-center gap-2">
              <select value={th.metric} disabled={running}
                onChange={e => patch({ thresholds: thresholds.map((x, j) => j === i ? { ...x, metric: e.target.value as PerfThresholdMetric } : x) })}
                className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-amber-500 disabled:opacity-50">
                {(Object.keys(THRESHOLD_METRIC_LABELS) as PerfThresholdMetric[]).map(m => <option key={m} value={m}>{t(THRESHOLD_METRIC_LABELS[m])}</option>)}
              </select>
              <select value={th.op} disabled={running}
                onChange={e => patch({ thresholds: thresholds.map((x, j) => j === i ? { ...x, op: e.target.value as PerfThresholdOp } : x) })}
                className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-amber-500 disabled:opacity-50">
                {(Object.keys(THRESHOLD_OP_LABELS) as PerfThresholdOp[]).map(o => <option key={o} value={o}>{THRESHOLD_OP_LABELS[o]}</option>)}
              </select>
              <input type="number" min={0} value={th.value} disabled={running}
                onChange={e => patch({ thresholds: thresholds.map((x, j) => j === i ? { ...x, value: Math.max(0, Number(e.target.value) || 0) } : x) })}
                className="w-24 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs tabular-nums focus:outline-none focus:border-amber-500 disabled:opacity-50" />
              <button disabled={running} onClick={() => patch({ thresholds: thresholds.filter((_, j) => j !== i) })} className="text-surface-600 hover:text-red-400 text-xs disabled:opacity-30">×</button>
            </div>
          ))}
          <button disabled={running}
            onClick={() => patch({ thresholds: [...thresholds, { metric: 'iteration_p95', op: 'lt', value: 500 } as PerfThreshold] })}
            className="self-start text-[11px] text-amber-500 hover:text-amber-400 disabled:opacity-50">+ {t('Add threshold')}</button>
        </div>

        <ProfilePreview plan={plan} />

        <div className="flex items-center gap-3">
          {running ? (
            <button onClick={stop} className="px-4 py-1.5 bg-red-700 hover:bg-red-600 rounded text-sm font-medium transition-colors">{t('Stop')}</button>
          ) : (
            <button onClick={run} disabled={!hasTarget} className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-surface-800 disabled:text-surface-600 rounded text-sm font-medium transition-colors">{t('Run load test')}</button>
          )}
          {!hasTarget && <span className="text-[11px] text-amber-500/80">{plan.target.kind === 'request' ? t('Pick a request to load test.') : plan.target.kind === 'sequence' ? t('Pick a collection or folder to load test.') : t('Pick a flow to load test.')}</span>}
        </div>
        {error && <div className="px-3 py-1.5 bg-red-900/40 border border-red-700/50 rounded text-xs text-red-400">{error}</div>}
      </div>

      {/* Live progress */}
      {running && (
        <div className="px-5 pb-3 flex-shrink-0 flex flex-col gap-2">
          <div className="h-2 bg-surface-800 rounded overflow-hidden">
            <div className="h-full bg-amber-500 transition-[width] duration-300" style={{ width: `${Math.round(frac * 100)}%` }} />
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-surface-400 tabular-nums">
            <span>{t('Iterations')} <span className="text-surface-100 font-medium">{progress?.iterations ?? 0}</span></span>
            <span>{t('Active users')} <span className="text-surface-100 font-medium">{progress?.activeVus ?? 0}</span></span>
            <span>{t('Target')} <span className="text-amber-400 font-medium">{Math.round(progress?.targetNow ?? 0)} {unit}</span></span>
            <span>{t('Failed')} <span className={`font-medium ${(progress?.iterationsFailed ?? 0) > 0 ? 'text-red-400' : 'text-surface-100'}`}>{progress?.iterationsFailed ?? 0}</span></span>
            <span>{t('iter/s')} <span className="text-amber-400 font-medium">{(progress?.iterationsPerSec ?? 0).toFixed(1)}</span></span>
            <span>{t('p95')} <span className="text-fuchsia-400 font-medium">{fmtMs(progress?.p95 ?? 0)}</span></span>
            <span>{t('elapsed')} <span className="text-surface-100 font-medium">{fmtMs(progress?.elapsedMs ?? 0)}</span></span>
          </div>
          <LiveChart samples={samples} />
        </div>
      )}

      {/* Results */}
      {result && !running && (
        <div className="px-5 pb-6 flex flex-col gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            {result.thresholds.length > 0 && (
              <span className={`text-xs font-bold px-2.5 py-1 rounded ${result.passed ? 'bg-emerald-900/50 text-emerald-300' : 'bg-red-900/50 text-red-300'}`}>
                {result.passed ? t('PASSED') : t('FAILED')}
              </span>
            )}
            {result.stopped && <span className="text-[11px] text-amber-400">{t('Run was stopped early.')}</span>}
            <button onClick={exportReport} disabled={exporting}
              className="ml-auto px-3 py-1 text-xs rounded border border-surface-700 text-surface-300 hover:text-white hover:border-amber-500 transition-colors disabled:opacity-50">
              {exporting ? t('Saving…') : t('Export HTML report')}
            </button>
          </div>

          {result.thresholds.length > 0 && (
            <div className="bg-surface-900 border border-surface-800 rounded p-3">
              <div className="text-[10px] uppercase tracking-wider text-surface-500 mb-2">{t('Thresholds')}</div>
              <div className="flex flex-col gap-1">
                {result.thresholds.map((th, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className={th.passed ? 'text-emerald-400' : 'text-red-400'}>{th.passed ? '✓' : '✗'}</span>
                    <span className="text-surface-300">{t(THRESHOLD_METRIC_LABELS[th.metric])} {THRESHOLD_OP_LABELS[th.op]} {th.value}</span>
                    <span className="text-surface-500 tabular-nums">{t('actual')} {th.metric === 'error_rate' ? `${th.actual.toFixed(1)}%` : th.metric === 'throughput' ? th.actual.toFixed(1) : fmtMs(th.actual)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label={t('Throughput')} value={result.iterationsPerSec.toFixed(1)} sub={`${t('iter/s')} · ${result.requestsPerSec.toFixed(1)} ${t('req/s')}`} accent />
            <Stat label={t('Iteration p95')} value={fmtMs(result.iterationLatency.p95)} sub={`${t('p99')} ${fmtMs(result.iterationLatency.p99)}`} />
            <Stat label={t('Error rate')} value={`${errorRate.toFixed(1)}%`} sub={`${result.iterationsFailed} / ${result.iterations} ${t('iterations')}`} />
            <Stat label={t('Peak users')} value={String(result.peakVus)} sub={result.droppedArrivals > 0 ? `${result.droppedArrivals} ${t('dropped')}` : fmtMs(result.durationMs)} />
          </div>

          <SeriesChart series={result.series} />

          {/* Per-step breakdown */}
          <div className="bg-surface-900 border border-surface-800 rounded p-3">
            <div className="text-[10px] uppercase tracking-wider text-surface-500 mb-2">{result.mode === 'flow' ? t('Steps (per request in the flow)') : result.mode === 'sequence' ? t('Steps (per request in the sequence)') : t('Request')}</div>
            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-surface-600">
                <span className="col-span-5">{t('Step')}</span>
                <span className="col-span-1 text-right">{t('count')}</span>
                <span className="col-span-2 text-right">{t('p95')}</span>
                <span className="col-span-2 text-right">{t('mean')}</span>
                <span className="col-span-2 text-right">{t('fail')}</span>
              </div>
              {result.steps.map((s, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 text-[11px] tabular-nums items-center">
                  <span className="col-span-5 text-surface-200 truncate" title={s.name}>{result.mode !== 'request' ? `${i + 1}. ` : ''}{s.name}</span>
                  <span className="col-span-1 text-right text-surface-400">{s.count}</span>
                  <span className="col-span-2 text-right text-surface-200">{fmtMs(s.latency.p95)}</span>
                  <span className="col-span-2 text-right text-surface-400">{fmtMs(s.latency.mean)}</span>
                  <span className={`col-span-2 text-right ${s.failed > 0 ? 'text-red-400' : 'text-surface-500'}`}>{s.failed}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-surface-900 border border-surface-800 rounded p-3">
              <div className="text-[10px] uppercase tracking-wider text-surface-500 mb-2">{t('Request latency (all steps)')}</div>
              <div className="grid grid-cols-4 gap-y-1.5 text-xs tabular-nums">
                {([['min', result.requestLatency.min], ['mean', result.requestLatency.mean], ['p50', result.requestLatency.p50], ['p90', result.requestLatency.p90], ['p95', result.requestLatency.p95], ['p99', result.requestLatency.p99], ['max', result.requestLatency.max]] as const).map(([k, v]) => (
                  <React.Fragment key={k}>
                    <span className="text-surface-500 uppercase col-span-1">{k}</span>
                    <span className="text-surface-200 col-span-3">{fmtMs(v)}</span>
                  </React.Fragment>
                ))}
              </div>
              <div className="mt-2 pt-2 border-t border-surface-800 text-[11px] text-surface-500">
                {t('Data read')} <span className="text-surface-300">{fmtBytes(result.bytes)}</span> · <span className="text-surface-300">{fmtBytes(result.bytesPerSec)}/s</span>
              </div>
            </div>

            <div className="bg-surface-900 border border-surface-800 rounded p-3 flex flex-col gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-surface-500 mb-2">{t('Status codes')}</div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(result.statusCounts).sort((a, b) => b[1] - a[1]).map(([code, count]) => (
                    <span key={code} className={`text-[11px] tabular-nums border rounded px-1.5 py-0.5 ${statusColor(code)}`}>
                      {code === 'error' ? t('error') : code} <span className="opacity-70">×{count}</span>
                    </span>
                  ))}
                </div>
              </div>
              {Object.keys(result.errors).length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-surface-500 mb-1">{t('Errors')}</div>
                  <div className="flex flex-col gap-1">
                    {Object.entries(result.errors).sort((a, b) => b[1] - a[1]).map(([msg, count]) => (
                      <div key={msg} className="text-[11px] text-red-400/90 font-mono break-all">{msg} <span className="text-surface-500">×{count}</span></div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!result && !running && (
        <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-surface-500">
          {t('Set the load and run this plan.')}
        </div>
      )}
    </div>
  );
}
