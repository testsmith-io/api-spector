// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Flows: a visual dataflow graph of typed blocks (action/logic/looping/visualize),
// routed along edges by named output ports; logic uses the `sp.*` sandbox. Stored
// one-file-per-flow under `flows/` (JSON); engine (flow-engine.ts) shared by UI + CLI.

import type { Collection, Environment, TlsSettings } from './collection';

export type FlowBlockCategory = 'action' | 'logic' | 'looping' | 'visualize'

export type FlowBlockType =
  // terminals
  | 'start' | 'end'
  // action
  | 'request' | 'subflow'
  // logic
  | 'if' | 'condition' | 'validate' | 'evaluate' | 'setVar' | 'delay' | 'merge' | 'parallel'
  // looping
  | 'forEach' | 'repeat' | 'collect'
  // visualize
  | 'display' | 'log'

/** A reference to a saved request. Request ids are only unique *within* a
 *  collection, so a flow block stores the scoped pair. */
export interface FlowRequestRef {
  collectionId: string
  requestId: string
}

/** One case of a `condition` (switch) block. */
export interface FlowConditionCase {
  id: string
  label: string
  /** JS boolean expression; first truthy case wins, else the `else` port. */
  expression: string
}

/** Per-type block configuration. A block only reads the fields relevant to its
 *  type; all are optional so the shape stays flat and forward-compatible. */
export interface FlowBlockConfig {
  /** request */
  ref?: FlowRequestRef
  /** subflow: id of another flow in the same workspace */
  flowId?: string
  /** if: boolean expression · forEach: list expression (JS, returns an array) */
  expression?: string
  /** evaluate / validate: JS source (sp.* sandbox) */
  script?: string
  /** condition: ordered switch cases (plus an implicit `else` port) */
  cases?: FlowConditionCase[]
  /** delay: milliseconds to wait */
  delayMs?: number
  /** forEach / repeat: name of the loop item + index variables in scope */
  itemVar?: string
  indexVar?: string
  /** repeat: number of iterations */
  count?: number
  /** parallel: times to fire each connected request concurrently (default 1). */
  copies?: number
  /** collect: variable (data channel) to append each iteration's value into */
  intoVar?: string
  /** collect / setVar: JS expression for the value (collect defaults to last response body) */
  valueExpression?: string
  /** setVar: the variable name to write */
  varName?: string
  /** setVar: which scope to write into (default 'local') */
  scope?: 'local' | 'collection' | 'environment' | 'global'
  /** start: flow input variables, seeded into the local scope before the run */
  inputs?: { key: string; value: string }[]
  /** display / log: message - a {{template}} or, when `expression` form, JS */
  message?: string
  /** display: how to render the value */
  as?: 'text' | 'json' | 'table'
}

export interface FlowBlock {
  id: string
  type: FlowBlockType
  position: { x: number; y: number }
  /** Optional label shown on the block, overriding the default/derived title. */
  label?: string
  /** Optional accent color (hex) for the block, overriding its category color. */
  color?: string
  config?: FlowBlockConfig
}

export interface FlowEdge {
  id: string
  source: string
  /** Source output port id (e.g. 'out' | 'true' | 'false' | 'body' | 'done' |
   *  a condition case id). Defaults to 'out' when absent. */
  sourcePort?: string
  target: string
  targetPort?: string
}

export interface Flow {
  version: '1.0'
  id: string
  name: string
  description?: string
  nodes: FlowBlock[]
  edges: FlowEdge[]
}

// Run payload (renderer -> main IPC)

/** What the main-process flow engine needs to run a flow headlessly; the renderer
 *  passes its in-memory state since main doesn't hold the store (mirrors RunnerPayload). */
export interface RunFlowPayload {
  flow: Flow
  collections: Collection[]
  /** All workspace flows, for sub-flow resolution. */
  flows: Flow[]
  environment: Environment | null
  globals: Record<string, string>
  proxy?: {
    url: string
    auth?: { username: string; password: string }
  }
  tls?: TlsSettings
  piiMaskPatterns?: string[]
}
