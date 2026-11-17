// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Perf benchmark for the collection sidebar with a gigantic flat collection.
// Measures row renders + wall time on mount and on a selection change, across:
//   raw            - RequestRow as-is (no memo)
//   memo (shallow) - React.memo with default compare (defeated by inline props)
//   memo (compare) - React.memo with a prop-aware comparator (the fix)
//   windowed       - render only the ~visible rows (virtualization proxy)
// Run: npx vitest run --project renderer src/renderer/src/tests/collection-tree-bench.test.tsx

import * as React from 'react';
import { useState, memo, Profiler } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

// --- Mocks: keep rows hermetic (no real store / i18n / cloud / modals). ---
vi.mock('../components/CollectionTree/CollectionTree', async () => {
  const { createContext } = await vi.importActual<typeof React>('react');
  return {
    DragCtx: createContext({ dragging: null, setDragging: () => {}, onDropRequest: () => {}, onDropFolder: () => {}, onReorderChild: () => {} }),
    SelectionCtx: createContext({ active: false, isSelected: () => false, toggle: () => {}, clear: () => {} }),
    TagChips: () => null,
  };
});
vi.mock('../components/CollectionTree/SchemaSyncModal', () => ({ SchemaSyncModal: () => null }));
vi.mock('../store', () => {
  const state = { addSecurityTests: () => 0, collections: {} as Record<string, unknown> };
  const useStore = Object.assign((selector: (s: typeof state) => unknown) => selector(state), { getState: () => state });
  return { useStore };
});
vi.mock('../i18n', () => ({ useT: () => (key: string, vars?: Record<string, unknown>) => {
  const pick = key.includes('|') ? (Number(vars?.count) === 1 ? key.split('|')[0] : key.split('|')[1]) : key;
  return pick.replace(/:(\w+)/g, (_m, k) => String(vars?.[k] ?? ''));
} }));
vi.mock('../components/common/Toast', () => ({ useToast: () => ({ toast: null, show: () => {} }), Toast: () => null }));
vi.mock('../lib/cloud-push', () => ({ cloudEnabled: () => false, pushRequestAsMonitor: vi.fn() }));

// Measure the raw implementation; the "memo (comparator)" variant below mirrors
// exactly what the shipped `RequestRow` (memo + rowPropsEqual) now does.
import { RequestRowRaw as RequestRow, type RequestRowProps } from '../components/CollectionTree/RequestRow';

const N = 3000;
const VISIBLE = 40; // rows a typical sidebar viewport shows
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const REQS = Array.from({ length: N }, (_, i) => ({
  id: 'r' + i, name: 'Request ' + i, url: '{{base}}/resource/' + i, method: METHODS[i % 5] as string,
}));

// The proposed comparator: compare the data/display props, ignore the
// behaviourally-stable callbacks and compare tags/examples by value.
function sameArr(a?: readonly string[], b?: readonly string[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return a === b || (!!a && !!b && a.length === b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function areEqual(p: RequestRowProps, n: RequestRowProps): boolean {
  return p.reqId === n.reqId && p.name === n.name && p.url === n.url && p.method === n.method
    && p.protocol === n.protocol && p.authType === n.authType && p.hookType === n.hookType
    && p.disabled === n.disabled && p.isActive === n.isActive && p.autoRename === n.autoRename
    && p.indent === n.indent && p.activeExampleId === n.activeExampleId
    && sameArr(p.tags, n.tags) && (p.examples?.length ?? 0) === (n.examples?.length ?? 0);
}

// Row props built fresh each render (inline callbacks + new arrays), exactly
// like FolderContents does in the real tree.
function makeProps(r: { id: string; name: string; url: string; method: string }, activeId: string): RequestRowProps {
  return {
    reqId: r.id, collectionId: 'c1', folderId: 'f1', name: r.name, url: r.url, method: r.method,
    authType: 'none', tags: [], isActive: r.id === activeId, indent: 12,
    onSelect: () => {}, onRename: () => {}, onDelete: () => {}, onDuplicate: () => {},
    onUpdateTags: () => {}, onSetHookType: () => {}, onToggleDisabled: () => {},
  };
}

// Count how many rows actually (re-)render. The counter sits INSIDE the memo
// boundary, so a skipped row never increments it.
let rowRenders = 0;
function countingFactory(Base: React.ComponentType<RequestRowProps>): React.ComponentType<RequestRowProps> {
  return function Counted(props: RequestRowProps) { rowRenders++; return <Base {...props} />; };
}

let setActiveExternal: (id: string) => void = () => {};
function Bench({ Row, count }: { Row: React.ComponentType<RequestRowProps>; count: number }) {
  const [active, setActive] = useState('r0');
  setActiveExternal = setActive;
  return <>{REQS.slice(0, count).map(r => <Row key={r.id} {...makeProps(r, active)} />)}</>;
}

function measure(label: string, Row: React.ComponentType<RequestRowProps>, count = N) {
  rowRenders = 0;
  const commits: { phase: string; actual: number }[] = [];
  const onRender = (_id: string, phase: string, actual: number) => commits.push({ phase, actual });
  const t0 = performance.now();
  render(<Profiler id="t" onRender={onRender}><Bench Row={Row} count={count} /></Profiler>);
  const mountWall = performance.now() - t0;
  const mountRenders = rowRenders;
  const mountActual = commits.filter(c => c.phase === 'mount').reduce((s, c) => s + c.actual, 0);

  rowRenders = 0; commits.length = 0;
  const t1 = performance.now();
  act(() => setActiveExternal('r' + Math.floor(count / 2))); // change selection
  const updateWall = performance.now() - t1;
  const updateRenders = rowRenders;
  const updateActual = commits.filter(c => c.phase === 'update').reduce((s, c) => s + c.actual, 0);
  cleanup();
  return { label, rows: count, mountRenders, mountWall: +mountWall.toFixed(1), mountActual: +mountActual.toFixed(1), updateRenders, updateWall: +updateWall.toFixed(1), updateActual: +updateActual.toFixed(1) };
}

describe('collection sidebar perf', () => {
  it('benchmarks mount + selection re-render for a gigantic collection', () => {
    const results = [
      measure('raw (no memo)', countingFactory(RequestRow)),
      measure('memo (shallow)', memo(countingFactory(RequestRow))),
      measure('memo (comparator)', memo(countingFactory(RequestRow), areEqual)),
      measure('windowed/raw (virtualization proxy)', countingFactory(RequestRow), VISIBLE),
    ];
    // eslint-disable-next-line no-console
    console.log('\n=== COLLECTION SIDEBAR BENCHMARK (' + N + ' requests) ===\n' +
      results.map(r => `${r.label.padEnd(36)} mount: ${String(r.mountRenders).padStart(4)} rows ${String(r.mountWall).padStart(7)}ms (react ${r.mountActual}ms) | update: ${String(r.updateRenders).padStart(4)} rows ${String(r.updateWall).padStart(7)}ms (react ${r.updateActual}ms)`).join('\n') + '\n');
    // Sanity: the comparator variant re-renders only the two toggled rows.
    const compare = results.find(r => r.label.startsWith('memo (comparator)'))!;
    expect(compare.updateRenders).toBeLessThan(10);
    expect(results[0].updateRenders).toBe(N); // raw re-renders everything
  }, 180000);
});
