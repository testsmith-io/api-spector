// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// The flow editor: a React Flow canvas with an Add-block menu, a config
// inspector, a run bar and an output panel. The live RF node/edge state is the
// source of truth while mounted (block config lives in node.data); every change
// mirrors back into the store, which autosaves. Running ships the graph to the
// main-process engine and paints streamed per-block status onto the nodes.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState, useReactFlow,
  type Node, type Edge, type Connection, type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../../store';
import { BLOCK_SPECS, BLOCKS_BY_CATEGORY } from '../../../../shared/flow-blocks';
import { flowNodeTypes } from './flowNodes';
import { buildFlowHtmlReport } from '../../../../shared/flow-report';
import { cloudEnabled, pushFlowToCloud, runFlowInCloud, openCloudFlow } from '../../lib/cloud-push';
import { useFlowRunner } from './useFlowRunner';
import { FlowInspector } from './FlowInspector';
import type { Flow, FlowBlock, FlowEdge, FlowBlockType, FlowBlockConfig, FlowBlockCategory } from '../../../../shared/types';
import { useT } from '../../i18n';

const NODE_TYPES = flowNodeTypes;

// ─── RF ⇄ Flow conversion ──────────────────────────────────────────────────

function toRfNodes(flow: Flow): Node[] {
  return flow.nodes.map(n => ({
    id: n.id, type: n.type, position: n.position,
    data: { config: n.config ?? {}, label: n.label, color: n.color },
  }));
}
function toRfEdges(flow: Flow): Edge[] {
  return flow.edges.map(e => ({
    id: e.id, source: e.source, target: e.target,
    // Default to the single 'out'/'in' handles so edges authored without
    // explicit ports (imported / generated flows) still attach and render.
    sourceHandle: e.sourcePort ?? 'out', targetHandle: e.targetPort ?? 'in',
  }));
}
function toFlowNodes(nodes: Node[]): FlowBlock[] {
  return nodes.map(n => {
    const data = (n.data ?? {}) as { config?: FlowBlockConfig; label?: string; color?: string };
    return { id: n.id, type: n.type as FlowBlockType, position: n.position, label: data.label, color: data.color, config: data.config ?? {} };
  });
}
function toFlowEdges(edges: Edge[]) {
  return edges.map(e => ({
    id: e.id, source: e.source, target: e.target,
    sourcePort: e.sourceHandle ?? undefined, targetPort: e.targetHandle ?? undefined,
  }));
}

// ─── Add-block menu ──────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<FlowBlockCategory, string> = {
  action: 'Action', logic: 'Logic', looping: 'Looping', visualize: 'Visualize',
};

// Auto-layout: layer blocks left-to-right by longest path from the start, then
// place them using each node's MEASURED size so nothing overlaps — columns
// advance by the previous column's widest node, and nodes stack by real height.
// Hand-rolled (no graph-layout dependency), good enough for flow-sized graphs.
function layeredLayout(
  nodes: Node[],
  edges: Edge[],
  dims: Map<string, { w: number; h: number }>,
): Map<string, { x: number; y: number }> {
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  nodes.forEach(n => { adj.set(n.id, []); indeg.set(n.id, 0); });
  edges.forEach(e => {
    if (adj.has(e.source) && indeg.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    }
  });
  const layer = new Map<string, number>();
  nodes.forEach(n => layer.set(n.id, 0));
  const work = new Map(indeg);
  const queue = nodes.filter(n => (indeg.get(n.id) ?? 0) === 0).map(n => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const t of adj.get(id) ?? []) {
      if ((layer.get(t) ?? 0) < (layer.get(id) ?? 0) + 1) layer.set(t, (layer.get(id) ?? 0) + 1);
      work.set(t, (work.get(t) ?? 0) - 1);
      if ((work.get(t) ?? 0) === 0) queue.push(t);
    }
  }
  const byLayer = new Map<number, Node[]>();
  nodes.forEach(n => {
    const l = layer.get(n.id) ?? 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(n);
  });

  const X0 = 60, Y0 = 60, XGAP = 90, YGAP = 48, FALLBACK = { w: 220, h: 90 };
  const pos = new Map<string, { x: number; y: number }>();
  let x = X0;
  for (const l of [...byLayer.keys()].sort((a, b) => a - b)) {
    const group = byLayer.get(l)!.sort((a, b) => a.position.y - b.position.y);
    let y = Y0;
    let colW = 0;
    for (const n of group) {
      const d = dims.get(n.id) ?? FALLBACK;
      pos.set(n.id, { x, y });
      y += d.h + YGAP;             // stack by real height → no vertical overlap
      if (d.w > colW) colW = d.w;
    }
    x += colW + XGAP;             // next column clears the widest node → no horizontal overlap
  }
  return pos;
}

// Color a traversed edge by the outcome its source port represents.
function edgeColor(sourcePort?: string | null): string {
  if (sourcePort === 'fail' || sourcePort === 'false') return '#ef4444';
  if (sourcePort === 'success' || sourcePort === 'true' || sourcePort === 'pass') return '#10b981';
  return '#3b82f6';
}

function BlockPickerList({ onPick, includeEnd }: { readonly onPick: (type: FlowBlockType) => void; readonly includeEnd?: boolean }) {
  const t = useT();
  const Item = (spec: { type: FlowBlockType; label: string; description: string }) => (
    <button
      key={spec.type}
      onClick={() => onPick(spec.type)}
      className="w-full text-left px-3 py-1.5 hover:bg-surface-800 transition-colors"
      title={spec.description}
    >
      <div className="text-xs text-[var(--text-primary)]">{spec.label}</div>
      <div className="text-[10px] text-surface-500 truncate">{spec.description}</div>
    </button>
  );
  return (
    <div className="py-1">
      {BLOCKS_BY_CATEGORY.map(({ category, blocks }) => (
        <div key={category}>
          <div className="px-3 py-1 text-[9px] uppercase tracking-widest text-surface-600 font-semibold">{t(CATEGORY_LABEL[category])}</div>
          {blocks.map(spec => Item(spec))}
        </div>
      ))}
      {includeEnd && (
        <div>
          <div className="px-3 py-1 text-[9px] uppercase tracking-widest text-surface-600 font-semibold">{t('Terminal')}</div>
          {Item(BLOCK_SPECS.end)}
        </div>
      )}
    </div>
  );
}

function AddBlockMenu({ onAdd }: { readonly onAdd: (type: FlowBlockType) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="px-3 py-1.5 text-xs text-white bg-blue-700 hover:bg-blue-600 rounded font-medium transition-colors flex items-center gap-1.5"
      >
        <span className="text-sm leading-none">+</span> {t('Add block')}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" role="button" tabIndex={-1} aria-label={t('Close menu')}
            onClick={() => setOpen(false)} onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }} />
          <div className="absolute left-0 top-full mt-1 z-50 w-56 bg-surface-900 border border-surface-700 rounded-lg shadow-2xl max-h-[70vh] overflow-y-auto">
            <BlockPickerList onPick={type => { onAdd(type); setOpen(false); }} />
          </div>
        </>
      )}
    </div>
  );
}

// ─── Output panel ──────────────────────────────────────────────────────────

const LOG_ICON: Record<string, string> = {
  passed: '✓', failed: '✗', error: '⚠', running: '•', done: '•', skipped: '○',
};
const LOG_ICON_CLS: Record<string, string> = {
  passed: 'text-emerald-400', failed: 'text-red-400', error: 'text-orange-400',
  done: 'text-surface-500', skipped: 'text-surface-500', running: 'text-blue-400',
};

function formatLogText(log: ReturnType<typeof useFlowRunner>['log']): string {
  const lines = log.map(e => {
    const t = e.atMs != null ? `+${e.atMs}ms`.padStart(8) : '        ';
    const iter = e.iteration != null ? ` #${e.iteration}` : '';
    if (e.kind === 'log') return `${t}  · ${e.message ?? ''}`;
    if (e.kind === 'display') {
      const v = typeof e.value === 'string' ? e.value : JSON.stringify(e.value);
      return `${t}  ▣ ${e.label ?? 'display'}: ${v}`;
    }
    const icon = LOG_ICON[e.status ?? 'done'] ?? '•';
    const http = e.httpStatus != null ? ` ${e.httpStatus}` : '';
    const dur = e.durationMs != null ? ` ${e.durationMs}ms` : '';
    const err = e.error ? `  — ${e.error}` : '';
    return `${t}  ${icon} ${(e.label ?? e.type ?? '')}${iter}${http}${dur}${err}`;
  });
  return lines.join('\n') + '\n';
}

function BottomPanel({ runner, flowName }: { readonly runner: ReturnType<typeof useFlowRunner>; readonly flowName: string }) {
  const t = useT();
  const { outputs, variables, data, log, summary } = runner;
  const varEntries = Object.entries(variables);
  // Rich data values that aren't already visible as a scalar variable.
  const dataEntries = Object.entries(data).filter(([k, v]) => typeof v === 'object' && v !== null || !(k in variables));
  const hasVars = varEntries.length > 0 || dataEntries.length > 0;
  const hasLog = log.length > 0;
  const [tab, setTab] = useState<'log' | 'output' | 'variables'>('log');

  if (!hasLog && outputs.length === 0 && !hasVars) return null;
  const active = (tab === 'log' && hasLog) || (tab === 'output' && outputs.length > 0) || (tab === 'variables' && hasVars)
    ? tab
    : hasLog ? 'log' : outputs.length > 0 ? 'output' : 'variables';

  const Tab = ({ id, label }: { id: 'log' | 'output' | 'variables'; label: string }) => (
    <button
      onClick={() => setTab(id)}
      className={`px-3 py-1.5 text-[10px] uppercase tracking-widest transition-colors ${active === id ? 'text-[var(--text-primary)] border-b-2 border-blue-500' : 'text-surface-600 hover:text-surface-400'}`}
    >{label}</button>
  );

  return (
    <div className="h-44 flex-shrink-0 border-t border-surface-800 bg-surface-950 flex flex-col">
      <div className="flex items-center gap-1 border-b border-surface-800 flex-shrink-0 sticky top-0">
        {hasLog && <Tab id="log" label={t('Run log')} />}
        {outputs.length > 0 && <Tab id="output" label={t('Output')} />}
        {hasVars && <Tab id="variables" label={t('Variables')} />}
        <div className="ml-auto mr-2 flex items-center gap-1.5">
          {summary && (
            <button
              onClick={() => window.electron.saveResults(buildFlowHtmlReport(summary, { flow: flowName }), 'flow-report.html')}
              className="px-2 py-0.5 text-[10px] text-surface-400 hover:text-surface-200 bg-surface-800 hover:bg-surface-700 rounded transition-colors"
            >{t('Export report')}</button>
          )}
          {hasLog && (
            <button
              onClick={() => window.electron.saveResults(formatLogText(log), 'flow-run-log.txt')}
              className="px-2 py-0.5 text-[10px] text-surface-400 hover:text-surface-200 bg-surface-800 hover:bg-surface-700 rounded transition-colors"
            >{t('Export log')}</button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {active === 'log' ? (
          <div className="flex flex-col gap-0.5 font-mono text-[11px]">
            {log.map((e, i) => {
              const at = e.atMs != null ? `+${e.atMs}ms` : '';
              if (e.kind === 'log') return <div key={i} className="text-cyan-300"><span className="text-surface-600 mr-2">{at}</span>· {e.message}</div>;
              if (e.kind === 'display') return (
                <div key={i} className="text-teal-400"><span className="text-surface-600 mr-2">{at}</span>▣ {e.label ?? 'display'}: <span className="text-surface-300 break-all">{typeof e.value === 'string' ? e.value : JSON.stringify(e.value)}</span></div>
              );
              return (
                <div key={i} className="flex items-baseline gap-2">
                  <span className="text-surface-600 w-14 shrink-0 text-right">{at}</span>
                  <span className={LOG_ICON_CLS[e.status ?? 'done']}>{LOG_ICON[e.status ?? 'done'] ?? '•'}</span>
                  <span className="text-surface-300">{e.label ?? e.type}{e.iteration != null && <span className="text-surface-600"> #{e.iteration}</span>}</span>
                  {e.httpStatus != null && <span className={e.httpStatus < 400 ? 'text-emerald-400' : 'text-red-400'}>{e.httpStatus}</span>}
                  {e.durationMs != null && <span className="text-surface-600">{e.durationMs}ms</span>}
                  {e.error && <span className="text-red-400 break-all">— {e.error}</span>}
                </div>
              );
            })}
          </div>
        ) : active === 'output' ? (
          <div className="flex flex-col gap-1.5">
            {outputs.map((o, i) => (
              <div key={i} className="text-xs font-mono">
                {o.kind === 'log' ? (
                  <span className="text-cyan-300">· {o.message}</span>
                ) : (
                  <div>
                    <span className="text-teal-400">▣ {o.label ?? 'display'}: </span>
                    <pre className="inline whitespace-pre-wrap break-words text-surface-300">
                      {typeof o.value === 'string' ? o.value : JSON.stringify(o.value, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {varEntries.map(([k, v]) => (
                <tr key={k} className="border-b border-surface-800/40">
                  <td className="py-1 pr-3 font-mono text-emerald-300 align-top whitespace-nowrap">{k}</td>
                  <td className="py-1 font-mono text-surface-300 break-all">{v}</td>
                </tr>
              ))}
              {dataEntries.filter(([, v]) => typeof v === 'object' && v !== null).map(([k, v]) => (
                <tr key={'d:' + k} className="border-b border-surface-800/40">
                  <td className="py-1 pr-3 font-mono text-violet-300 align-top whitespace-nowrap">{k}</td>
                  <td className="py-1 font-mono text-surface-400 break-all"><pre className="whitespace-pre-wrap">{JSON.stringify(v)}</pre></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────

function FlowEditor({ flow }: { readonly flow: Flow }) {
  const t = useT();
  const setFlowGraph = useStore(s => s.setFlowGraph);
  const addFlowObject = useStore(s => s.addFlowObject);
  const renameFlow = useStore(s => s.renameFlow);
  const environments = useStore(s => s.environments);
  const activeEnvId  = useStore(s => s.activeEnvironmentId);
  const theme        = useStore(s => s.theme);

  const [nodes, setNodes, onNodesChange] = useNodesState(useMemo(() => toRfNodes(flow), [flow]));
  const [edges, setEdges, onEdgesChange] = useEdgesState(useMemo(() => toRfEdges(flow), [flow]));
  const [selectedEnv, setSelectedEnv] = useState(activeEnvId ?? '');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(flow.name);

  const { screenToFlowPosition, fitView, getNodes } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const runner = useFlowRunner();

  const autoLayout = useCallback(() => {
    // Use React Flow's measured sizes so the layout clears each node's real
    // footprint (blocks vary in width/height) and never overlaps.
    const dims = new Map(getNodes().map(n => [n.id, {
      w: n.measured?.width ?? n.width ?? 220,
      h: n.measured?.height ?? n.height ?? 90,
    }]));
    const pos = layeredLayout(nodes, edges, dims);
    setNodes(nds => nds.map(n => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n)));
    setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
  }, [nodes, edges, setNodes, fitView, getNodes]);

  const onSelectionChange = useCallback(({ nodes: sel }: { nodes: Node[] }) => {
    setSelectedIds(sel.map(n => n.id));
  }, []);

  // Extract the selected blocks into a new sub-flow, replacing them with a
  // single `subflow` block wired to the external edges. The selected subgraph
  // becomes start → (entries) → … → (exits) → end inside the new flow.
  const extractSubflow = useCallback(() => {
    const sel = new Set(selectedIds.filter(id => {
      const n = nodes.find(x => x.id === id);
      return n && n.type !== 'start' && n.type !== 'end';
    }));
    if (sel.size === 0) return;

    const selNodes = nodes.filter(n => sel.has(n.id));
    const internal: Edge[] = [], incoming: Edge[] = [], outgoing: Edge[] = [];
    for (const e of edges) {
      const si = sel.has(e.source), ti = sel.has(e.target);
      if (si && ti) internal.push(e);
      else if (!si && ti) incoming.push(e);
      else if (si && !ti) outgoing.push(e);
    }

    const minX = Math.min(...selNodes.map(n => n.position.x));
    const minY = Math.min(...selNodes.map(n => n.position.y));
    const subStartId = uuidv4(), subEndId = uuidv4();
    const subNodes: FlowBlock[] = selNodes.map(n => ({
      id: n.id, type: n.type as FlowBlockType,
      position: { x: n.position.x - minX + 220, y: n.position.y - minY + 40 },
      label: n.data?.label as string | undefined,
      color: n.data?.color as string | undefined,
      config: (n.data?.config as FlowBlockConfig) ?? {},
    }));
    const maxX = Math.max(...subNodes.map(n => n.position.x));
    const subStart: FlowBlock = { id: subStartId, type: 'start', position: { x: 40, y: 40 }, config: {} };
    const subEnd: FlowBlock = { id: subEndId, type: 'end', position: { x: maxX + 240, y: 40 } };

    // Entry = nodes targeted from outside (or with no internal predecessor).
    const entry = new Set(incoming.map(e => e.target));
    if (entry.size === 0) {
      const internalIn = new Set(internal.map(e => e.target));
      selNodes.forEach(n => { if (!internalIn.has(n.id)) entry.add(n.id); });
    }
    // Exit = nodes pointing outside (or with no internal successor).
    const exits = new Set(outgoing.map(e => e.source));
    if (exits.size === 0) {
      const internalOut = new Set(internal.map(e => e.source));
      selNodes.forEach(n => { if (!internalOut.has(n.id)) exits.add(n.id); });
    }

    const subEdges: FlowEdge[] = [
      ...internal.map(e => ({ id: uuidv4(), source: e.source, sourcePort: e.sourceHandle ?? undefined, target: e.target, targetPort: e.targetHandle ?? undefined })),
      ...[...entry].map(tgt => ({ id: uuidv4(), source: subStartId, target: tgt })),
      ...[...exits].map(src => ({ id: uuidv4(), source: src, target: subEndId })),
    ];

    const subflow: Flow = { version: '1.0', id: uuidv4(), name: 'Subflow', nodes: [subStart, ...subNodes, subEnd], edges: subEdges };
    const subId = addFlowObject(subflow);

    // Replace the selection with one subflow block, rewiring external edges.
    const sfNode: Node = { id: uuidv4(), type: 'subflow', position: { x: minX, y: minY }, data: { config: { flowId: subId } }, selected: true };
    setNodes(nds => [...nds.filter(n => !sel.has(n.id)).map(n => ({ ...n, selected: false })), sfNode]);
    setEdges(eds => {
      const kept = eds.filter(e => !sel.has(e.source) && !sel.has(e.target));
      const newIn = incoming.map(e => ({ ...e, id: uuidv4(), target: sfNode.id, targetHandle: 'in' }));
      const newOut = outgoing.map(e => ({ ...e, id: uuidv4(), source: sfNode.id, sourceHandle: 'out' }));
      return [...kept, ...newIn, ...newOut];
    });
    setSelectedId(sfNode.id);
    setSelectedIds([sfNode.id]);
  }, [selectedIds, nodes, edges, setNodes, setEdges, addFlowObject]);

  const extractableCount = selectedIds.filter(id => {
    const n = nodes.find(x => x.id === id);
    return n && n.type !== 'start' && n.type !== 'end';
  }).length;

  // Mirror live RF state into the store (autosaves). Skip the initial seed.
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current) { seeded.current = true; return; }
    setFlowGraph(flow.id, toFlowNodes(nodes), toFlowEdges(edges));
  }, [nodes, edges, flow.id, setFlowGraph]);

  const onConnect = useCallback(
    (c: Connection) => setEdges(eds => addEdge({ ...c, id: uuidv4() }, eds)),
    [setEdges],
  );

  // Connect-to-empty-canvas: when a connection is dropped on the pane (no target
  // handle), pop a block picker at the cursor and create the chosen block
  // already wired from the originating port.
  const connectingRef = useRef<{ nodeId: string | null; handleId: string | null } | null>(null);
  const [connectMenu, setConnectMenu] = useState<
    { x: number; y: number; position: { x: number; y: number }; sourceId: string; sourceHandle: string | null } | null
  >(null);

  const onConnectStart = useCallback(
    (_e: unknown, params: { nodeId: string | null; handleId: string | null }) => {
      connectingRef.current = { nodeId: params.nodeId, handleId: params.handleId };
    }, []);

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    const from = connectingRef.current;
    connectingRef.current = null;
    if (!from?.nodeId) return;
    const target = event.target as Element | null;
    if (!target?.classList?.contains('react-flow__pane')) return; // dropped on a handle/node → normal connect
    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    setConnectMenu({
      x: point.clientX, y: point.clientY,
      position: screenToFlowPosition({ x: point.clientX, y: point.clientY }),
      sourceId: from.nodeId, sourceHandle: from.handleId,
    });
  }, [screenToFlowPosition]);

  const addConnectedBlock = useCallback((type: FlowBlockType) => {
    if (!connectMenu) return;
    const spec = BLOCK_SPECS[type];
    const config = spec.defaultConfig ? JSON.parse(JSON.stringify(spec.defaultConfig)) : {};
    const id = uuidv4();
    setNodes(nds => [...nds.map(n => ({ ...n, selected: false })), { id, type, position: connectMenu.position, data: { config }, selected: true }]);
    setEdges(eds => [...eds, { id: uuidv4(), source: connectMenu.sourceId, sourceHandle: connectMenu.sourceHandle ?? undefined, target: id }]);
    setSelectedId(id);
    setConnectMenu(null);
  }, [connectMenu, setNodes, setEdges]);

  // Start blocks can't be deleted (every flow needs an entry point).
  const onNodesChangeGuarded = useCallback((changes: NodeChange[]) => {
    onNodesChange(changes.filter(ch =>
      ch.type !== 'remove' || nodes.find(n => n.id === ch.id)?.type !== 'start',
    ));
  }, [onNodesChange, nodes]);

  const addBlock = useCallback((type: FlowBlockType) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    const base = rect
      ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 3 })
      : { x: 300, y: 160 };
    const jitter = (nodes.length % 6) * 24;
    const spec = BLOCK_SPECS[type];
    const config = spec.defaultConfig ? JSON.parse(JSON.stringify(spec.defaultConfig)) : {};
    const id = uuidv4();
    setNodes(nds => [...nds, { id, type, position: { x: base.x + jitter, y: base.y + jitter }, data: { config } }]);
    setSelectedId(id);
  }, [nodes.length, screenToFlowPosition, setNodes]);

  const patchConfig = useCallback((blockId: string, patch: FlowBlockConfig) => {
    setNodes(nds => nds.map(n => n.id === blockId
      ? { ...n, data: { ...n.data, config: { ...(n.data?.config as FlowBlockConfig ?? {}), ...patch } } }
      : n));
  }, [setNodes]);

  const patchLabel = useCallback((blockId: string, label: string) => {
    setNodes(nds => nds.map(n => n.id === blockId
      ? { ...n, data: { ...n.data, label: label || undefined } }
      : n));
  }, [setNodes]);

  const patchColor = useCallback((blockId: string, color: string | undefined) => {
    setNodes(nds => nds.map(n => n.id === blockId
      ? { ...n, data: { ...n.data, color } }
      : n));
  }, [setNodes]);

  const duplicateBlock = useCallback((blockId: string) => {
    const src = nodes.find(n => n.id === blockId);
    if (!src || src.type === 'start') return;
    const id = uuidv4();
    setNodes(nds => [
      ...nds.map(n => ({ ...n, selected: false })),
      { ...src, id, selected: true, position: { x: src.position.x + 40, y: src.position.y + 40 },
        data: { ...src.data, status: undefined } },
    ]);
    setSelectedId(id);
  }, [nodes, setNodes]);

  const deleteBlock = useCallback((blockId: string) => {
    if (nodes.find(n => n.id === blockId)?.type === 'start') return;
    setNodes(nds => nds.filter(n => n.id !== blockId));
    setEdges(eds => eds.filter(e => e.source !== blockId && e.target !== blockId));
    setSelectedId(null);
  }, [nodes, setNodes, setEdges]);

  // Latest display value per block, so a display node can preview its output.
  const displayOutputs = useMemo(() => {
    const m = new Map<string, unknown>();
    for (const o of runner.outputs) if (o.kind === 'display') m.set(o.blockId, o.value);
    return m;
  }, [runner.outputs]);

  const displayNodes = useMemo(
    () => nodes.map(n => ({ ...n, data: { ...n.data, status: runner.nodeStatus[n.id], output: displayOutputs.get(n.id) } })),
    [nodes, runner.nodeStatus, displayOutputs],
  );

  // After a run, highlight the edges that were actually traversed (colored by
  // success/fail) and dim the branches that weren't taken.
  const displayEdges = useMemo(() => {
    const taken = new Set(runner.traversedEdges);
    const hadRun = taken.size > 0;
    return edges.map(e => {
      if (taken.has(e.id)) {
        return { ...e, animated: true, style: { stroke: edgeColor(e.sourceHandle), strokeWidth: 2.5 }, zIndex: 1 };
      }
      if (hadRun) return { ...e, animated: false, style: { stroke: '#64748b', opacity: 0.25 } };
      return e;
    });
  }, [edges, runner.traversedEdges]);

  const selectedBlock = useMemo(() => {
    const n = nodes.find(nd => nd.id === selectedId);
    if (!n) return null;
    return {
      id: n.id, type: n.type as FlowBlockType,
      config: (n.data?.config as FlowBlockConfig) ?? {},
      label: n.data?.label as string | undefined,
      color: n.data?.color as string | undefined,
    };
  }, [nodes, selectedId]);

  const colorMode = theme === 'light' ? 'light'
    : theme === 'dark' ? 'dark'
    : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  const liveFlow = useMemo<Flow>(
    () => ({ ...flow, nodes: toFlowNodes(nodes), edges: toFlowEdges(edges) }),
    [flow, nodes, edges],
  );

  const stepCount = nodes.filter(n => n.type !== 'start' && n.type !== 'end').length;
  const { summary } = runner;

  // ── Cloud ──
  const [cloudMsg, setCloudMsg] = useState<string | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const showCloud = cloudEnabled();

  const doPushCloud = useCallback(async () => {
    setCloudBusy(true); setCloudMsg(t('Uploading to cloud…'));
    try { await pushFlowToCloud(liveFlow); setCloudMsg(t('Uploaded to cloud')); }
    catch (e) { setCloudMsg((e as Error).message); }
    finally { setCloudBusy(false); }
  }, [liveFlow, t]);

  const doRunCloud = useCallback(async () => {
    setCloudBusy(true); setCloudMsg(t('Uploading to cloud…'));
    try {
      await pushFlowToCloud(liveFlow); // upload the latest graph first
      const s = await runFlowInCloud(liveFlow, st => setCloudMsg(t('Cloud run: :status', { status: st })));
      setCloudMsg(t('Cloud: :passed passed, :failed failed · :ms ms', { passed: s.passed, failed: s.failed, ms: s.durationMs }));
    } catch (e) { setCloudMsg((e as Error).message); }
    finally { setCloudBusy(false); }
  }, [liveFlow, t]);

  return (
    <div className="flex flex-col h-full">
      {/* Run bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-surface-800 bg-surface-950 flex-shrink-0">
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={() => { const n = nameDraft.trim(); if (n) renameFlow(flow.id, n); setEditingName(false); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { const n = nameDraft.trim(); if (n) renameFlow(flow.id, n); setEditingName(false); }
              if (e.key === 'Escape') setEditingName(false);
            }}
            className="text-sm font-medium bg-surface-900 border border-surface-700 rounded px-1.5 py-0.5 max-w-[200px] focus:outline-none focus:border-blue-500"
          />
        ) : (
          <button
            className="text-sm font-medium text-[var(--text-primary)] truncate max-w-[200px] hover:underline decoration-dotted"
            title={t('Rename flow')}
            onClick={() => { setNameDraft(flow.name); setEditingName(true); }}
          >{flow.name}</button>
        )}
        <span className="text-[10px] text-surface-500">{t(':count block|:count blocks', { count: stepCount })}</span>
        <AddBlockMenu onAdd={addBlock} />
        <button
          onClick={autoLayout}
          title={t('Auto-arrange the blocks')}
          className="px-3 py-1.5 text-xs text-surface-300 bg-surface-800 hover:bg-surface-700 rounded font-medium transition-colors flex items-center gap-1.5"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13"><path d="M3 4a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 12a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1v-4zM12 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1h-4z"/></svg>
          {t('Tidy')}
        </button>
        {extractableCount > 0 && (
          <button
            onClick={extractSubflow}
            title={t('Extract the selected blocks into a sub-flow')}
            className="px-3 py-1.5 text-xs text-violet-200 bg-violet-900/40 hover:bg-violet-900/60 border border-violet-800/50 rounded font-medium transition-colors flex items-center gap-1.5"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13"><path d="M4 3a1 1 0 00-1 1v3a1 1 0 002 0V5h2a1 1 0 000-2H4zM16 3h-2a1 1 0 100 2h1v2a1 1 0 102 0V4a1 1 0 00-1-1zM4 13a1 1 0 10-2 0v3a1 1 0 001 1h3a1 1 0 100-2H4v-2zM17 13a1 1 0 10-2 0v2h-2a1 1 0 100 2h3a1 1 0 001-1v-3z"/></svg>
            {t('Extract to sub-flow (:count)', { count: extractableCount })}
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {showCloud && (
            <div className="flex items-center gap-1.5 pr-2 mr-1 border-r border-surface-800">
              <button onClick={doPushCloud} disabled={cloudBusy} title={t('Upload this flow to the cloud')}
                className="px-2.5 py-1.5 text-xs text-sky-200 bg-sky-900/40 hover:bg-sky-900/60 border border-sky-800/50 disabled:opacity-50 rounded font-medium transition-colors">☁ {t('Push')}</button>
              <button onClick={doRunCloud} disabled={cloudBusy} title={t('Run this flow in the cloud')}
                className="px-2.5 py-1.5 text-xs text-sky-200 bg-sky-900/40 hover:bg-sky-900/60 border border-sky-800/50 disabled:opacity-50 rounded font-medium transition-colors">{t('Run in cloud')}</button>
              <button onClick={() => openCloudFlow(liveFlow)} title={t('Open in cloud')}
                className="px-2 py-1.5 text-xs text-surface-400 hover:text-surface-200 bg-surface-800 hover:bg-surface-700 rounded transition-colors">↗</button>
            </div>
          )}
          <select
            value={selectedEnv}
            onChange={e => setSelectedEnv(e.target.value)}
            className="text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
            style={{ color: 'var(--text-primary)' }}
          >
            <option value="">{t('(no environment)')}</option>
            {Object.values(environments).map(({ data: env }) => (
              <option key={env.id} value={env.id}>{env.name}</option>
            ))}
          </select>
          {(summary || runner.error || runner.outputs.length > 0) && (
            <button onClick={runner.reset} disabled={runner.running}
              className="px-2.5 py-1.5 text-xs text-surface-300 bg-surface-800 hover:bg-surface-700 disabled:opacity-50 rounded transition-colors">
              {t('Clear')}
            </button>
          )}
          <button
            onClick={() => runner.run(liveFlow, selectedEnv || null)}
            disabled={runner.running}
            className="px-4 py-1.5 text-xs text-white bg-emerald-700 hover:bg-emerald-600 disabled:bg-surface-800 disabled:text-surface-400 rounded font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
            {runner.running ? t('Running…') : t('Run')}
          </button>
        </div>
      </div>

      {/* Status line */}
      {(runner.error || summary || cloudMsg) && (
        <div className="flex items-center gap-3 px-4 py-1.5 border-b border-surface-800 bg-surface-900/40 flex-shrink-0 text-xs">
          {cloudMsg && <span className="text-sky-300">☁ {cloudMsg}</span>}
          {runner.error ? (
            <span className="text-orange-400">{runner.error}</span>
          ) : summary ? (
            <>
              <span className="text-emerald-400 font-medium">{t(':count passed', { count: summary.passed })}</span>
              {summary.failed > 0 && <span className="text-red-400 font-medium">{t(':count failed', { count: summary.failed })}</span>}
              {summary.errors > 0 && <span className="text-orange-400 font-medium">{t(':count errors', { count: summary.errors })}</span>}
              <span className="text-surface-400">{t(':count blocks', { count: summary.total })} · {summary.durationMs}ms</span>
            </>
          ) : null}
        </div>
      )}

      {/* Canvas + inspector */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0" ref={wrapperRef}>
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            onNodesChange={onNodesChangeGuarded}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onSelectionChange={onSelectionChange}
            onNodeClick={(_e, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={NODE_TYPES}
            colorMode={colorMode}
            fitView
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background gap={16} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!bg-surface-900" />
          </ReactFlow>
        </div>
        {connectMenu && (
          <>
            <div className="fixed inset-0 z-40" role="button" tabIndex={-1} aria-label={t('Close menu')}
              onClick={() => setConnectMenu(null)} onKeyDown={e => { if (e.key === 'Escape') setConnectMenu(null); }} />
            <div
              className="fixed z-50 w-56 bg-surface-900 border border-surface-700 rounded-lg shadow-2xl max-h-[60vh] overflow-y-auto"
              style={{ left: Math.min(connectMenu.x, window.innerWidth - 240), top: Math.min(connectMenu.y, window.innerHeight - 340) }}
            >
              <div className="px-3 py-1.5 text-[10px] text-surface-500 border-b border-surface-800 sticky top-0 bg-surface-900">{t('Connect to new block')}</div>
              <BlockPickerList onPick={addConnectedBlock} includeEnd />
            </div>
          </>
        )}

        {selectedBlock && (
          <FlowInspector
            key={selectedBlock.id}
            block={selectedBlock}
            onPatchConfig={patch => patchConfig(selectedBlock.id, patch)}
            onPatchLabel={label => patchLabel(selectedBlock.id, label)}
            onPatchColor={color => patchColor(selectedBlock.id, color)}
            onDuplicate={() => duplicateBlock(selectedBlock.id)}
            onDelete={() => deleteBlock(selectedBlock.id)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>

      <BottomPanel runner={runner} flowName={flow.name} />
    </div>
  );
}

// ─── Public component ───────────────────────────────────────────────────────

export function FlowCanvas() {
  const t = useT();
  const activeFlowId = useStore(s => s.activeFlowId);
  const flow = useStore(s => (activeFlowId ? s.flows[activeFlowId]?.data : undefined));

  if (!flow) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-surface-500 text-sm">
        {t('Select a flow, or create one with + in the sidebar.')}
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <FlowEditor key={flow.id} flow={flow} />
    </ReactFlowProvider>
  );
}
