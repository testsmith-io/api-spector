// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Static input/output analysis for flow blocks — which variables a block reads
// and which it writes. Derived from the block's config (no execution), so the
// canvas and inspector can surface a block's data contract the way Postman
// Flows shows input/output ports. Best-effort and display-only: it parses
// {{templates}}, sp.*.get/set(...) calls and data.<name> references.

import type { FlowBlock } from './types/flow';

export interface BlockIO {
  reads: string[]
  writes: string[]
}

const TEMPLATE_RE = /\{\{\s*([A-Za-z_$][\w$]*)\s*\}\}/g;
const GET_RE = /sp\.(?:variables|globals|environment|collectionVariables)\.get\(\s*['"`]([^'"`]+)['"`]/g;
const SET_RE = /sp\.(?:variables|globals|environment|collectionVariables)\.set\(\s*['"`]([^'"`]+)['"`]/g;
const DATA_READ_RE = /\bdata\.([A-Za-z_$][\w$]*)/g;
const DATA_WRITE_RE = /\bdata\.([A-Za-z_$][\w$]*)\s*=/g;

function matchAll(re: RegExp, text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re)) out.push(m[1]);
  return out;
}

/** Text fields of a block that may reference / assign variables. */
function textFields(block: FlowBlock): string[] {
  const c = block.config ?? {};
  switch (block.type) {
    case 'if': return [c.expression ?? ''];
    case 'condition': return (c.cases ?? []).map(x => x.expression);
    case 'validate': case 'evaluate': return [c.script ?? ''];
    case 'forEach': return [c.expression ?? ''];
    case 'collect': return [c.valueExpression ?? ''];
    case 'setVar': return [c.valueExpression ?? ''];
    case 'display': case 'log': return [c.message ?? ''];
    default: return [];
  }
}

export function blockIO(block: FlowBlock): BlockIO {
  const c = block.config ?? {};
  const reads = new Set<string>();
  const writes = new Set<string>();

  for (const text of textFields(block)) {
    if (!text) continue;
    matchAll(TEMPLATE_RE, text).forEach(v => reads.add(v));
    matchAll(GET_RE, text).forEach(v => reads.add(v));
    // data.x reads, minus the ones that are assignments (data.x = …)
    const dataWrites = new Set(matchAll(DATA_WRITE_RE, text));
    matchAll(DATA_READ_RE, text).forEach(v => { if (dataWrites.has(v)) writes.add(v); else reads.add(v); });
    matchAll(SET_RE, text).forEach(v => writes.add(v));
  }

  switch (block.type) {
    case 'request': writes.add('response'); break;
    case 'forEach': writes.add(c.itemVar || 'item'); writes.add(c.indexVar || 'index'); break;
    case 'repeat': writes.add(c.indexVar || 'index'); break;
    case 'collect': writes.add(c.intoVar || 'results'); break;
    case 'setVar': if (c.varName) writes.add(c.varName); break;
    case 'start': (c.inputs ?? []).forEach(i => { if (i.key) writes.add(i.key); }); break;
    default: break;
  }

  // A block never both reads and writes the same name for display purposes —
  // writing wins (it's the block's product).
  for (const w of writes) reads.delete(w);
  return { reads: [...reads], writes: [...writes] };
}
