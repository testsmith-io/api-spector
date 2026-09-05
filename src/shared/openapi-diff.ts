// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// OpenAPI diff + breaking-change detection.
//
// Compares two OpenAPI 3.x documents and classifies what changed as breaking or
// not, from a consumer's point of view: a removed operation, a new required
// field, a changed type, a dropped response field. Pure and dependency-free;
// the CLI feeds it into an impact analysis (which tests/consumers a change hits).

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SpecChange {
  kind:
    | 'operation-removed' | 'operation-added'
    | 'request-required-added' | 'request-type-changed'
    | 'response-removed' | 'response-type-changed'
    | 'param-required-added' | 'success-code-removed'
  breaking: boolean
  method?: string           // upper-case
  path: string
  detail: string
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

function resolveRef(spec: any, ref: string): any {
  const parts = ref.replace(/^#\//, '').split('/');
  return parts.reduce((o, k) => o?.[decodeURIComponent(k.replace(/~1/g, '/').replace(/~0/g, '~'))], spec);
}
function deref(spec: any, node: any, depth = 0, seen: Set<any> = new Set()): any {
  if (!node || typeof node !== 'object' || depth > 8) return node;
  if (Array.isArray(node)) return node.map(n => deref(spec, n, depth + 1, seen));
  if ('$ref' in node) {
    const target = resolveRef(spec, node.$ref);
    if (!target || seen.has(target)) return {};
    return deref(spec, target, depth + 1, new Set([...seen, target]));
  }
  const out: any = {};
  for (const [k, v] of Object.entries(node)) out[k] = deref(spec, v, depth + 1, seen);
  return out;
}

// Walk a (dereferenced) schema into path -> type and the set of required paths.
function walk(schema: any, prefix: string, depth: number, types: Map<string, string>, required: Set<string>): void {
  if (!schema || typeof schema !== 'object' || depth > 8) return;
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'object' || schema.properties) {
    const req: string[] = schema.required ?? [];
    for (const [name, sub] of Object.entries<any>(schema.properties ?? {})) {
      const p = prefix ? `${prefix}.${name}` : name;
      const subType = (Array.isArray(sub?.type) ? sub.type[0] : sub?.type) ?? (sub?.properties ? 'object' : 'any');
      types.set(p, subType);
      if (req.includes(name)) required.add(p);
      walk(sub, p, depth + 1, types, required);
    }
  } else if (type === 'array' && schema.items) {
    walk(schema.items, `${prefix}[]`, depth + 1, types, required);
  }
}

function schemaInfo(spec: any, schema: any): { types: Map<string, string>; required: Set<string> } {
  const types = new Map<string, string>();
  const required = new Set<string>();
  if (schema) walk(deref(spec, schema), '', 0, types, required);
  return { types, required };
}

function requestSchema(spec: any, op: any): any {
  return deref(spec, op?.requestBody)?.content?.['application/json']?.schema;
}
function successResponseSchema(spec: any, op: any): any {
  const responses = op?.responses ?? {};
  const code = Object.keys(responses).filter(c => /^2\d\d$/.test(c)).sort()[0];
  return code ? deref(spec, responses[code])?.content?.['application/json']?.schema : undefined;
}
function paramRequired(spec: any, pathItem: any, op: any): Map<string, boolean> {
  const raw = [...(pathItem?.parameters ?? []), ...(op?.parameters ?? [])].map(p => deref(spec, p));
  const m = new Map<string, boolean>();
  for (const p of raw) if (p?.name && p?.in) m.set(`${p.in}:${p.name}`, !!p.required);
  return m;
}

function operations(spec: any): Map<string, { method: string; path: string; pathItem: any; op: any }> {
  const map = new Map<string, { method: string; path: string; pathItem: any; op: any }>();
  for (const [path, item] of Object.entries<any>(spec?.paths ?? {})) {
    if (!item || typeof item !== 'object') continue;
    for (const [method, op] of Object.entries<any>(item)) {
      if (!HTTP_METHODS.includes(method.toLowerCase())) continue;
      map.set(`${method.toUpperCase()} ${path}`, { method: method.toUpperCase(), path, pathItem: item, op });
    }
  }
  return map;
}

export function diffSpecs(oldSpec: unknown, newSpec: unknown): SpecChange[] {
  const oldOps = operations(oldSpec);
  const newOps = operations(newSpec);
  const changes: SpecChange[] = [];

  for (const [key, o] of oldOps) {
    if (!newOps.has(key)) {
      changes.push({ kind: 'operation-removed', breaking: true, method: o.method, path: o.path, detail: `Operation ${key} was removed` });
    }
  }
  for (const [key, n] of newOps) {
    if (!oldOps.has(key)) {
      changes.push({ kind: 'operation-added', breaking: false, method: n.method, path: n.path, detail: `Operation ${key} was added` });
      continue;
    }
    const o = oldOps.get(key)!;
    const label = `${n.method} ${n.path}`;

    // Request body.
    const oReq = schemaInfo(oldSpec, requestSchema(oldSpec, o.op));
    const nReq = schemaInfo(newSpec, requestSchema(newSpec, n.op));
    for (const p of nReq.required) {
      if (!oReq.required.has(p)) {
        changes.push({ kind: 'request-required-added', breaking: true, method: n.method, path: n.path, detail: `${label}: request field "${p}" is now required` });
      }
    }
    for (const [p, t] of nReq.types) {
      const ot = oReq.types.get(p);
      if (ot && ot !== t) {
        changes.push({ kind: 'request-type-changed', breaking: true, method: n.method, path: n.path, detail: `${label}: request field "${p}" type ${ot} -> ${t}` });
      }
    }

    // Success response body.
    const oRes = schemaInfo(oldSpec, successResponseSchema(oldSpec, o.op));
    const nRes = schemaInfo(newSpec, successResponseSchema(newSpec, n.op));
    for (const [p, t] of oRes.types) {
      if (!nRes.types.has(p)) {
        changes.push({ kind: 'response-removed', breaking: true, method: n.method, path: n.path, detail: `${label}: response field "${p}" was removed` });
      } else if (nRes.types.get(p) !== t) {
        changes.push({ kind: 'response-type-changed', breaking: true, method: n.method, path: n.path, detail: `${label}: response field "${p}" type ${t} -> ${nRes.types.get(p)}` });
      }
    }

    // Parameters: a newly-required parameter breaks existing callers.
    const oParams = paramRequired(oldSpec, o.pathItem, o.op);
    const nParams = paramRequired(newSpec, n.pathItem, n.op);
    for (const [k, req] of nParams) {
      if (req && !oParams.get(k)) {
        changes.push({ kind: 'param-required-added', breaking: true, method: n.method, path: n.path, detail: `${label}: parameter "${k}" is now required` });
      }
    }

    // A removed success code (e.g. 200 no longer possible).
    const oCodes = Object.keys(o.op?.responses ?? {}).filter(c => /^2\d\d$/.test(c));
    const nCodes = new Set(Object.keys(n.op?.responses ?? {}));
    for (const c of oCodes) {
      if (!nCodes.has(c)) {
        changes.push({ kind: 'success-code-removed', breaking: true, method: n.method, path: n.path, detail: `${label}: success response ${c} was removed` });
      }
    }
  }

  return changes;
}

export function summarizeDiff(changes: SpecChange[]): { breaking: number; nonBreaking: number } {
  return {
    breaking: changes.filter(c => c.breaking).length,
    nonBreaking: changes.filter(c => !c.breaking).length,
  };
}
