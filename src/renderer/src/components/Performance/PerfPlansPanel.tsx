// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Left-panel list of performance test plans. Plans live inline in the workspace
// (.spector), like design contracts, so they travel with the project. Add,
// select, rename and delete here; the selected plan is edited and run in the
// PerformancePanel (main area).

import React, { useState } from 'react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import type { Workspace, PerfPlan } from '../../../../shared/types';

const { electron } = window;

function makePlan(name: string): PerfPlan {
  return {
    id: crypto.randomUUID(),
    name,
    target: { kind: 'request', requestId: '' },
    pattern: 'basic',
    basic: { vus: 10, rampUpSec: 0, durationSec: 30, rampDownSec: 0 },
    stepping: { startUsers: 5, stepUsers: 5, stepDurationSec: 30, maxUsers: 50, rampStepSec: 0, holdFinalSec: 0 },
    arrivals: { rate: 20, durationSec: 60, maxVus: 200 },
    custom: { stages: [{ durationSec: 30, target: 20, ramp: true }, { durationSec: 60, target: 20, ramp: false }, { durationSec: 15, target: 0, ramp: true }] },
    timeoutSec: 0,
    thresholds: [],
    thinkTime: { minSec: 0, maxSec: 0 },
  };
}

function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

export function PerfPlansPanel() {
  const t = useT();
  const workspace = useStore(s => s.workspace);
  const workspacePath = useStore(s => s.workspacePath);
  const setWorkspace = useStore(s => s.setWorkspace);
  const activeId = useStore(s => s.activePerfPlanId);
  const setActiveId = useStore(s => s.setActivePerfPlanId);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const plans = workspace?.perfPlans ?? [];

  async function persist(next: PerfPlan[]) {
    if (!workspace) return;
    const updated: Workspace = { ...workspace, perfPlans: next };
    setWorkspace(updated, workspacePath ?? '');
    try { await electron.saveWorkspace(updated); } catch { /* best-effort */ }
  }

  async function add() {
    const plan = makePlan(uniqueName(t('New plan'), plans.map(p => p.name)));
    await persist([...plans, plan]);
    setActiveId(plan.id);
  }

  async function remove(id: string) {
    await persist(plans.filter(p => p.id !== id));
    if (activeId === id) setActiveId(null);
  }

  async function commitRename(id: string) {
    const name = draft.trim();
    setEditing(null);
    if (!name) return;
    await persist(plans.map(p => p.id === id ? { ...p, name: uniqueName(name, plans.filter(q => q.id !== id).map(q => q.name)) } : p));
  }

  if (!workspace) {
    return <div className="p-3 text-[11px] text-surface-500">{t('Open a workspace to create performance test plans.')}</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 flex-shrink-0">
        <button
          onClick={add}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-surface-700 text-xs text-surface-300 hover:text-white hover:border-amber-500 transition-colors"
        >
          <span className="text-sm leading-none">+</span> {t('New plan')}
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 flex flex-col gap-0.5">
        {plans.length === 0 ? (
          <div className="px-2 py-4 text-[11px] text-surface-500 leading-relaxed">
            {t('No plans yet. Create one to load test a request. Functional testing is unaffected.')}
          </div>
        ) : plans.map(p => (
          <div
            key={p.id}
            onClick={() => setActiveId(p.id)}
            className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${activeId === p.id ? 'bg-surface-800 text-white' : 'text-surface-400 hover:bg-surface-800/50 hover:text-surface-200'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${activeId === p.id ? 'bg-amber-400' : 'bg-surface-600'}`} />
            {editing === p.id ? (
              <input
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onClick={e => e.stopPropagation()}
                onBlur={() => commitRename(p.id)}
                onKeyDown={e => { if (e.key === 'Enter') commitRename(p.id); if (e.key === 'Escape') setEditing(null); }}
                className="flex-1 min-w-0 bg-surface-900 border border-surface-700 rounded px-1 py-0.5 text-xs focus:outline-none focus:border-amber-500"
              />
            ) : (
              <span
                className="flex-1 min-w-0 truncate text-xs"
                onDoubleClick={e => { e.stopPropagation(); setEditing(p.id); setDraft(p.name); }}
                title={p.name}
              >
                {p.name}
              </span>
            )}
            <button
              onClick={e => { e.stopPropagation(); remove(p.id); }}
              title={t('Delete plan')}
              className="opacity-0 group-hover:opacity-100 text-surface-600 hover:text-red-400 transition-all text-xs leading-none px-0.5 flex-shrink-0"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
