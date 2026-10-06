// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Static registry describing every flow block type: its category, label, the
// input/output ports it exposes, and its default config. Both the canvas UI
// (Add-block menu, node handles, inspector fields) and the execution engine
// read from here, so ports never drift between what you can draw and what runs.

import type {
  Flow,
  FlowBlock,
  FlowBlockConfig,
  FlowBlockType,
  FlowBlockCategory,
} from './types/flow';

export interface PortSpec {
  id: string
  label?: string
}

export interface BlockSpec {
  type: FlowBlockType
  category: FlowBlockCategory | 'terminal'
  label: string
  description: string
  inputs: PortSpec[]
  /** Outputs can depend on config (e.g. a condition's cases). */
  outputs: (config?: FlowBlockConfig) => PortSpec[]
  defaultConfig?: FlowBlockConfig
}

const IN: PortSpec[] = [{ id: 'in' }];
const OUT = (): PortSpec[] => [{ id: 'out' }];

export const BLOCK_SPECS: Record<FlowBlockType, BlockSpec> = {
  start: {
    type: 'start', category: 'terminal', label: 'Start',
    description: 'Where the flow begins.',
    inputs: [], outputs: OUT,
  },
  end: {
    type: 'end', category: 'terminal', label: 'End',
    description: 'Ends this path of the flow.',
    inputs: IN, outputs: () => [],
  },

  // ── Action ──────────────────────────────────────────────────────────────
  request: {
    type: 'request', category: 'action', label: 'Send Request',
    description: 'Send a saved request; routes success or fail on its response.',
    inputs: IN,
    outputs: () => [{ id: 'success', label: 'success' }, { id: 'fail', label: 'fail' }],
  },
  subflow: {
    type: 'subflow', category: 'action', label: 'Run Flow',
    description: 'Run another flow from this workspace.',
    inputs: IN, outputs: OUT,
  },

  // ── Logic ───────────────────────────────────────────────────────────────
  if: {
    type: 'if', category: 'logic', label: 'If',
    description: 'Route to true or false based on a JS condition.',
    inputs: IN,
    outputs: () => [{ id: 'true', label: 'true' }, { id: 'false', label: 'false' }],
    defaultConfig: { expression: 'sp.response.code === 200' },
  },
  condition: {
    type: 'condition', category: 'logic', label: 'Condition',
    description: 'Multi-way switch: the first matching case wins, else `else`.',
    inputs: IN,
    outputs: (config) => [
      ...(config?.cases ?? []).map(c => ({ id: c.id, label: c.label })),
      { id: 'else', label: 'else' },
    ],
    defaultConfig: {
      cases: [
        { id: 'case1', label: 'ok', expression: 'sp.response.code < 400' },
      ],
    },
  },
  validate: {
    type: 'validate', category: 'logic', label: 'Validate',
    description: 'Assert with sp.test(...); routes pass or fail.',
    inputs: IN,
    outputs: () => [{ id: 'pass', label: 'pass' }, { id: 'fail', label: 'fail' }],
    defaultConfig: {
      script: "sp.test('status is 2xx', () => {\n  sp.expect(sp.response.code).to.be.below(300);\n});",
    },
  },
  evaluate: {
    type: 'evaluate', category: 'logic', label: 'Evaluate',
    description: 'Run JS to compute values and set variables.',
    inputs: IN, outputs: OUT,
    defaultConfig: { script: "// sp.variables.set('id', sp.response.json().id)" },
  },
  setVar: {
    type: 'setVar', category: 'logic', label: 'Set Variable',
    description: 'Set a variable from an expression, in a chosen scope.',
    inputs: IN, outputs: OUT,
    defaultConfig: { varName: 'myVar', valueExpression: 'sp.response.json()', scope: 'local' },
  },
  delay: {
    type: 'delay', category: 'logic', label: 'Delay',
    description: 'Wait before continuing.',
    inputs: IN, outputs: OUT,
    defaultConfig: { delayMs: 1000 },
  },
  merge: {
    type: 'merge', category: 'logic', label: 'Or / Merge',
    description: 'Continue as soon as any one incoming branch arrives.',
    inputs: IN, outputs: OUT,
  },

  // ── Looping ─────────────────────────────────────────────────────────────
  forEach: {
    type: 'forEach', category: 'looping', label: 'For Each',
    description: 'Run the body once per item of a list; then continue on done.',
    inputs: IN,
    outputs: () => [{ id: 'body', label: 'body' }, { id: 'done', label: 'done' }],
    defaultConfig: { expression: 'sp.response.json()', itemVar: 'item', indexVar: 'index' },
  },
  repeat: {
    type: 'repeat', category: 'looping', label: 'Repeat',
    description: 'Run the body a fixed number of times, then continue on done.',
    inputs: IN,
    outputs: () => [{ id: 'body', label: 'body' }, { id: 'done', label: 'done' }],
    defaultConfig: { count: 3, indexVar: 'index' },
  },
  collect: {
    type: 'collect', category: 'looping', label: 'Collect',
    description: 'Append each iteration\'s value into a list variable.',
    inputs: IN, outputs: OUT,
    defaultConfig: { intoVar: 'results' },
  },

  // ── Visualize ───────────────────────────────────────────────────────────
  display: {
    type: 'display', category: 'visualize', label: 'Display',
    description: 'Show a value in the run results (text, JSON or table).',
    inputs: IN, outputs: OUT,
    defaultConfig: { message: 'sp.response.json()', as: 'json' },
  },
  log: {
    type: 'log', category: 'visualize', label: 'Log',
    description: 'Append a message to the run log.',
    inputs: IN, outputs: OUT,
    defaultConfig: { message: 'Reached this point' },
  },
};

/** Preset accent colors a block can be recolored to (see the inspector). */
export const FLOW_BLOCK_COLORS: { name: string; value: string }[] = [
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#10b981' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Slate', value: '#64748b' },
];

/** Output ports for a concrete block (resolves config-dependent outputs). */
export function outputsFor(block: Pick<FlowBlock, 'type' | 'config'>): PortSpec[] {
  return BLOCK_SPECS[block.type].outputs(block.config);
}

export function inputsFor(block: Pick<FlowBlock, 'type'>): PortSpec[] {
  return BLOCK_SPECS[block.type].inputs;
}

/** Blocks grouped by category, in menu order — used by the Add-block menu. */
export const BLOCKS_BY_CATEGORY: { category: FlowBlockCategory; blocks: BlockSpec[] }[] = [
  { category: 'action', blocks: [BLOCK_SPECS.request, BLOCK_SPECS.subflow] },
  { category: 'logic', blocks: [BLOCK_SPECS.if, BLOCK_SPECS.condition, BLOCK_SPECS.validate, BLOCK_SPECS.evaluate, BLOCK_SPECS.setVar, BLOCK_SPECS.delay, BLOCK_SPECS.merge] },
  { category: 'looping', blocks: [BLOCK_SPECS.forEach, BLOCK_SPECS.repeat, BLOCK_SPECS.collect] },
  { category: 'visualize', blocks: [BLOCK_SPECS.display, BLOCK_SPECS.log] },
];

/**
 * Normalize / migrate a flow loaded from disk. v0 flows (pre-blocks) used
 * `kind: 'start'|'end'|'request'` with a top-level `ref`; lift those into the
 * typed-block shape. Also fills missing arrays so the engine/UI never crash on
 * a hand-edited file.
 */
export function normalizeFlow(raw: Flow): Flow {
  const nodes = (raw.nodes ?? []).map(n => {
    const legacy = n as FlowBlock & { kind?: FlowBlockType; ref?: FlowBlockConfig['ref'] };
    const type = legacy.type ?? legacy.kind ?? 'request';
    const config: FlowBlockConfig = { ...(n.config ?? {}) };
    if (legacy.ref && !config.ref) config.ref = legacy.ref;
    return {
      id: n.id,
      type,
      position: n.position ?? { x: 0, y: 0 },
      label: n.label,
      color: n.color,
      config,
    } satisfies FlowBlock;
  });
  // The request block gained success/fail ports; a legacy edge off a request
  // with the old single 'out' port (or none) becomes its `success` edge.
  const requestIds = new Set(nodes.filter(n => n.type === 'request').map(n => n.id));
  const edges = (raw.edges ?? []).map(e => {
    let sourcePort = e.sourcePort;
    if (requestIds.has(e.source) && (sourcePort == null || sourcePort === 'out')) sourcePort = 'success';
    return { id: e.id, source: e.source, sourcePort, target: e.target, targetPort: e.targetPort };
  });
  return { version: '1.0', id: raw.id, name: raw.name, description: raw.description, nodes, edges };
}
