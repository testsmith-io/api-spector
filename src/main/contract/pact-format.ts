// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { randomUUID } from 'crypto';
import type { ApiRequest, Collection, ContractExpectation, HttpMethod, KeyValuePair } from '../../shared/types';
import { MATCH_KEY, type MatcherNode } from './matchers';

// ─── Pact file interoperability (v2 / v3 / v4) ────────────────────────────────
//
// Lets API Spector interoperate with the wider Pact ecosystem: import a pact
// file emitted by any Pact consumer library into runnable requests + contracts,
// and export our contracts back out as a standard pact file. The bridge between
// the two worlds is matchingRules <-> our matcher example format (matchers.ts).

export interface PactImportResult {
  consumer: string
  provider: string
  specVersion: string
  requests: ApiRequest[]
}

interface RuleMatcher {
  match?: string
  regex?: string
  min?: number
  format?: string
}

// ─── JSONPath (Pact subset) ───────────────────────────────────────────────────
// Supports: $, $.a.b, $.a[0].b, $.a[*].b  — enough for real-world pact bodies.

type PathToken = { key: string } | { index: number | '*' }

function parsePath(path: string): PathToken[] {
  const tokens: PathToken[] = [];
  const re = /\.([^.[\]]+)|\['([^']*)'\]|\[(\d+|\*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) tokens.push({ key: m[1] });
    else if (m[2] !== undefined) tokens.push({ key: m[2] });
    else if (m[3] !== undefined) tokens.push({ index: m[3] === '*' ? '*' : Number(m[3]) });
  }
  return tokens;
}

// ─── matchingRules → matcher example ──────────────────────────────────────────

function ruleToMatcher(value: unknown, rule: RuleMatcher): unknown {
  switch (rule.match) {
    case 'type':
      if (Array.isArray(value)) {
        return { [MATCH_KEY]: 'eachLike', value: value[0] ?? {}, min: rule.min ?? 1 } satisfies MatcherNode;
      }
      return { [MATCH_KEY]: 'type', value } satisfies MatcherNode;
    case 'regex':    return { [MATCH_KEY]: 'regex', regex: rule.regex ?? '.*', value } satisfies MatcherNode;
    case 'integer':  return { [MATCH_KEY]: 'integer', value } satisfies MatcherNode;
    case 'number':
    case 'decimal':  return { [MATCH_KEY]: 'decimal', value } satisfies MatcherNode;
    case 'boolean':  return { [MATCH_KEY]: 'boolean', value } satisfies MatcherNode;
    case 'null':     return { [MATCH_KEY]: 'null', value: null } satisfies MatcherNode;
    case 'datetime':
    case 'timestamp':return { [MATCH_KEY]: 'datetime', value, format: rule.format } satisfies MatcherNode;
    case 'date':     return { [MATCH_KEY]: 'date', value } satisfies MatcherNode;
    case 'time':     return { [MATCH_KEY]: 'time', value } satisfies MatcherNode;
    default:         return value; // equality / include / unsupported → exact
  }
}

function applyAtPath(root: unknown, tokens: PathToken[], transform: (v: unknown) => unknown): unknown {
  if (tokens.length === 0) return transform(root);
  const [head, ...rest] = tokens;

  if ('index' in head) {
    if (!Array.isArray(root)) return root;
    if (head.index === '*') {
      return root.map(el => applyAtPath(el, rest, transform));
    }
    const arr = [...root];
    if (head.index < arr.length) arr[head.index] = applyAtPath(arr[head.index], rest, transform);
    return arr;
  }

  if (typeof root !== 'object' || root === null || Array.isArray(root)) return root;
  const obj = { ...(root as Record<string, unknown>) };
  if (head.key in obj) obj[head.key] = applyAtPath(obj[head.key], rest, transform);
  return obj;
}

/** Inject matcher markers into a pact body using its matchingRules.body map. */
export function bodyWithMatchers(body: unknown, matchingRules: Record<string, unknown> | undefined): unknown {
  const bodyRules = (matchingRules?.['body'] ?? matchingRules?.['content']) as Record<string, { matchers?: RuleMatcher[] }> | undefined;
  if (!bodyRules || body === undefined) return body;

  // Apply deepest paths first so eachLike wrapping captures already-marked items.
  const entries = Object.entries(bodyRules).sort((a, b) => parsePath(b[0]).length - parsePath(a[0]).length);

  let result: unknown = body;
  for (const [path, def] of entries) {
    const rule = def?.matchers?.[0];
    if (!rule) continue;
    const tokens = parsePath(path);
    result = applyAtPath(result, tokens, v => ruleToMatcher(v, rule));
  }
  return result;
}

// ─── Import ───────────────────────────────────────────────────────────────────

function providerStatesOf(interaction: Record<string, unknown>): string[] {
  // v3+: providerStates: [{ name, params }]; v2: providerState: "string"
  const v3 = interaction['providerStates'] as { name?: string }[] | undefined;
  if (Array.isArray(v3)) return v3.map(s => s?.name ?? '').filter(Boolean);
  const v2 = interaction['providerState'] ?? interaction['provider_state'];
  return typeof v2 === 'string' && v2 ? [v2] : [];
}

function queryToParams(query: unknown): KeyValuePair[] {
  const params: KeyValuePair[] = [];
  if (!query) return params;
  if (typeof query === 'string') {
    // v2: "a=1&b=2"
    for (const pair of query.split('&')) {
      const [k, v = ''] = pair.split('=');
      if (k) params.push({ key: decodeURIComponent(k), value: decodeURIComponent(v), enabled: true });
    }
  } else if (typeof query === 'object') {
    // v3: { a: ["1"], b: ["2"] }
    for (const [k, vals] of Object.entries(query as Record<string, unknown>)) {
      const list = Array.isArray(vals) ? vals : [vals];
      for (const v of list) params.push({ key: k, value: String(v ?? ''), enabled: true });
    }
  }
  return params;
}

function headerEntries(headers: unknown): { key: string; value: string }[] {
  if (!headers || typeof headers !== 'object') return [];
  return Object.entries(headers as Record<string, unknown>).map(([key, value]) => ({
    key,
    value: Array.isArray(value) ? value.join(', ') : String(value ?? ''),
  }));
}

function headersToKv(headers: unknown): KeyValuePair[] {
  return headerEntries(headers).map(h => ({ ...h, enabled: true }));
}

function headersToContract(headers: unknown): ContractExpectation['headers'] {
  return headerEntries(headers).map(h => ({ ...h, required: true }));
}

function importInteraction(interaction: Record<string, unknown>): ApiRequest {
  const request  = (interaction['request']  ?? {}) as Record<string, unknown>;
  const response = (interaction['response'] ?? {}) as Record<string, unknown>;

  const method = String(request['method'] ?? 'GET').toUpperCase() as HttpMethod;
  const path   = String(request['path'] ?? '/');

  const reqBody = request['body'];
  const body: ApiRequest['body'] = reqBody === undefined
    ? { mode: 'none' }
    : typeof reqBody === 'string'
      ? { mode: 'raw', raw: reqBody }
      : { mode: 'json', json: JSON.stringify(reqBody, null, 2) };

  // Build the consumer expectation from the response side.
  const contract: ContractExpectation = {};
  if (typeof response['status'] === 'number') contract.statusCode = response['status'] as number;
  const respHeaders = headersToContract(response['headers']);
  if (respHeaders?.length) contract.headers = respHeaders;
  if (response['body'] !== undefined) {
    const example = bodyWithMatchers(response['body'], response['matchingRules'] as Record<string, unknown> | undefined);
    contract.bodyMatcher = JSON.stringify(example, null, 2);
  }
  const states = providerStatesOf(interaction);
  if (states.length) contract.providerStates = states;

  return {
    id:      randomUUID(),
    name:    String(interaction['description'] ?? `${method} ${path}`),
    method,
    url:     `{{baseUrl}}${path}`,
    headers: headersToKv(request['headers']),
    params:  queryToParams(request['query']),
    auth:    { type: 'none' },
    body,
    contract,
    meta:    { tags: ['pact'] },
  };
}

/** Parse a pact JSON document into runnable requests with contracts. */
export function importPact(json: string | object): PactImportResult {
  const pact = (typeof json === 'string' ? JSON.parse(json) : json) as Record<string, unknown>;
  const consumer = (pact['consumer'] as { name?: string } | undefined)?.name ?? 'consumer';
  const provider = (pact['provider'] as { name?: string } | undefined)?.name ?? 'provider';
  const metadata = pact['metadata'] as Record<string, unknown> | undefined;
  const specVersion = String(
    (metadata?.['pactSpecification'] as { version?: string } | undefined)?.version ??
    (metadata?.['pact-specification'] as { version?: string } | undefined)?.version ??
    '3.0.0',
  );

  // v4 uses "interactions" too, but each may carry a type; we only map HTTP ones.
  const interactions = (pact['interactions'] as Record<string, unknown>[] | undefined) ?? [];
  const httpInteractions = interactions.filter(i => {
    const type = i['type'];
    return type === undefined || type === 'Synchronous/HTTP' || type === 'HTTP';
  });

  return {
    consumer,
    provider,
    specVersion,
    requests: httpInteractions.map(importInteraction),
  };
}

/** Wrap an import result into a ready-to-save Collection. */
export function pactToCollection(result: PactImportResult): Collection {
  const requests: Record<string, ApiRequest> = {};
  for (const r of result.requests) requests[r.id] = r;
  return {
    version: '1.0',
    id: randomUUID(),
    name: `${result.consumer} → ${result.provider}`,
    description: `Imported from Pact (spec ${result.specVersion})`,
    rootFolder: {
      id: randomUUID(),
      name: 'root',
      folders: [],
      requestIds: result.requests.map(r => r.id),
    },
    requests,
    collectionVariables: { baseUrl: '' },
  };
}

// ─── Export ───────────────────────────────────────────────────────────────────

function isMatcher(node: unknown): node is MatcherNode {
  return typeof node === 'object' && node !== null && !Array.isArray(node) && typeof (node as Record<string, unknown>)[MATCH_KEY] === 'string';
}

/** Walk a matcher example, producing the plain example body plus the pact
 *  matchingRules.body map (path -> matchers). */
export function exampleToPactBody(node: unknown): { body: unknown; rules: Record<string, { matchers: RuleMatcher[] }> } {
  const rules: Record<string, { matchers: RuleMatcher[] }> = {};

  function walk(n: unknown, path: string): unknown {
    if (isMatcher(n)) {
      const kind = n[MATCH_KEY];
      switch (kind) {
        case 'type':
          rules[path] = { matchers: [{ match: 'type' }] };
          return walk(n.value, path);
        case 'eachLike': {
          rules[path] = { matchers: [{ match: 'type', min: n.min ?? 1 }] };
          return [walk(n.value, `${path}[*]`)];
        }
        case 'regex':
          rules[path] = { matchers: [{ match: 'regex', regex: n.regex ?? '.*' }] };
          return n.value ?? '';
        case 'integer':
          rules[path] = { matchers: [{ match: 'integer' }] };
          return n.value ?? 0;
        case 'decimal':
        case 'number':
          rules[path] = { matchers: [{ match: 'decimal' }] };
          return n.value ?? 0;
        case 'boolean':
          rules[path] = { matchers: [{ match: 'boolean' }] };
          return n.value ?? false;
        case 'string':
          rules[path] = { matchers: [{ match: 'type' }] };
          return n.value ?? '';
        case 'null':
          rules[path] = { matchers: [{ match: 'null' }] };
          return null;
        case 'datetime':
        case 'timestamp':
          rules[path] = { matchers: [{ match: 'datetime', format: n.format }] };
          return n.value ?? '';
        case 'date':
          rules[path] = { matchers: [{ match: 'date' }] };
          return n.value ?? '';
        case 'time':
          rules[path] = { matchers: [{ match: 'time' }] };
          return n.value ?? '';
        default:
          return n.value;
      }
    }

    if (Array.isArray(n)) return n.map((el, i) => walk(el, `${path}[${i}]`));

    if (typeof n === 'object' && n !== null) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) out[k] = walk(v, `${path}.${k}`);
      return out;
    }

    return n;
  }

  const body = walk(node, '$');
  return { body, rules };
}

function kvToHeaders(kv: { key: string; value: string; enabled?: boolean }[] | undefined): Record<string, string> | undefined {
  if (!kv?.length) return undefined;
  const out: Record<string, string> = {};
  for (const h of kv) if (h.enabled !== false && h.key) out[h.key] = h.value;
  return Object.keys(out).length ? out : undefined;
}

/** Pact v4 interaction discriminator for synchronous HTTP. */
export const V4_SYNC_HTTP = 'Synchronous/HTTP';

/** A stable short key for a Pact v4 interaction: FNV-1a over its identity. */
export function interactionKey(identity: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < identity.length; i++) {
    h ^= identity.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Build a Pact v4 file from a set of requests carrying consumer contracts. */
export function exportPact(consumer: string, provider: string, requests: ApiRequest[]): object {
  const interactions = requests
    .filter(r => r.contract)
    .map(r => {
      const c = r.contract!;
      const path = r.url.replace(/^\{\{baseUrl\}\}/, '').replace(/^https?:\/\/[^/]+/, '') || '/';

      const query: Record<string, string[]> = {};
      for (const p of r.params ?? []) {
        if (p.enabled === false || !p.key) continue;
        (query[p.key] ??= []).push(p.value);
      }

      const response: Record<string, unknown> = {};
      if (c.statusCode !== undefined) response['status'] = c.statusCode;
      const respHeaders = kvToHeaders(c.headers);
      if (respHeaders) response['headers'] = respHeaders;
      if (c.bodyMatcher?.trim()) {
        try {
          const { body, rules } = exampleToPactBody(JSON.parse(c.bodyMatcher));
          response['body'] = body;
          if (Object.keys(rules).length) response['matchingRules'] = { body: rules };
        } catch { /* leave body off if matcher is invalid JSON */ }
      }

      const request: Record<string, unknown> = { method: r.method, path };
      if (Object.keys(query).length) request['query'] = query;
      const reqHeaders = kvToHeaders(r.headers);
      if (reqHeaders) request['headers'] = reqHeaders;
      if (r.body?.mode === 'json' && r.body.json) { try { request['body'] = JSON.parse(r.body.json); } catch { /* skip */ } }
      else if (r.body?.mode === 'raw' && r.body.raw) request['body'] = r.body.raw;

      const interaction: Record<string, unknown> = {
        type: V4_SYNC_HTTP,
        key: interactionKey(`${r.method}|${path}|${c.statusCode ?? ''}|${r.name}`),
        description: r.name,
        request,
        response,
      };
      if (c.providerStates?.length) interaction['providerStates'] = c.providerStates.map(name => ({ name }));
      return interaction;
    });

  return {
    consumer: { name: consumer },
    provider: { name: provider },
    interactions,
    metadata: {
      pactSpecification: { version: '4.0' },
      client: { name: 'api-spector' },
    },
  };
}
