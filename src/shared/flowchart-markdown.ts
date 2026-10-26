// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT
//
// Converts a flowchart code block (the body of a ```flow fence in a markdown
// description) into a positioned graph the renderer draws with the app's
// existing @xyflow/react canvas — no external diagram library.
//
// Supported syntax:
//   flowchart TD            direction: TD/TB (top-down), LR, RL, BT
//   A[Rectangle]            node shapes by bracket:
//   A(Rounded)                [..] rect   (..) round   ([..]) stadium
//   A([Stadium])              ((..)) circle   {..} diamond   {{..}} hexagon
//   A{Decision}               [[..]] subroutine
//   A --> B                  edges: --> solid, --- open, -.-> dotted, ==> thick
//   A -->|label| B           edge label
//   A --> B --> C            chained edges on one line
//   %% comment               ignored
// Unknown lines are skipped rather than throwing, so a half-typed diagram in a
// live preview degrades gracefully.

export type FlowShape = 'rect' | 'round' | 'stadium' | 'circle' | 'diamond' | 'hexagon' | 'subroutine';
export type FlowDirection = 'TD' | 'LR' | 'RL' | 'BT';
export type FlowEdgeStyle = 'solid' | 'open' | 'dotted' | 'thick';

export interface FlowchartNodeDef {
  id: string;
  label: string;
  shape: FlowShape;
}
export interface FlowchartEdgeDef {
  from: string;
  to: string;
  label?: string;
  style: FlowEdgeStyle;
}
export interface ParsedFlowchart {
  direction: FlowDirection;
  nodes: FlowchartNodeDef[];
  edges: FlowchartEdgeDef[];
}

export interface PositionedNode extends FlowchartNodeDef {
  x: number;
  y: number;
}
export interface LaidOutFlowchart {
  direction: FlowDirection;
  nodes: PositionedNode[];
  edges: FlowchartEdgeDef[];
  nodeWidth: number;
  nodeHeight: number;
}

const DIRECTION_RE = /^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/i;

// Node = identifier + optional shape wrapper. Order matters: the two-char
// wrappers ([ ]), (( )), {{ }}, [[ ]] must be tried before the single-char ones.
// IDs are word characters only — deliberately excluding '-' and '.' so they
// can't swallow the '-'/'.' of an unspaced link operator (A-->B, A-.->C).
const NODE_RE = /^([A-Za-z0-9_]+)(\(\[[\s\S]*?\]\)|\[\[[\s\S]*?\]\]|\(\([\s\S]*?\)\)|\{\{[\s\S]*?\}\}|\[[\s\S]*?\]|\([\s\S]*?\)|\{[\s\S]*?\})?/;
const LINK_RE = /^\s*(-\.->|==>|-->|---)\s*(?:\|([^|]*)\|\s*)?/;

function cleanLabel(text: string): string {
  const t = text.trim();
  // Strip a single pair of surrounding quotes ("quoted labels").
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/** Interpret a shape wrapper (brackets included) into a shape + inner label. */
function shapeOf(wrapper: string | undefined, id: string): { shape: FlowShape; label: string } {
  if (!wrapper) return { shape: 'rect', label: id };
  const tests: [RegExp, FlowShape][] = [
    [/^\(\[([\s\S]*)\]\)$/, 'stadium'],
    [/^\[\[([\s\S]*)\]\]$/, 'subroutine'],
    [/^\(\(([\s\S]*)\)\)$/, 'circle'],
    [/^\{\{([\s\S]*)\}\}$/, 'hexagon'],
    [/^\[([\s\S]*)\]$/, 'rect'],
    [/^\(([\s\S]*)\)$/, 'round'],
    [/^\{([\s\S]*)\}$/, 'diamond'],
  ];
  for (const [re, shape] of tests) {
    const m = wrapper.match(re);
    if (m) return { shape, label: cleanLabel(m[1]) || id };
  }
  return { shape: 'rect', label: id };
}

function edgeStyle(op: string): FlowEdgeStyle {
  if (op === '-.->') return 'dotted';
  if (op === '==>') return 'thick';
  if (op === '---') return 'open';
  return 'solid';
}

/** Parse a flowchart code block into nodes + edges (no layout). */
export function parseFlowchart(code: string): ParsedFlowchart {
  const lines = code.split(/\r?\n/);
  let direction: FlowDirection = 'TD';

  const nodeMap = new Map<string, FlowchartNodeDef>();
  const declared = new Set<string>(); // ids that arrived with an explicit shape/label
  const edges: FlowchartEdgeDef[] = [];

  const register = (id: string, wrapper?: string) => {
    const existing = nodeMap.get(id);
    if (!existing) {
      const { shape, label } = shapeOf(wrapper, id);
      nodeMap.set(id, { id, label, shape });
      if (wrapper) declared.add(id);
      return;
    }
    // A later line that carries the label/shape upgrades a node first seen bare.
    if (wrapper && !declared.has(id)) {
      const { shape, label } = shapeOf(wrapper, id);
      existing.shape = shape;
      existing.label = label;
      declared.add(id);
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (DIRECTION_RE.test(line)) {
      const dir = (line.match(DIRECTION_RE)![1] || 'TD').toUpperCase();
      direction = (dir === 'TB' ? 'TD' : dir) as FlowDirection;
      continue;
    }

    let rest = line;
    const first = rest.match(NODE_RE);
    if (!first) continue;
    register(first[1], first[2]);
    let prev = first[1];
    rest = rest.slice(first[0].length);

    // Walk the chain: link, node, link, node, …
    for (;;) {
      const link = rest.match(LINK_RE);
      if (!link) break;
      rest = rest.slice(link[0].length);
      const next = rest.match(NODE_RE);
      if (!next) break;
      register(next[1], next[2]);
      edges.push({
        from: prev,
        to: next[1],
        label: link[2]?.trim() || undefined,
        style: edgeStyle(link[1]),
      });
      prev = next[1];
      rest = rest.slice(next[0].length);
    }
  }

  return { direction, nodes: [...nodeMap.values()], edges };
}

/**
 * Assign (x, y) to each node with a dependency-free layered layout: longest-path
 * layering over the DAG (cycles are tolerated — a back edge simply doesn't push
 * its target deeper). Layers run along the flow direction; siblings spread
 * across it. The renderer calls fitView, so absolute origin doesn't matter.
 */
export function layoutFlowchart(parsed: ParsedFlowchart, opts?: {
  nodeWidth?: number; nodeHeight?: number; gapMain?: number; gapCross?: number;
}): LaidOutFlowchart {
  const nodeWidth = opts?.nodeWidth ?? 170;
  const nodeHeight = opts?.nodeHeight ?? 52;
  const gapMain = opts?.gapMain ?? 70;   // between layers (along the flow)
  const gapCross = opts?.gapCross ?? 40;  // between siblings (across the flow)

  const ids = parsed.nodes.map(n => n.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const outs = new Map<string, string[]>(ids.map(id => [id, []]));
  const indeg = new Map<string, number>(ids.map(id => [id, 0]));

  for (const e of parsed.edges) {
    if (!index.has(e.from) || !index.has(e.to) || e.from === e.to) continue;
    outs.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }

  // Kahn traversal, relaxing layers as we go (longest path from the sources).
  const layer = new Map<string, number>(ids.map(id => [id, 0]));
  const remaining = new Map(indeg);
  const queue = ids.filter(id => (indeg.get(id) ?? 0) === 0);
  const visited = new Set<string>();
  while (queue.length) {
    const n = queue.shift()!;
    if (visited.has(n)) continue;
    visited.add(n);
    for (const m of outs.get(n)!) {
      if (layer.get(m)! < layer.get(n)! + 1) layer.set(m, layer.get(n)! + 1);
      remaining.set(m, (remaining.get(m) ?? 0) - 1);
      if ((remaining.get(m) ?? 0) <= 0 && !visited.has(m)) queue.push(m);
    }
  }
  // Nodes stuck in a cycle: place them one past their deepest known predecessor.
  for (const id of ids) {
    if (visited.has(id)) continue;
    let best = 0;
    for (const e of parsed.edges) {
      if (e.to === id && index.has(e.from)) best = Math.max(best, (layer.get(e.from) ?? 0) + 1);
    }
    layer.set(id, best);
  }

  // Bucket by layer, preserving the order nodes were declared in.
  const buckets = new Map<number, string[]>();
  for (const id of ids) {
    const l = layer.get(id) ?? 0;
    if (!buckets.has(l)) buckets.set(l, []);
    buckets.get(l)!.push(id);
  }

  const horizontal = parsed.direction === 'LR' || parsed.direction === 'RL';
  const mainStep = (horizontal ? nodeWidth : nodeHeight) + gapMain;
  const crossStep = (horizontal ? nodeHeight : nodeWidth) + gapCross;
  const dirSign = (parsed.direction === 'BT' || parsed.direction === 'RL') ? -1 : 1;

  const positioned: PositionedNode[] = [];
  for (const [l, members] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    // Centre each layer around 0 so the graph reads tidily before fitView.
    const span = (members.length - 1) * crossStep;
    members.forEach((id, i) => {
      const def = parsed.nodes[index.get(id)!];
      const main = dirSign * l * mainStep;
      const cross = i * crossStep - span / 2;
      positioned.push({
        ...def,
        x: horizontal ? main : cross,
        y: horizontal ? cross : main,
      });
    });
  }

  return { direction: parsed.direction, nodes: positioned, edges: parsed.edges, nodeWidth, nodeHeight };
}

/** Convenience: parse + layout in one call. */
export function flowchartFromMarkdown(code: string, opts?: Parameters<typeof layoutFlowchart>[1]): LaidOutFlowchart {
  return layoutFlowchart(parseFlowchart(code), opts);
}
