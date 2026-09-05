// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// OpenAPI test generation.
//
// Turns an OpenAPI 3.x document into real tests: a happy-path call per operation
// (valid request + response-schema assertion), plus negative tests derived from
// the request schema (missing required field, wrong type) and boundary tests
// from numeric/string constraints. Pure and dependency-free so the CLI, the
// desktop app, and the tests share it; the caller maps GeneratedTest into an
// ApiRequest (or a collection file).

// ─── Output ─────────────────────────────────────────────────────────────────

export type TestCategory = 'happy' | 'negative' | 'boundary';

export interface GeneratedTest {
  operationId?: string
  method: string            // upper-case
  path: string              // OpenAPI path template, e.g. "/users/{id}"
  name: string              // "POST /users - missing email"
  category: TestCategory
  /** Path params filled with sample values, keyed by name. */
  pathParams: Record<string, string | number | boolean>
  query: { key: string; value: string }[]
  headers: { key: string; value: string }[]
  /** JSON request body as a string, or undefined for no body. */
  body?: string
  /** The status this test asserts. */
  expectedStatus: number
  /** JSON Schema (string) for the success response, attached to happy tests. */
  responseSchema?: string
}

export interface GenerateOptions {
  /** Limit to these operations, each keyed as "METHOD /path". Omit for all. */
  only?: Set<string>
  includeNegative?: boolean   // default true
  includeBoundary?: boolean   // default true
  maxNegativePerOp?: number   // default 4
  maxBoundaryPerOp?: number   // default 4
}

// ─── Spec walking ─────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

function resolveRef(spec: any, ref: string): any {
  const parts = ref.replace(/^#\//, '').split('/');
  return parts.reduce((o, k) => o?.[decodeURIComponent(k.replace(/~1/g, '/').replace(/~0/g, '~'))], spec);
}

/** Inline $refs into a self-contained schema, bounded so a recursive schema
 *  can't loop forever. */
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

function jsonSchemaFor(spec: any, responses: any, code: string): any | undefined {
  const resp = responses?.[code];
  const schema = resp?.content?.['application/json']?.schema
    ?? resp?.content?.['application/json;charset=utf-8']?.schema;
  return schema ? deref(spec, schema) : undefined;
}

// ─── Value sampling ───────────────────────────────────────────────────────────

/** A valid sample value that satisfies a (dereferenced) schema's constraints. */
export function sampleValue(schema: any): any {
  if (!schema || typeof schema !== 'object') return 'string';
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  switch (type) {
    case 'integer':
    case 'number': {
      const min = schema.minimum ?? (schema.exclusiveMinimum != null ? schema.exclusiveMinimum + 1 : undefined);
      const max = schema.maximum ?? (schema.exclusiveMaximum != null ? schema.exclusiveMaximum - 1 : undefined);
      if (min != null) return min;
      if (max != null) return max;
      return type === 'integer' ? 1 : 1.5;
    }
    case 'boolean':
      return true;
    case 'array':
      return [sampleValue(schema.items ?? {})];
    case 'object': {
      const out: Record<string, any> = {};
      const props = schema.properties ?? {};
      const required: string[] = schema.required ?? [];
      // Always include required props; include the rest too, for a full example.
      for (const [name, propSchema] of Object.entries(props)) out[name] = sampleValue(propSchema);
      for (const name of required) if (!(name in out)) out[name] = 'string';
      return out;
    }
    case 'string':
    default:
      return sampleString(schema);
  }
}

function sampleString(schema: any): string {
  switch (schema.format) {
    case 'email':     return 'user@example.com';
    case 'uuid':      return '00000000-0000-0000-0000-000000000000';
    case 'date':      return '2020-01-01';
    case 'date-time': return '2020-01-01T00:00:00Z';
    case 'uri':
    case 'url':       return 'https://example.com';
    case 'hostname':  return 'example.com';
    case 'ipv4':      return '127.0.0.1';
    default: {
      const min = schema.minLength ?? 0;
      let s = 'string';
      if (min > s.length) s = s.padEnd(min, 'x');
      if (schema.maxLength != null && s.length > schema.maxLength) s = s.slice(0, schema.maxLength);
      return s;
    }
  }
}

// ─── Parameters ───────────────────────────────────────────────────────────────

interface Param { name: string; in: string; required?: boolean; schema?: any }

function collectParams(spec: any, pathItem: any, op: any): Param[] {
  const raw = [...(pathItem?.parameters ?? []), ...(op?.parameters ?? [])].map(p => deref(spec, p));
  // Operation-level params override path-level ones with the same name+location.
  const byKey = new Map<string, Param>();
  for (const p of raw) if (p?.name && p?.in) byKey.set(`${p.in}:${p.name}`, p);
  return [...byKey.values()];
}

// ─── Generation ─────────────────────────────────────────────────────────────

function successCode(responses: any): number {
  const codes = Object.keys(responses ?? {}).filter(c => /^2\d\d$/.test(c)).map(Number).sort((a, b) => a - b);
  return codes[0] ?? 200;
}

function negativeCode(responses: any): number {
  const codes = Object.keys(responses ?? {}).filter(c => /^4\d\d$/.test(c)).map(Number).sort((a, b) => a - b);
  return codes[0] ?? 400;
}

function baseTest(method: string, path: string, op: any, params: Param[]): Omit<GeneratedTest, 'name' | 'category' | 'expectedStatus'> {
  const pathParams: Record<string, string | number | boolean> = {};
  for (const p of params.filter(p => p.in === 'path')) pathParams[p.name] = sampleValue(p.schema ?? {});
  const query = params.filter(p => p.in === 'query' && p.required).map(p => ({ key: p.name, value: String(sampleValue(p.schema ?? {})) }));
  const headers = params.filter(p => p.in === 'header' && p.required).map(p => ({ key: p.name, value: String(sampleValue(p.schema ?? {})) }));
  return { operationId: op?.operationId, method, path, pathParams, query, headers };
}

function requestBodySchema(spec: any, op: any): any | undefined {
  const rb = deref(spec, op?.requestBody);
  const schema = rb?.content?.['application/json']?.schema;
  return schema;
}

function generateForOperation(spec: any, method: string, path: string, pathItem: any, op: any, opts: Required<GenerateOptions>): GeneratedTest[] {
  const tests: GeneratedTest[] = [];
  const params = collectParams(spec, pathItem, op);
  const responses = op?.responses ?? {};
  const okCode = successCode(responses);
  const badCode = negativeCode(responses);
  const bodySchema = requestBodySchema(spec, op);
  const validBody = bodySchema ? sampleValue(bodySchema) : undefined;
  const base = baseTest(method, path, op, params);
  const label = `${method} ${path}`;

  // Happy path.
  tests.push({
    ...base,
    name: `${label} - happy path`,
    category: 'happy',
    body: validBody !== undefined ? JSON.stringify(validBody, null, 2) : undefined,
    expectedStatus: okCode,
    responseSchema: jsonSchemaFor(spec, responses, String(okCode)) ? JSON.stringify(jsonSchemaFor(spec, responses, String(okCode)), null, 2) : undefined,
  });

  const props: Record<string, any> = bodySchema?.properties ?? {};
  const required: string[] = bodySchema?.required ?? [];

  // Negative: drop each required field, and send a wrong type for one field.
  if (opts.includeNegative && validBody && typeof validBody === 'object') {
    let n = 0;
    for (const field of required) {
      if (n >= opts.maxNegativePerOp) break;
      const mutated = { ...validBody };
      delete mutated[field];
      tests.push({ ...base, name: `${label} - missing ${field}`, category: 'negative', body: JSON.stringify(mutated, null, 2), expectedStatus: badCode });
      n++;
    }
    for (const [field, ps] of Object.entries(props)) {
      if (n >= opts.maxNegativePerOp) break;
      const t = Array.isArray(ps.type) ? ps.type[0] : ps.type;
      if (t !== 'string' && t !== 'integer' && t !== 'number' && t !== 'boolean') continue;
      const wrong = t === 'string' ? 12345 : 'not-a-valid-value';
      tests.push({ ...base, name: `${label} - ${field} wrong type`, category: 'negative', body: JSON.stringify({ ...validBody, [field]: wrong }, null, 2), expectedStatus: badCode });
      n++;
    }
  }

  // Boundary: for numeric min/max and string length limits, send a just-outside
  // value and expect a validation error.
  if (opts.includeBoundary && validBody && typeof validBody === 'object') {
    let n = 0;
    for (const [field, ps] of Object.entries(props)) {
      if (n >= opts.maxBoundaryPerOp) break;
      const t = Array.isArray(ps.type) ? ps.type[0] : ps.type;
      if ((t === 'integer' || t === 'number') && ps.minimum != null) {
        tests.push({ ...base, name: `${label} - ${field} below minimum`, category: 'boundary', body: JSON.stringify({ ...validBody, [field]: ps.minimum - 1 }, null, 2), expectedStatus: badCode });
        n++;
      } else if ((t === 'integer' || t === 'number') && ps.maximum != null) {
        tests.push({ ...base, name: `${label} - ${field} above maximum`, category: 'boundary', body: JSON.stringify({ ...validBody, [field]: ps.maximum + 1 }, null, 2), expectedStatus: badCode });
        n++;
      } else if (t === 'string' && ps.maxLength != null) {
        tests.push({ ...base, name: `${label} - ${field} too long`, category: 'boundary', body: JSON.stringify({ ...validBody, [field]: 'x'.repeat(ps.maxLength + 1) }, null, 2), expectedStatus: badCode });
        n++;
      }
    }
  }

  return tests;
}

export function generateTests(spec: unknown, options: GenerateOptions = {}): GeneratedTest[] {
  const opts: Required<GenerateOptions> = {
    only: options.only ?? new Set(),
    includeNegative: options.includeNegative ?? true,
    includeBoundary: options.includeBoundary ?? true,
    maxNegativePerOp: options.maxNegativePerOp ?? 4,
    maxBoundaryPerOp: options.maxBoundaryPerOp ?? 4,
  };
  const doc = (spec ?? {}) as any;
  const out: GeneratedTest[] = [];
  for (const [path, item] of Object.entries<any>(doc.paths ?? {})) {
    if (!item || typeof item !== 'object') continue;
    for (const [method, op] of Object.entries<any>(item)) {
      if (!HTTP_METHODS.includes(method.toLowerCase())) continue;
      if (!op || typeof op !== 'object') continue;
      if (opts.only.size && !opts.only.has(`${method.toUpperCase()} ${path}`)) continue;
      out.push(...generateForOperation(doc, method.toUpperCase(), path, item, op, opts));
    }
  }
  return out;
}

// ─── URL helpers (for building an ApiRequest) ─────────────────────────────────

/** Fill a path template with sample params and append required query params,
 *  under a {{baseUrl}} prefix so it resolves against the active environment. */
export function testUrl(test: GeneratedTest, baseVar = '{{baseUrl}}'): string {
  let path = test.path;
  for (const [name, value] of Object.entries(test.pathParams)) {
    path = path.replace(new RegExp(`\\{${name}\\}`, 'g'), encodeURIComponent(String(value)));
  }
  const qs = test.query.filter(q => q.key).map(q => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`).join('&');
  return `${baseVar}${path}${qs ? `?${qs}` : ''}`;
}

// Request types (type-only, so this module stays value-import free).
import type { ApiRequest, HttpMethod, KeyValuePair } from './types';

/** Turn a GeneratedTest into a full ApiRequest. The caller supplies the id (a
 *  uuid) so this stays deterministic and dependency-free. The expected status
 *  and response schema become the request's contract, so it is a real test. */
export function toApiRequest(test: GeneratedTest, id: string): ApiRequest {
  const headers: KeyValuePair[] = test.headers.map(h => ({ key: h.key, value: h.value, enabled: true }));
  return {
    id,
    name: test.name,
    method: test.method as HttpMethod,
    url: testUrl(test),
    headers,
    params: [],
    auth: { type: 'none' },
    body: test.body !== undefined ? { mode: 'json', json: test.body } : { mode: 'none' },
    contract: {
      statusCode: test.expectedStatus,
      ...(test.responseSchema ? { bodySchema: test.responseSchema } : {}),
    },
    meta: { tags: [test.category] },
  };
}
