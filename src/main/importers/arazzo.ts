// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Import an Arazzo workflow document (the OpenAPI Initiative's spec for
// sequences of API calls) as API Spector Flows. Each Arazzo `workflow` becomes
// one Flow; its `sourceDescriptions` (OpenAPI specs) are imported into a
// collection so the steps have requests to reference. A step maps to a
// request block, its successCriteria to a validate block, and its outputs to an
// evaluate block, chained by onSuccess / onFailure routing.
//
// Arazzo runtime expressions ($response.body#/id, $inputs.x, $statusCode, ...)
// are translated to the sp.* sandbox used elsewhere. The translation covers the
// common forms; anything it cannot map is recorded as a warning and left as a
// clearly-marked placeholder, so the imported flow is never silently wrong.

import { readFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath, basename } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { v4 as uuidv4 } from 'uuid';
import { importOpenApi, importOpenApiFromUrl } from './openapi';
import type { Collection, ApiRequest, Flow, FlowBlock, FlowEdge, FlowBlockConfig } from '../../shared/types';

export interface ArazzoImportResult {
  collection: Collection
  flows: Flow[]
  warnings: string[]
}

// ─── Runtime-expression translation ───────────────────────────────────────────

/** Convert a JSON Pointer fragment (e.g. `/items/0/id`) into a JS accessor tail
 *  (e.g. `.items[0].id`). */
function jsonPointerToAccessor(pointer: string): string {
  const parts = pointer.split('/').filter(p => p !== '');
  let out = '';
  for (const raw of parts) {
    const part = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (/^\d+$/.test(part)) out += `[${part}]`;
    else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part)) out += `.${part}`;
    else out += `[${JSON.stringify(part)}]`;
  }
  return out;
}

/**
 * Translate a single Arazzo runtime expression (starting with `$`) into a JS
 * expression over the sp.* sandbox. `warn` is called for forms we cannot map.
 */
export function translateRuntimeExpr(expr: string, warn?: (msg: string) => void): string {
  const e = expr.trim();

  if (e === '$statusCode') return 'sp.response.code';
  if (e === '$response.body') return 'sp.response.json()';

  // $response.body#/pointer  → sp.response.json()<accessor>
  let m = /^\$response\.body#(\/.*)$/.exec(e);
  if (m) return `sp.response.json()${jsonPointerToAccessor(m[1])}`;

  // $response.header.NAME
  m = /^\$response\.header[s]?\.(.+)$/.exec(e);
  if (m) return `sp.response.headers.get(${JSON.stringify(m[1])})`;

  // $inputs.name → a flow variable (inputs are seeded into the local scope)
  m = /^\$inputs\.(.+)$/.exec(e);
  if (m) return `sp.variables.get(${JSON.stringify(m[1])})`;

  // $steps.<id>.outputs.<name> / $workflows.<id>.outputs.<name> → a variable
  // (step outputs are stored as flow variables by the generated evaluate block)
  m = /^\$(?:steps|workflows)\.[^.]+\.outputs\.(.+)$/.exec(e);
  if (m) return `sp.variables.get(${JSON.stringify(m[1])})`;

  // $outputs.name → a variable
  m = /^\$outputs\.(.+)$/.exec(e);
  if (m) return `sp.variables.get(${JSON.stringify(m[1])})`;

  warn?.(`Could not translate runtime expression: ${e}`);
  return `/* TODO: ${e} */ undefined`;
}

/** Translate a parameter/template value, which may be a literal or contain
 *  embedded `{$expr}` references, into a value suitable for a request field
 *  (using {{var}} where the reference is a flow variable). */
export function translateTemplateValue(value: unknown, warn?: (msg: string) => void): string {
  if (typeof value !== 'string') return value == null ? '' : JSON.stringify(value);
  // Whole-string runtime expression.
  if (/^\$[A-Za-z]/.test(value)) {
    const m = /^\$(?:inputs|outputs)\.(.+)$/.exec(value)
      ?? /^\$(?:steps|workflows)\.[^.]+\.outputs\.(.+)$/.exec(value);
    if (m) return `{{${m[1]}}}`;
    warn?.(`Parameter value uses an expression that needs a variable: ${value}`);
    return value;
  }
  // Embedded {$expr} references inside a string.
  return value.replace(/\{\$([^}]+)\}/g, (_full, inner: string) => {
    const ref = `$${inner}`;
    const m = /^\$(?:inputs|outputs)\.(.+)$/.exec(ref)
      ?? /^\$(?:steps|workflows)\.[^.]+\.outputs\.(.+)$/.exec(ref);
    if (m) return `{{${m[1]}}}`;
    warn?.(`Embedded expression left as-is: {$${inner}}`);
    return `{$${inner}}`;
  });
}

// ─── successCriteria → validate script ─────────────────────────────────────────

function translateCondition(cond: string, warn?: (msg: string) => void): string {
  // Replace each runtime expression token with its JS translation, then relax
  // == / != into JS strict equality. This is best-effort for the "simple"
  // condition grammar.
  const translated = cond.replace(/\$[A-Za-z][\w.#/~[\]]*/g, (tok) => `(${translateRuntimeExpr(tok, warn)})`);
  return translated.replace(/([^=!<>])={2}([^=])/g, '$1===$2').replace(/!={1}([^=])/g, '!==$1');
}

export function buildValidateScript(criteria: any[], warn?: (msg: string) => void): string {
  const lines: string[] = [];
  criteria.forEach((c, i) => {
    const name = `criterion ${i + 1}`;
    const type = c.type?.type ?? c.type; // type can be a string or an object
    if (type === 'regex') {
      const ctx = c.context ? translateRuntimeExpr(c.context, warn) : 'sp.response.text()';
      lines.push(`sp.test(${JSON.stringify(name)}, () => { sp.expect(String(${ctx})).to.match(${toRegexLiteral(c.condition)}); });`);
    } else if (type === 'jsonpath') {
      const ctx = c.context ? translateRuntimeExpr(c.context, warn) : 'sp.response.json()';
      lines.push(`sp.test(${JSON.stringify(name)}, () => { sp.expect(sp.jsonPath(${ctx}, ${JSON.stringify(c.condition)}).length).to.be.above(0); });`);
    } else if (type === 'xpath') {
      warn?.(`xpath successCriteria left as a TODO: ${c.condition}`);
      lines.push(`sp.test(${JSON.stringify(name)}, () => { /* TODO xpath: ${c.condition} */ });`);
    } else {
      // simple (default)
      lines.push(`sp.test(${JSON.stringify(name)}, () => { sp.expect(Boolean(${translateCondition(String(c.condition), warn)})).to.equal(true); });`);
    }
  });
  return lines.join('\n');
}

function toRegexLiteral(pattern: string): string {
  return `/${String(pattern).replace(/\//g, '\\/')}/`;
}

// ─── outputs → evaluate script ─────────────────────────────────────────────────

export function buildOutputsScript(outputs: Record<string, unknown>, warn?: (msg: string) => void): string {
  return Object.entries(outputs)
    .map(([name, expr]) => `sp.variables.set(${JSON.stringify(name)}, ${typeof expr === 'string' && expr.startsWith('$') ? translateRuntimeExpr(expr, warn) : JSON.stringify(expr)});`)
    .join('\n');
}

// ─── Flow construction ─────────────────────────────────────────────────────────

interface BuildCtx {
  collectionId: string
  /** operationId → request id, for the single-source common case. */
  opToRequest: Map<string, string>
  requests: Record<string, ApiRequest>
  warnings: string[]
}

/** Find the imported request a step points at. Arazzo can reference an operation
 *  as a bare operationId, as a source-qualified `sourceName.operationId`, or via
 *  operationPath/operationRef, so try the value as written and its last segment
 *  (the part after the final `.`, `/` or `#`). */
function resolveStepOperation(step: any, ctx: BuildCtx): string | undefined {
  const candidates: string[] = [];
  const add = (v: unknown): void => {
    if (typeof v !== 'string' || !v) return;
    candidates.push(v);
    const tail = v.split(/[./#]/).filter(Boolean).pop();
    if (tail && tail !== v) candidates.push(tail);
  };
  add(step?.operationId);
  add(step?.operationPath);
  add(step?.operationRef);
  for (const key of candidates) {
    const id = ctx.opToRequest.get(key);
    if (id) return id;
  }
  return undefined;
}

/** Deep-clone an imported request and apply a step's parameter / requestBody
 *  overrides, returning the clone's id (added to the collection). */
function cloneRequestForStep(baseId: string, step: any, ctx: BuildCtx): string {
  const base = ctx.requests[baseId];
  const clone: ApiRequest = structuredClone(base);
  clone.id = uuidv4();
  clone.name = step.stepId ? String(step.stepId) : clone.name;
  const warn = (m: string) => ctx.warnings.push(m);

  for (const p of step.parameters ?? []) {
    if (!p || !p.name) continue;
    const value = translateTemplateValue(p.value, warn);
    const where = p.in ?? 'query';
    if (where === 'header') {
      const h = clone.headers.find(x => x.key.toLowerCase() === String(p.name).toLowerCase());
      if (h) h.value = value; else clone.headers.push({ key: String(p.name), value, enabled: true });
    } else if (where === 'path') {
      const pp = clone.params.find(x => x.key === p.name && x.paramType === 'path');
      if (pp) pp.value = value; else clone.params.push({ key: String(p.name), value, enabled: true, paramType: 'path' });
    } else {
      const qp = clone.params.find(x => x.key === p.name && x.paramType !== 'path');
      if (qp) qp.value = value; else clone.params.push({ key: String(p.name), value, enabled: true, paramType: 'query' });
    }
  }

  if (step.requestBody && step.requestBody.payload !== undefined) {
    const payload = step.requestBody.payload;
    // Translate embedded {$expr} references in both string and object payloads
    // (object payloads are stringified first, then their string leaves rewritten).
    const text = translateTemplateValue(
      typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      warn,
    );
    clone.body = { ...clone.body, mode: 'json', json: text };
  }

  ctx.requests[clone.id] = clone;
  return clone.id;
}

/** Build one Flow from an Arazzo workflow. */
export function buildWorkflowFlow(workflow: any, ctx: BuildCtx): Flow {
  const nodes: FlowBlock[] = [];
  const edges: FlowEdge[] = [];
  const warn = (m: string) => ctx.warnings.push(m);

  const node = (type: FlowBlock['type'], config: FlowBlockConfig, col: number, row: number, label?: string): FlowBlock => {
    const b: FlowBlock = { id: uuidv4(), type, position: { x: 120 + col * 240, y: 80 + row * 120 }, config, label };
    nodes.push(b);
    return b;
  };
  const link = (source: string, target: string, sourcePort?: string): void => {
    edges.push({ id: uuidv4(), source, target, sourcePort });
  };

  // Start block, seeded with the workflow inputs.
  const inputProps = workflow.inputs?.properties ?? {};
  const inputs = Object.entries<any>(inputProps).map(([key, schema]) => ({
    key,
    value: schema?.default !== undefined ? String(schema.default) : '',
  }));
  const start = node('start', { inputs }, 0, 0, workflow.workflowId);
  const end = node('end', {}, (workflow.steps?.length ?? 0) + 1, 0);

  // First block of each step, so goto targets can resolve.
  const stepFirstBlock = new Map<string, string>();
  // The block a step's success path should leave from (last block of its chain).
  const stepExit: { stepId: string; blockId: string; requestId: string }[] = [];

  (workflow.steps ?? []).forEach((step: any, i: number) => {
    const col = i + 1;
    // Resolve the request this step references.
    let requestId: string | undefined;
    const baseId = resolveStepOperation(step, ctx);
    if (baseId) {
      requestId = cloneRequestForStep(baseId, step, ctx);
    } else {
      const ref = step.operationId ?? step.operationPath ?? step.operationRef ?? step.workflowId ?? '(unknown)';
      warn(`Step "${step.stepId}" references ${ref}, which was not found among the imported operations. Check that the OpenAPI spec defines that operationId.`);
    }

    const reqBlock = node('request', requestId ? { ref: { collectionId: ctx.collectionId, requestId } } : {}, col, 0, step.stepId);
    stepFirstBlock.set(String(step.stepId), reqBlock.id);

    let exitId = reqBlock.id;
    let exitPort: string | undefined = 'success';

    if (Array.isArray(step.successCriteria) && step.successCriteria.length) {
      const v = node('validate', { script: buildValidateScript(step.successCriteria, warn) }, col, 1, `${step.stepId} checks`);
      link(exitId, v.id, exitPort);
      exitId = v.id; exitPort = 'pass';
    }
    if (step.outputs && Object.keys(step.outputs).length) {
      const ev = node('evaluate', { script: buildOutputsScript(step.outputs, warn) }, col, 2, `${step.stepId} outputs`);
      link(exitId, ev.id, exitPort);
      exitId = ev.id; exitPort = 'out';
    }

    stepExit.push({ stepId: String(step.stepId), blockId: exitId, requestId: reqBlock.id });

    // Route the request's fail port per onFailure (default: end the flow).
    const onFailure = step.onFailure ?? [];
    const failGoto = onFailure.find((a: any) => a.type === 'goto' && a.stepId);
    if (failGoto) {
      // resolved after all first-blocks exist (below)
      step.__failGoto = failGoto.stepId;
    } else {
      link(reqBlock.id, end.id, 'fail');
    }
  });

  // Chain steps: success exit → next step (or onSuccess goto / end).
  const steps = workflow.steps ?? [];
  steps.forEach((step: any, i: number) => {
    const exit = stepExit[i];
    if (!exit) return;
    const exitPort = exit.blockId === exit.requestId ? 'success' : (nodes.find(n => n.id === exit.blockId)?.type === 'validate' ? 'pass' : 'out');
    const onSuccess = step.onSuccess ?? [];
    const sucEnd = onSuccess.find((a: any) => a.type === 'end');
    const sucGoto = onSuccess.find((a: any) => a.type === 'goto' && a.stepId);
    if (sucEnd) {
      link(exit.blockId, end.id, exitPort);
    } else if (sucGoto && stepFirstBlock.has(String(sucGoto.stepId))) {
      link(exit.blockId, stepFirstBlock.get(String(sucGoto.stepId))!, exitPort);
    } else if (i + 1 < steps.length && stepExit[i + 1]) {
      link(exit.blockId, stepFirstBlock.get(String(steps[i + 1].stepId))!, exitPort);
    } else {
      link(exit.blockId, end.id, exitPort);
    }
    // Resolve a deferred onFailure goto now that first-blocks exist.
    if (step.__failGoto && stepFirstBlock.has(String(step.__failGoto))) {
      link(exit.requestId, stepFirstBlock.get(String(step.__failGoto))!, 'fail');
    }
  });

  // Connect Start to the first step (or End if there are no steps).
  const firstStepId = steps[0]?.stepId;
  link(start.id, firstStepId ? stepFirstBlock.get(String(firstStepId))! : end.id);

  return {
    version: '1.0',
    id: uuidv4(),
    name: String(workflow.workflowId ?? workflow.summary ?? 'Imported workflow'),
    description: workflow.summary ?? workflow.description ?? '',
    nodes,
    edges,
  };
}

// ─── Collection assembly (import the source OpenAPI specs) ─────────────────────

// Resolve a source description's OpenAPI spec, trying in order: its URL as
// written (http, or relative to the Arazzo file), then a user-selected file
// matching the URL's filename, then — when the workflow has a single source and
// the user supplied a single spec — that file. Returns null if none load.
async function importSource(
  source: any,
  baseDir: string,
  sourcePaths: string[],
  allowSingleFallback: boolean,
): Promise<Collection | null> {
  const url = typeof source?.url === 'string' ? source.url : '';

  if (/^https?:\/\//i.test(url)) {
    try { return await importOpenApiFromUrl(url); } catch { /* try local files below */ }
  } else if (url) {
    try { return await importOpenApi(resolvePath(baseDir, url)); } catch { /* try selected files below */ }
  }

  // Match a user-selected file by the URL's filename.
  if (url) {
    const base = url.split(/[\\/]/).pop();
    const match = sourcePaths.find(p => basename(p) === base);
    if (match) { try { return await importOpenApi(match); } catch { /* fall through */ } }
  }

  // Single source + a single supplied spec: use it even if the name differs.
  if (allowSingleFallback && sourcePaths.length === 1) {
    try { return await importOpenApi(sourcePaths[0]); } catch { /* fall through */ }
  }
  return null;
}

function mergeSourceIntoCollection(col: Collection, source: Collection, folderName: string, opMap: Map<string, string>): void {
  for (const [id, req] of Object.entries(source.requests)) {
    col.requests[id] = req;
    const opId = (req.meta as { operationId?: string } | undefined)?.operationId;
    if (opId) {
      opMap.set(opId, id);
      opMap.set(`${folderName}.${opId}`, id);   // source-qualified form
    }
  }
  col.rootFolder.folders.push({
    id: uuidv4(),
    name: folderName,
    description: source.description ?? '',
    folders: source.rootFolder.folders,
    requestIds: source.rootFolder.requestIds,
  });
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function importArazzoDoc(doc: any, baseDir: string, sourcePaths: string[] = []): Promise<ArazzoImportResult> {
  const warnings: string[] = [];
  const title = doc?.info?.title ?? 'Arazzo import';

  const collection: Collection = {
    version: '1.0',
    id: uuidv4(),
    name: String(title),
    description: doc?.info?.summary ?? doc?.info?.description ?? '',
    rootFolder: { id: uuidv4(), name: 'root', description: '', folders: [], requestIds: [] },
    requests: {},
  };

  const opToRequest = new Map<string, string>();
  const sources = Array.isArray(doc?.sourceDescriptions) ? doc.sourceDescriptions : [];
  const singleSource = sources.length === 1;
  for (const source of sources) {
    const imported = await importSource(source, baseDir, sourcePaths, singleSource);
    if (!imported) {
      warnings.push(`Could not load the OpenAPI spec for source "${source?.name ?? source?.url ?? '(unnamed)'}". Import the Arazzo file together with its OpenAPI spec file(s), or make the sourceDescription url reachable.`);
      continue;
    }
    mergeSourceIntoCollection(collection, imported, String(source?.name ?? 'source'), opToRequest);
  }

  const ctx: BuildCtx = { collectionId: collection.id, opToRequest, requests: collection.requests, warnings };
  const workflows = Array.isArray(doc?.workflows) ? doc.workflows : [];
  const flows = workflows.map((wf: any) => buildWorkflowFlow(wf, ctx));

  if (flows.length === 0) warnings.push('The Arazzo document defined no workflows.');

  return { collection, flows, warnings };
}

async function loadDoc(filePath: string): Promise<any> {
  const raw = await readFile(filePath, 'utf8');
  return filePath.endsWith('.yaml') || filePath.endsWith('.yml') ? yamlLoad(raw) : JSON.parse(raw);
}

/** True when a parsed document looks like an Arazzo workflow document. */
function looksLikeArazzo(doc: any): boolean {
  return Boolean(doc && (doc.arazzo || Array.isArray(doc.workflows)));
}

export async function importArazzo(filePath: string, sourcePaths: string[] = []): Promise<ArazzoImportResult> {
  const doc = await loadDoc(filePath);
  return importArazzoDoc(doc, dirname(filePath), sourcePaths);
}

/** Import from a set of selected files: the Arazzo document plus any OpenAPI
 *  source specs it references. The Arazzo file is detected by its content, so
 *  the user can select them together in any order. */
export async function importArazzoFiles(paths: string[]): Promise<ArazzoImportResult> {
  let arazzoPath: string | undefined;
  const sourcePaths: string[] = [];
  for (const p of paths) {
    let doc: any;
    try { doc = await loadDoc(p); } catch { sourcePaths.push(p); continue; }
    if (!arazzoPath && looksLikeArazzo(doc)) arazzoPath = p;
    else sourcePaths.push(p);
  }
  if (!arazzoPath) throw new Error('No Arazzo workflow document was found among the selected files (expected an "arazzo" field or "workflows").');
  return importArazzo(arazzoPath, sourcePaths);
}
