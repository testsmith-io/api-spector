// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { parseFlowchart, layoutFlowchart, flowchartFromMarkdown } from '../shared/flowchart-markdown';

describe('parseFlowchart', () => {
  it('parses direction, node shapes, and a labelled edge', () => {
    const g = parseFlowchart(`flowchart TD
      A[Start] --> B{OK?}
      B -->|yes| C([Done])`);

    expect(g.direction).toBe('TD');
    const byId = Object.fromEntries(g.nodes.map(n => [n.id, n]));
    expect(byId.A).toMatchObject({ shape: 'rect', label: 'Start' });
    expect(byId.B).toMatchObject({ shape: 'diamond', label: 'OK?' });
    expect(byId.C).toMatchObject({ shape: 'stadium', label: 'Done' });

    expect(g.edges).toEqual([
      { from: 'A', to: 'B', label: undefined, style: 'solid' },
      { from: 'B', to: 'C', label: 'yes', style: 'solid' },
    ]);
  });

  it('normalises TB to TD and reads LR', () => {
    expect(parseFlowchart('graph TB\nA-->B').direction).toBe('TD');
    expect(parseFlowchart('flowchart LR\nA-->B').direction).toBe('LR');
  });

  it('handles chained edges on one line', () => {
    const g = parseFlowchart('flowchart LR\nA --> B --> C --> D');
    expect(g.nodes.map(n => n.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(g.edges).toHaveLength(3);
    expect(g.edges[2]).toMatchObject({ from: 'C', to: 'D' });
  });

  it('recognises edge styles', () => {
    const g = parseFlowchart('A-->B\nA-.->C\nA==>D\nA---E');
    const style = (to: string) => g.edges.find(e => e.to === to)!.style;
    expect(style('B')).toBe('solid');
    expect(style('C')).toBe('dotted');
    expect(style('D')).toBe('thick');
    expect(style('E')).toBe('open');
  });

  it('upgrades a bare node when a later line gives it a label', () => {
    const g = parseFlowchart('A --> B\nB[Named step]');
    const b = g.nodes.find(n => n.id === 'B')!;
    expect(b.label).toBe('Named step');
  });

  it('parses the remaining shapes and quoted labels', () => {
    const g = parseFlowchart('X((Round)) --> Y{{Hex}} --> Z[["Sub"]]');
    const byId = Object.fromEntries(g.nodes.map(n => [n.id, n]));
    expect(byId.X.shape).toBe('circle');
    expect(byId.Y.shape).toBe('hexagon');
    expect(byId.Z).toMatchObject({ shape: 'subroutine', label: 'Sub' });
  });

  it('ignores comments and blank lines', () => {
    const g = parseFlowchart('\n%% a comment\nflowchart TD\n\nA --> B\n');
    expect(g.nodes.map(n => n.id)).toEqual(['A', 'B']);
    expect(g.edges).toHaveLength(1);
  });
});

describe('layoutFlowchart', () => {
  it('stacks a chain down the page for TD', () => {
    const g = flowchartFromMarkdown('flowchart TD\nA --> B --> C');
    const y = (id: string) => g.nodes.find(n => n.id === id)!.y;
    expect(y('A')).toBeLessThan(y('B'));
    expect(y('B')).toBeLessThan(y('C'));
  });

  it('lays a chain left-to-right for LR', () => {
    const g = flowchartFromMarkdown('flowchart LR\nA --> B --> C');
    const x = (id: string) => g.nodes.find(n => n.id === id)!.x;
    expect(x('A')).toBeLessThan(x('B'));
    expect(x('B')).toBeLessThan(x('C'));
  });

  it('spreads siblings of the same layer across the flow', () => {
    const g = flowchartFromMarkdown('flowchart TD\nA --> B\nA --> C');
    const b = g.nodes.find(n => n.id === 'B')!;
    const c = g.nodes.find(n => n.id === 'C')!;
    expect(b.y).toBe(c.y);       // same layer
    expect(b.x).not.toBe(c.x);   // different columns
  });

  it('tolerates cycles without hanging and places every node', () => {
    const parsed = parseFlowchart('A --> B\nB --> A');
    const g = layoutFlowchart(parsed);
    expect(g.nodes).toHaveLength(2);
    for (const n of g.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });
});
