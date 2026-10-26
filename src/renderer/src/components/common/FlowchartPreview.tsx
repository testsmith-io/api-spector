// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT
//
// Renders a flowchart code block (from a markdown description) as a read-only
// diagram, reusing the app's existing @xyflow/react canvas — no new diagram
// dependency. Parsing + layout live in shared/flowchart-markdown.

import { useMemo } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Handle, Position, MarkerType,
  type Node, type Edge, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { flowchartFromMarkdown, type FlowShape, type FlowDirection } from '../../../../shared/flowchart-markdown';

interface FlowchartNodeData {
  label: string;
  shape: FlowShape;
  dir: FlowDirection;
  [key: string]: unknown;
}

function posFor(dir: FlowDirection, which: 'source' | 'target'): Position {
  const map: Record<FlowDirection, { source: Position; target: Position }> = {
    TD: { source: Position.Bottom, target: Position.Top },
    BT: { source: Position.Top, target: Position.Bottom },
    LR: { source: Position.Right, target: Position.Left },
    RL: { source: Position.Left, target: Position.Right },
  };
  return map[dir][which];
}

const SHAPE_CLASS: Record<FlowShape, string> = {
  rect: 'rounded-md',
  round: 'rounded-2xl',
  stadium: 'rounded-full',
  circle: 'rounded-full',
  subroutine: 'rounded-md border-x-4',
  diamond: '',
  hexagon: '',
};

const CLIP: Partial<Record<FlowShape, string>> = {
  diamond: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
  hexagon: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)',
};

function FlowchartNode({ data }: NodeProps) {
  const { label, shape, dir } = data as FlowchartNodeData;
  const clip = CLIP[shape];
  const compact = shape === 'diamond' || shape === 'hexagon' || shape === 'circle';
  return (
    <div className="relative">
      <Handle type="target" position={posFor(dir, 'target')} className="!bg-surface-500 !w-1.5 !h-1.5 !border-0" />
      <div
        className={`flex items-center justify-center text-center text-[11px] leading-tight text-surface-100 bg-surface-800 border border-surface-600 ${SHAPE_CLASS[shape]}`}
        style={{
          minWidth: compact ? 92 : 120,
          minHeight: compact ? 68 : 40,
          maxWidth: 220,
          padding: clip ? '18px 22px' : '8px 12px',
          clipPath: clip,
        }}
      >
        <span className="break-words">{label}</span>
      </div>
      <Handle type="source" position={posFor(dir, 'source')} className="!bg-surface-500 !w-1.5 !h-1.5 !border-0" />
    </div>
  );
}

const NODE_TYPES = { flowchart: FlowchartNode };

export function FlowchartPreview({ code, className }: { readonly code: string; readonly className?: string }) {
  const { nodes, edges } = useMemo(() => {
    const g = flowchartFromMarkdown(code);
    const sp = posFor(g.direction, 'source');
    const tp = posFor(g.direction, 'target');
    const nodes: Node[] = g.nodes.map(n => ({
      id: n.id,
      type: 'flowchart',
      position: { x: n.x, y: n.y },
      data: { label: n.label, shape: n.shape, dir: g.direction },
      sourcePosition: sp,
      targetPosition: tp,
    }));
    const edges: Edge[] = g.edges.map((e, i) => ({
      id: `e${i}-${e.from}-${e.to}`,
      source: e.from,
      target: e.to,
      label: e.label,
      markerEnd: e.style === 'open' ? undefined : { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      animated: e.style === 'dotted',
      style: {
        strokeWidth: e.style === 'thick' ? 2.5 : 1.5,
        strokeDasharray: e.style === 'dotted' ? '5 4' : undefined,
      },
      labelStyle: { fontSize: 10, fill: 'var(--text-secondary)' },
      labelBgStyle: { fill: 'var(--surface-900)' },
      labelBgPadding: [4, 2] as [number, number],
    }));
    return { nodes, edges };
  }, [code]);

  if (!nodes.length) {
    return <div className={`text-xs text-surface-500 p-4 ${className ?? ''}`}>Nothing to diagram.</div>;
  }

  return (
    <div className={`w-full h-full min-h-[200px] ${className ?? ''}`}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
