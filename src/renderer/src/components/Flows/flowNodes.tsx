// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// React Flow node renderers for every flow block type. Node `type` maps to the
// Flow model's block type; node `data` carries { config, label, status }. The
// request/sub-flow blocks pick their target inline (per the UX requirement);
// richer config (scripts, expressions) is edited in the canvas inspector. Each
// node draws input/output handles straight from the block registry, so the
// ports you can wire always match what the engine routes.

import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { useStore } from '../../store';
import { getMethodColor } from '../../../../shared/colors';
import { BLOCK_SPECS, outputsFor, inputsFor } from '../../../../shared/flow-blocks';
import { blockIO } from '../../../../shared/flow-io';
import type { FlowBlockConfig, FlowBlockType, FlowBlockCategory } from '../../../../shared/types';
import type { FlowNodeStatus } from './useFlowRunner';

export interface BlockNodeData {
  config?: FlowBlockConfig
  label?: string
  color?: string
  status?: FlowNodeStatus
  /** Latest value produced by a display block in the last run (preview). */
  output?: unknown
  [key: string]: unknown
}

const CATEGORY_RING: Record<FlowBlockCategory | 'terminal', string> = {
  action: 'border-blue-600/60',
  logic: 'border-amber-600/60',
  looping: 'border-violet-600/60',
  visualize: 'border-teal-600/60',
  terminal: 'border-surface-600',
};

const CATEGORY_ACCENT: Record<FlowBlockCategory | 'terminal', string> = {
  action: 'text-blue-400',
  logic: 'text-amber-400',
  looping: 'text-violet-400',
  visualize: 'text-teal-400',
  terminal: 'text-surface-400',
};

const STATUS_RING: Record<string, string> = {
  running: '!border-blue-400 ring-2 ring-blue-400/40',
  passed: '!border-emerald-500 ring-2 ring-emerald-500/30',
  failed: '!border-red-500 ring-2 ring-red-500/30',
  error: '!border-orange-500 ring-2 ring-orange-500/30',
};

const STATUS_DOT: Record<string, string> = {
  running: 'bg-blue-400 animate-pulse', passed: 'bg-emerald-500',
  failed: 'bg-red-500', error: 'bg-orange-500', done: 'bg-surface-500', skipped: 'bg-surface-500',
};

const PORT_COLOR: Record<string, string> = {
  true: '!bg-emerald-500', pass: '!bg-emerald-500', success: '!bg-emerald-500',
  false: '!bg-red-500', fail: '!bg-red-500',
  body: '!bg-violet-500', done: '!bg-surface-400',
};
const handleCls = (port: string) => `!w-2.5 !h-2.5 !border-2 !border-surface-900 ${PORT_COLOR[port] ?? '!bg-surface-500'}`;

function OutputHandles({ type, config }: { readonly type: FlowBlockType; readonly config?: FlowBlockConfig }) {
  const ports = outputsFor({ type, config });
  const n = ports.length;
  return (
    <>
      {ports.map((p, i) => {
        const top = n === 1 ? 50 : (100 / (n + 1)) * (i + 1);
        return (
          <div key={p.id}>
            <Handle id={p.id} type="source" position={Position.Right} className={handleCls(p.id)} style={{ top: `${top}%` }} />
            {n > 1 && p.label && (
              <span className="absolute right-1.5 text-[8px] text-surface-500 pointer-events-none" style={{ top: `calc(${top}% - 6px)` }}>{p.label}</span>
            )}
          </div>
        );
      })}
    </>
  );
}

function Frame({
  type, data, children, minW = 180,
}: {
  readonly type: FlowBlockType
  readonly data: BlockNodeData
  readonly children?: React.ReactNode
  readonly minW?: number
}) {
  const spec = BLOCK_SPECS[type];
  const hasInput = inputsFor({ type }).length > 0;
  const statusRing = data.status ? STATUS_RING[data.status.status] ?? '' : '';
  // A custom color overrides the category border (inline style beats the
  // tailwind class); a run status still wins via its !important border.
  return (
    <div
      className={`rounded-md border bg-surface-900 shadow-lg ${CATEGORY_RING[spec.category]} ${statusRing}`}
      style={{ minWidth: minW, maxWidth: 280, ...(data.color ? { borderColor: data.color } : {}) }}
    >
      {hasInput && <Handle id="in" type="target" position={Position.Left} className={handleCls('in')} />}
      <div className="px-3 py-1.5 flex items-center gap-2 border-b border-surface-800/70">
        {data.status && <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[data.status.status] ?? 'bg-surface-600'}`} />}
        {!data.status && data.color && <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: data.color }} />}
        <span className={`text-[9px] font-bold uppercase tracking-wider ${CATEGORY_ACCENT[spec.category]}`} style={data.color ? { color: data.color } : undefined}>{spec.label}</span>
        {data.label && <span className="text-[11px] text-surface-300 truncate ml-auto">{data.label}</span>}
        {data.status?.httpStatus != null && (
          <span className={`ml-auto text-[9px] font-mono ${data.status.httpStatus < 400 ? 'text-emerald-400' : 'text-red-400'}`}>{data.status.httpStatus}</span>
        )}
      </div>
      {children && <div className="px-3 py-2">{children}</div>}
      <IOFooter type={type} config={data.config} />
      <OutputHandles type={type} config={data.config} />
    </div>
  );
}

function IOChips({ label, names, cls }: { readonly label: string; readonly names: string[]; readonly cls: string }) {
  return (
    <div className="flex items-center gap-1 overflow-hidden">
      <span className={`text-[8px] uppercase tracking-wider font-semibold ${cls}`}>{label}</span>
      <div className="flex items-center gap-0.5 overflow-hidden">
        {names.map(n => (
          <span key={n} className="text-[9px] font-mono px-1 rounded bg-surface-800 text-surface-300 truncate max-w-[72px]">{n}</span>
        ))}
      </div>
    </div>
  );
}

function IOFooter({ type, config }: { readonly type: FlowBlockType; readonly config?: FlowBlockConfig }) {
  const io = blockIO({ id: '', type, position: { x: 0, y: 0 }, config });
  if (io.reads.length === 0 && io.writes.length === 0) return null;
  return (
    <div className="px-3 pb-2 flex flex-col gap-0.5">
      {io.writes.length > 0 && <IOChips label="out" names={io.writes} cls="text-emerald-500" />}
      {io.reads.length > 0 && <IOChips label="in" names={io.reads} cls="text-surface-500" />}
    </div>
  );
}

function summary(text?: string, fallback = '—'): string {
  if (!text) return fallback;
  const firstLine = text.split('\n')[0].trim();
  return firstLine.length > 44 ? firstLine.slice(0, 44) + '…' : (firstLine || fallback);
}

// ─── Inline pickers ──────────────────────────────────────────────────────

function RequestPicker({ id, config }: { readonly id: string; readonly config?: FlowBlockConfig }) {
  const collections = useStore(s => s.collections);
  const { updateNodeData } = useReactFlow();
  const colList = Object.values(collections);
  const selCol = config?.ref?.collectionId ?? '';
  const requests = selCol ? Object.values(collections[selCol]?.data.requests ?? {}) : [];

  return (
    <div className="flex flex-col gap-1 nodrag">
      <select
        value={selCol}
        onChange={e => updateNodeData(id, { config: { ...config, ref: { collectionId: e.target.value, requestId: '' } } })}
        className="text-[11px] bg-surface-800 border border-surface-700 rounded px-1.5 py-1 focus:outline-none focus:border-blue-500"
      >
        <option value="">Select collection…</option>
        {colList.map(({ data: c }) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select
        value={config?.ref?.requestId ?? ''}
        disabled={!selCol}
        onChange={e => updateNodeData(id, { config: { ...config, ref: { collectionId: selCol, requestId: e.target.value } } })}
        className="text-[11px] bg-surface-800 border border-surface-700 rounded px-1.5 py-1 focus:outline-none focus:border-blue-500 disabled:opacity-50"
      >
        <option value="">Select request…</option>
        {requests.map(r => <option key={r.id} value={r.id}>{r.method} {r.name}</option>)}
      </select>
      {config?.ref?.requestId && requests.find(r => r.id === config.ref!.requestId) && (
        <span className={`text-[9px] font-bold ${getMethodColor(requests.find(r => r.id === config.ref!.requestId)!.method)}`}>
          {requests.find(r => r.id === config.ref!.requestId)!.method} {requests.find(r => r.id === config.ref!.requestId)!.name}
        </span>
      )}
    </div>
  );
}

function FlowPicker({ id, config }: { readonly id: string; readonly config?: FlowBlockConfig }) {
  const flows = useStore(s => s.flows);
  const activeFlowId = useStore(s => s.activeFlowId);
  const { updateNodeData } = useReactFlow();
  const options = Object.values(flows).filter(f => f.data.id !== activeFlowId);
  return (
    <select
      value={config?.flowId ?? ''}
      onChange={e => updateNodeData(id, { config: { ...config, flowId: e.target.value } })}
      className="text-[11px] bg-surface-800 border border-surface-700 rounded px-1.5 py-1 w-full focus:outline-none focus:border-blue-500 nodrag"
    >
      <option value="">Select flow…</option>
      {options.map(({ data: f }) => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select>
  );
}

// ─── Node bodies ───────────────────────────────────────────────────────────

function Line({ children }: { readonly children: React.ReactNode }) {
  return <p className="text-[10px] text-surface-400 font-mono truncate">{children}</p>;
}

export function BlockNode({ id, type, data }: NodeProps) {
  const d = (data ?? {}) as BlockNodeData;
  const cfg = d.config;

  let body: React.ReactNode = null;
  switch (type as FlowBlockType) {
    case 'start': case 'end':
      return <Frame type={type as FlowBlockType} data={d} minW={90} />;
    case 'request': body = <RequestPicker id={id} config={cfg} />; break;
    case 'subflow': body = <FlowPicker id={id} config={cfg} />; break;
    case 'if': body = <Line>{summary(cfg?.expression)}</Line>; break;
    case 'condition': body = <Line>{(cfg?.cases ?? []).length} case(s)</Line>; break;
    case 'validate': case 'evaluate': body = <Line>{summary(cfg?.script, 'script')}</Line>; break;
    case 'setVar': body = <Line>{cfg?.scope ?? 'local'}:{cfg?.varName || 'var'} ← {summary(cfg?.valueExpression, 'value')}</Line>; break;
    case 'delay': body = <Line>{cfg?.delayMs ?? 0} ms</Line>; break;
    case 'merge': body = <Line>any branch</Line>; break;
    case 'forEach': body = <Line>{cfg?.itemVar || 'item'} ← {summary(cfg?.expression, 'list')}</Line>; break;
    case 'repeat': body = <Line>× {cfg?.count ?? 0}</Line>; break;
    case 'collect': body = <Line>→ {cfg?.intoVar || 'results'}</Line>; break;
    case 'display': body = (
      <>
        <Line>{cfg?.as ?? 'json'}: {summary(cfg?.message, 'value')}</Line>
        {d.output !== undefined && (
          <pre className="mt-1 text-[9px] text-teal-300 bg-surface-950 border border-surface-800 rounded p-1 max-h-28 overflow-auto whitespace-pre-wrap break-all">
            {typeof d.output === 'string' ? d.output : JSON.stringify(d.output, null, 2)}
          </pre>
        )}
      </>
    ); break;
    case 'log': body = <Line>{summary(cfg?.message, 'message')}</Line>; break;
    default: body = null;
  }
  return <Frame type={type as FlowBlockType} data={d}>{body}</Frame>;
}

// All block types share one renderer.
export const flowNodeTypes: Record<string, typeof BlockNode> = Object.fromEntries(
  Object.keys(BLOCK_SPECS).map(t => [t, BlockNode]),
);
