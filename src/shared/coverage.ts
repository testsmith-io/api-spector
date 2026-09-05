// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// OpenAPI test-coverage engine.
//
// Given a parsed OpenAPI 3.x document and the requests in a workspace, work out
// which operations are exercised, which declared response codes are asserted,
// and which operations lack a negative test. Pure and dependency-free so the
// CLI, the desktop app, and the tests can all share it — the caller parses the
// spec (YAML/JSON) and maps requests into CoverageRequestInput.

// ─── Inputs ─────────────────────────────────────────────────────────────────

/** A workspace request, reduced to what coverage needs. */
export interface CoverageRequestInput {
  /** Display label, e.g. "Product API / Get product". */
  name: string
  method: string
  /** The request URL as authored (may contain {{vars}}, a host, a base path). */
  url: string
  /** The status code this request asserts, if any (e.g. from its contract). */
  expectedStatus?: number
}

/** An actual execution observed from run history: what status came back and
 *  which response-body property paths were present. Lets coverage credit codes
 *  and response shape that were exercised for real, not just declared. */
export interface CoverageObservation {
  method: string
  url: string
  status: number
  /** Dotted property paths present in the response body (see flattenValuePaths). */
  responsePaths?: string[]
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

// ─── Outputs ────────────────────────────────────────────────────────────────

export interface OperationCoverage {
  method: string            // upper-case, e.g. "GET"
  path: string              // the OpenAPI path template, e.g. "/products/{id}"
  operationId?: string
  /** At least one request maps to this operation. */
  tested: boolean
  /** Labels of the requests that map here. */
  requests: string[]
  /** Numeric response codes the spec declares for this operation. */
  declaredStatuses: string[]
  /** Declared codes covered by a mapped request's assertion or an observed run. */
  coveredStatuses: string[]
  /** A mapped request asserts a 4xx/5xx (an error path is tested). */
  hasNegativeTest: boolean
  /** Dotted property paths in the success response schema. */
  declaredProperties: string[]
  /** Declared properties seen in an observed response body for this operation. */
  coveredProperties: string[]
}

export interface CoverageTotals {
  operations: number
  tested: number
  untested: number
  operationPct: number
  declaredStatuses: number
  coveredStatuses: number
  statusPct: number
  /** Tested operations that have no negative (4xx/5xx) test. */
  withoutNegativeTest: number
  /** Response-schema properties across all operations, and how many were seen
   *  in an observed run. propertyPct is 0 until you run tests / pass runs. */
  declaredProperties: number
  coveredProperties: number
  propertyPct: number
}

export interface CoverageReport {
  spec: { title?: string; version?: string }
  totals: CoverageTotals
  operations: OperationCoverage[]
}

// ─── Path matching ────────────────────────────────────────────────────────────

/** Reduce an authored URL to a comparable path: drop query/hash, {{vars}}, and
 *  any scheme://host, collapse slashes. Base paths differ between environments,
 *  so matching is done on the path tail (see pathMatches). */
export function normalizePath(url: string): string {
  let u = (url || '').trim();
  u = u.split('#')[0].split('?')[0];
  u = u.replace(/\{\{[^}]*\}\}/g, '');          // strip {{baseUrl}} etc.
  u = u.replace(/^[a-z0-9+.-]+:\/\/[^/]*/i, ''); // strip scheme://host
  u = u.replace(/\/{2,}/g, '/');
  if (!u.startsWith('/')) u = '/' + u;
  u = u.replace(/\/+$/, '');
  return u === '' ? '/' : u;
}

function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function isParam(seg: string): boolean {
  return seg.startsWith('{') && seg.endsWith('}');
}

/** Does a request path exercise an operation template? The operation template
 *  must match the tail of the request path (so a base path like /v1 in front is
 *  tolerated), with {param} matching exactly one non-empty segment. */
export function pathMatches(requestUrl: string, template: string): boolean {
  const reqSegs = segments(normalizePath(requestUrl));
  const tplSegs = segments(template);
  if (reqSegs.length < tplSegs.length) return false;
  const tail = reqSegs.slice(reqSegs.length - tplSegs.length);
  return tplSegs.every((seg, i) => (isParam(seg) ? tail[i] !== undefined && tail[i] !== '' : tail[i] === seg));
}

// ─── Spec enumeration ─────────────────────────────────────────────────────────

interface OpenApiLike {
  info?: { title?: string; version?: string }
  paths?: Record<string, Record<string, { operationId?: string; responses?: Record<string, unknown> }>>
}

export interface SpecOperation {
  method: string            // upper-case
  path: string
  operationId?: string
  declaredStatuses: string[]
  /** Raw responses object, kept so the success response schema can be read. */
  responses?: Record<string, unknown>
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// Minimal $ref resolver + inliner (bounded), so response schemas can be
// flattened into property paths without pulling in a full OpenAPI library.
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

/** Dotted property paths of a (dereferenced) JSON schema. Arrays use "[]".
 *  e.g. { id, address:{ city }, tags:[{ name }] } -> id, address, address.city,
 *  tags, tags[].name */
export function flattenSchemaPaths(schema: any, prefix = '', depth = 0): string[] {
  if (!schema || typeof schema !== 'object' || depth > 8) return [];
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  const out: string[] = [];
  if (type === 'object' || schema.properties) {
    for (const [name, sub] of Object.entries<any>(schema.properties ?? {})) {
      const path = prefix ? `${prefix}.${name}` : name;
      out.push(path);
      out.push(...flattenSchemaPaths(sub, path, depth + 1));
    }
  } else if (type === 'array' && schema.items) {
    out.push(...flattenSchemaPaths(schema.items, `${prefix}[]`, depth + 1));
  }
  return out;
}

/** Dotted property paths present in a JSON value, matching flattenSchemaPaths. */
export function flattenValuePaths(value: any, prefix = '', depth = 0): string[] {
  if (value == null || typeof value !== 'object' || depth > 8) return [];
  const out: string[] = [];
  if (Array.isArray(value)) {
    // Merge paths across elements so a heterogeneous array is fully credited.
    for (const el of value) out.push(...flattenValuePaths(el, `${prefix}[]`, depth + 1));
  } else {
    for (const [k, v] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${k}` : k;
      out.push(path);
      out.push(...flattenValuePaths(v, path, depth + 1));
    }
  }
  return [...new Set(out)];
}

function successResponseSchema(spec: any, responses: any): any | undefined {
  const code = Object.keys(responses ?? {}).filter(c => /^2\d\d$/.test(c)).sort()[0];
  if (!code) return undefined;
  const schema = responses[code]?.content?.['application/json']?.schema
    ?? responses[code]?.content?.['application/json;charset=utf-8']?.schema;
  return schema ? deref(spec, schema) : undefined;
}

/** Flatten a spec's paths into a list of operations, keeping only numeric
 *  declared response codes (ranges like "2XX" and "default" are ignored for the
 *  status-coverage metric, so it stays a concrete count). */
export function enumerateOperations(spec: unknown): SpecOperation[] {
  const doc = (spec ?? {}) as OpenApiLike;
  const ops: SpecOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    if (!item || typeof item !== 'object') continue;
    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.includes(method.toLowerCase())) continue;
      if (!op || typeof op !== 'object') continue;
      const declaredStatuses = Object.keys(op.responses ?? {}).filter(c => /^\d{3}$/.test(c));
      ops.push({ method: method.toUpperCase(), path, operationId: op.operationId, declaredStatuses, responses: op.responses });
    }
  }
  return ops;
}

// ─── Coverage ───────────────────────────────────────────────────────────────

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export function computeCoverage(spec: unknown, requests: CoverageRequestInput[], observations: CoverageObservation[] = []): CoverageReport {
  const doc = (spec ?? {}) as OpenApiLike;
  const operations = enumerateOperations(spec).map<OperationCoverage>(op => {
    const mapped = requests.filter(r => r.method.toUpperCase() === op.method && pathMatches(r.url, op.path));
    const obs = observations.filter(o => o.method.toUpperCase() === op.method && pathMatches(o.url, op.path));

    // A code is covered if a request asserts it OR a run returned it.
    const asserted = mapped.map(r => r.expectedStatus).filter((s): s is number => typeof s === 'number');
    const seen = obs.map(o => o.status);
    const covered = new Set([...asserted, ...seen]);
    const coveredStatuses = op.declaredStatuses.filter(code => covered.has(Number(code)));
    const hasNegativeTest = [...covered].some(s => s >= 400);

    // Response-shape coverage: which declared success-schema properties actually
    // appeared in an observed response body.
    const declaredProperties = flattenSchemaPaths(successResponseSchema(doc, op.responses ?? {}));
    const observedPaths = new Set(obs.flatMap(o => o.responsePaths ?? []));
    const coveredProperties = declaredProperties.filter(p => observedPaths.has(p));

    return {
      method: op.method,
      path: op.path,
      operationId: op.operationId,
      tested: mapped.length > 0 || obs.length > 0,
      requests: mapped.map(r => r.name),
      declaredStatuses: op.declaredStatuses,
      coveredStatuses,
      hasNegativeTest,
      declaredProperties,
      coveredProperties,
    };
  });

  const tested = operations.filter(o => o.tested).length;
  const declaredStatuses = operations.reduce((n, o) => n + o.declaredStatuses.length, 0);
  const coveredStatuses = operations.reduce((n, o) => n + o.coveredStatuses.length, 0);
  const declaredProperties = operations.reduce((n, o) => n + o.declaredProperties.length, 0);
  const coveredProperties = operations.reduce((n, o) => n + o.coveredProperties.length, 0);
  const withoutNegativeTest = operations.filter(o => o.tested && !o.hasNegativeTest).length;

  return {
    spec: { title: doc.info?.title, version: doc.info?.version },
    totals: {
      operations: operations.length,
      tested,
      untested: operations.length - tested,
      operationPct: operations.length ? round((tested / operations.length) * 100) : 0,
      declaredStatuses,
      coveredStatuses,
      statusPct: declaredStatuses ? round((coveredStatuses / declaredStatuses) * 100) : 0,
      withoutNegativeTest,
      declaredProperties,
      coveredProperties,
      propertyPct: declaredProperties ? round((coveredProperties / declaredProperties) * 100) : 0,
    },
    operations,
  };
}
