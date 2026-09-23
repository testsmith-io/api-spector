// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// First-run product tour. Shows exactly once — the first time a workspace is
// open — a 3-step spotlight walking through creating a collection, an
// environment, and a request. Dependency-free: it finds each target by a
// [data-tour] attribute, dims the rest of the screen with a box-shadow "hole",
// and anchors a tooltip beside it. Marking it seen on start guarantees it never
// reappears (per the "only first time" requirement).

import { useEffect, useLayoutEffect, useState } from 'react';
import { useStore } from '../../store';
import { useT } from '../../i18n';

const SEEN_KEY = 'productTourSeen';
const CARD_W = 320;

// Dispatched (e.g. from Settings) to replay the tour on demand.
export const START_TOUR_EVENT = 'apispector:start-tour';

interface Step { target: string; title: string; body: string }

export function ProductTour() {
  const t = useT();
  const workspace = useStore(s => s.workspace);
  const setSidebarTab = useStore(s => s.setSidebarTab);

  const [active, setActive] = useState(false);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const steps: Step[] = [
    {
      target: 'new-collection',
      title: t('1. Create a collection'),
      body: t('Collections group related requests. Click the + to add your first one.'),
    },
    {
      target: 'environment-bar',
      title: t('2. Add an environment'),
      body: t('Environments hold variables like base URLs and tokens. Open this to create one and switch between them.'),
    },
    {
      target: 'collections-panel',
      title: t('3. Add a request'),
      body: t('Right-click a collection (or open its ⋯ menu) and choose New request to start sending.'),
    },
    {
      target: 'history',
      title: t('4. Replay from History'),
      body: t('Every request you send is recorded here. Click any entry to inspect or replay it.'),
    },
    {
      target: 'contracts',
      title: t('5. Contract testing and fuzzing'),
      body: t('Validate responses against an OpenAPI contract, or fuzz your API to surface crashes and spec violations.'),
    },
    {
      target: 'mocks',
      title: t('6. Mock servers'),
      body: t('Spin up a local mock server from your requests to develop against before the real API is ready.'),
    },
    {
      target: 'git',
      title: t('7. Open from Git'),
      body: t('Open a workspace straight from a Git repository to share collections with your team.'),
    },
  ];

  // Start once, the first time a workspace is open. Mark seen immediately so it
  // never reappears, even if the app is closed mid-tour.
  useEffect(() => {
    if (!workspace || active) return;
    let seen = true;
    try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch { seen = false; }
    if (seen) return;
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage disabled */ }
    // The sidebar defaults to open on the Collections tab, so the collection and
    // request anchors are already on screen; make sure of the tab all the same.
    setSidebarTab('collections');
    setActive(true);
  }, [workspace, active, setSidebarTab]);

  // Track the current target's position (it can move as panels render/resize).
  const targetSel = active ? steps[i].target : null;
  useLayoutEffect(() => {
    if (!targetSel) return;
    const measure = (): void => {
      const el = document.querySelector(`[data-tour="${targetSel}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener('resize', measure);
    const id = window.setInterval(measure, 300);
    return () => { window.removeEventListener('resize', measure); window.clearInterval(id); };
  }, [targetSel]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setActive(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  // Replay on demand (from Settings), regardless of the seen flag.
  useEffect(() => {
    const onStart = (): void => { setI(0); setRect(null); setSidebarTab('collections'); setActive(true); };
    window.addEventListener(START_TOUR_EVENT, onStart);
    return () => window.removeEventListener(START_TOUR_EVENT, onStart);
  }, [setSidebarTab]);

  if (!active) return null;

  const step = steps[i];
  const last = i === steps.length - 1;
  const finish = (): void => setActive(false);
  const next = (): void => (last ? finish() : setI(i + 1));
  const back = (): void => setI(Math.max(0, i - 1));

  const pad = 6;
  const hole = rect
    ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null;

  // Anchor the card beside the target, clamped to the viewport. Narrow targets
  // (the activity-bar icons) get the card to their right; wider targets get it
  // below when there is room, else above. Centered when no target was found.
  const CARD_H = 200;
  let cardLeft = window.innerWidth / 2 - CARD_W / 2;
  let cardTop = window.innerHeight / 2 - 90;
  if (rect) {
    const clampTop = (top: number): number => Math.min(Math.max(12, top), Math.max(12, window.innerHeight - CARD_H - 12));
    if (rect.width < 120 && rect.right + 14 + CARD_W + 12 <= window.innerWidth) {
      cardLeft = rect.right + 14;
      cardTop = clampTop(rect.top);
    } else {
      cardLeft = Math.min(Math.max(12, rect.left), window.innerWidth - CARD_W - 12);
      cardTop = rect.bottom + 14 + CARD_H <= window.innerHeight ? rect.bottom + 14 : Math.max(12, rect.top - CARD_H - 14);
    }
  }

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Block interaction with the app while the tour is up. */}
      <div className="absolute inset-0" />

      {hole ? (
        <div
          className="absolute rounded-md pointer-events-none transition-all"
          style={{
            top: hole.top, left: hole.left, width: hole.width, height: hole.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
            outline: '2px solid #3b82f6', outlineOffset: '2px',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/60" />
      )}

      <div
        className="absolute bg-surface-900 border border-surface-700 rounded-lg shadow-2xl p-4 flex flex-col gap-2"
        style={{ top: cardTop, left: cardLeft, width: CARD_W }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-surface-500">{t('Step :n of :total', { n: i + 1, total: steps.length })}</span>
          <button onClick={finish} className="text-surface-500 hover:text-surface-300 text-xs">{t('Skip tour')}</button>
        </div>
        <h3 className="text-sm font-semibold text-white">{step.title}</h3>
        <p className="text-xs text-surface-300 leading-relaxed">{step.body}</p>
        <div className="flex items-center justify-end gap-2 pt-1">
          {i > 0 && (
            <button onClick={back} className="px-3 py-1 text-xs rounded border border-surface-700 text-surface-300 hover:bg-surface-800 transition-colors">{t('Back')}</button>
          )}
          <button onClick={next} className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors">{last ? t('Done') : t('Next')}</button>
        </div>
      </div>
    </div>
  );
}
