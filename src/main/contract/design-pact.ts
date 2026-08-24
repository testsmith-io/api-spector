// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Compile a design-first ConsumerContract into the artifacts the rest of the
// system already understands:
//   • a Pact v3 document  → publish to API Spector Cloud, verify on the provider
//   • a MockServer        → the consumer develops against the designed responses
//
// Response bodies are matched by TYPE, not value, by default (the CDCT best
// practice) so a timestamp or generated id doesn't make the contract brittle.

import type { ConsumerContract, DesignInteraction, KeyValuePair } from '../../shared/types';
import { V4_SYNC_HTTP, interactionKey } from './pact-format';

// `designContractToMock` is pure and shared with the renderer's "Create mock"
// action; re-exported here so existing import sites (and tests) keep working.
export { designContractToMock } from '../../shared/design-mock';

type Rule = { match: string; min?: number }
type BodyRules = Record<string, { matchers: Rule[] }>

function kvToHeaders(kv?: KeyValuePair[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const p of kv ?? []) {
    if (p.enabled === false || !p.key) continue;
    out[p.key] = p.value;
  }
  return Object.keys(out).length ? out : undefined;
}

function kvToQuery(kv?: KeyValuePair[]): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {};
  for (const p of kv ?? []) {
    if (p.enabled === false || !p.key) continue;
    (out[p.key] ??= []).push(p.value);
  }
  return Object.keys(out).length ? out : undefined;
}

function parseJson(s?: string): unknown {
  if (!s || !s.trim()) return undefined;
  try { return JSON.parse(s); } catch { return undefined; }
}

/** Walk an example body and emit a Pact matchingRules.body map that matches
 *  every leaf by type, arrays by type + min length. Objects need no rule of
 *  their own — matching their members is enough. */
export function typeMatchingRules(body: unknown): BodyRules {
  const rules: BodyRules = {};
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      rules[path] = { matchers: [{ match: 'type', min: node.length > 0 ? 1 : 0 }] };
      if (node.length > 0) walk(node[0], `${path}[*]`);
    } else if (node !== null && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    } else {
      rules[path] = { matchers: [{ match: 'type' }] };
    }
  };
  walk(body, '$');
  return rules;
}

// ─── Type-shape shorthand ─────────────────────────────────────────────────────
//
// A design-first response body may be written as a *type shape* rather than a
// concrete JSON example - the way you'd sketch a response before the API exists:
//
//   [{ id: string, name: string, slug: string }]
//   { count: integer, price: number, active: boolean, tags: [ string ] }
//   [{ id, name }]                    // bare fields default to string
//
// It compiles to a representative example body plus Pact matchingRules that match
// each leaf by type - so the *format* becomes part of the pact and is verified,
// without inventing example values.

type Shape =
  | { kind: 'scalar'; type: 'string' | 'number' | 'integer' | 'boolean' | 'null' }
  | { kind: 'object'; fields: { name: string; shape: Shape }[] }
  | { kind: 'array'; item: Shape }

function scalarFromName(name: string): Shape {
  switch (name.toLowerCase()) {
    case 'integer': case 'int': return { kind: 'scalar', type: 'integer' };
    case 'number': case 'float': case 'double': case 'decimal': return { kind: 'scalar', type: 'number' };
    case 'boolean': case 'bool': return { kind: 'scalar', type: 'boolean' };
    case 'null': return { kind: 'scalar', type: 'null' };
    // string / str / text / any unknown type name → string
    default: return { kind: 'scalar', type: 'string' };
  }
}

/** Tokenize a shape string into structural symbols and identifiers, or return
 *  undefined on an unexpected character (so the caller can reject it). */
function tokenizeShape(src: string): string[] | undefined {
  const tokens: string[] = [];
  const re = /\s*([{}[\]:,]|[A-Za-z0-9_$-]+|"[^"]*")\s*/y;
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m || m.index !== i) return undefined;
    tokens.push(m[1].startsWith('"') ? m[1].slice(1, -1) : m[1]);
    i = re.lastIndex;
  }
  return tokens;
}

/** Parse a type-shape shorthand into a Shape, or undefined if it isn't one. */
export function parseShape(src?: string): Shape | undefined {
  if (!src || !src.trim()) return undefined;
  const tokens = tokenizeShape(src);
  if (!tokens || tokens.length === 0) return undefined;

  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const structural = new Set(['{', '}', '[', ']', ':', ',']);

  const parseValue = (): Shape | undefined => {
    const tok = peek();
    if (tok === '{') return parseObject();
    if (tok === '[') return parseArray();
    if (tok === undefined || structural.has(tok)) return undefined;
    pos++;
    return scalarFromName(tok);
  };

  const parseObject = (): Shape | undefined => {
    pos++; // consume {
    const fields: { name: string; shape: Shape }[] = [];
    while (peek() !== undefined && peek() !== '}') {
      const name = peek()!;
      if (structural.has(name)) return undefined; // expected a field name
      pos++;
      let shape: Shape;
      if (peek() === ':') {
        pos++;
        const s = parseValue();
        if (!s) return undefined;
        shape = s;
      } else {
        shape = { kind: 'scalar', type: 'string' }; // bare field
      }
      fields.push({ name, shape });
      if (peek() === ',') pos++;
    }
    if (peek() !== '}') return undefined;
    pos++; // consume }
    return { kind: 'object', fields };
  };

  const parseArray = (): Shape | undefined => {
    pos++; // consume [
    let item: Shape;
    if (peek() === ']') {
      item = { kind: 'scalar', type: 'string' };
    } else {
      const s = parseValue();
      if (!s) return undefined;
      item = s;
    }
    if (peek() !== ']') return undefined;
    pos++; // consume ]
    return { kind: 'array', item };
  };

  const shape = parseValue();
  if (!shape || pos !== tokens.length) return undefined; // trailing junk
  return shape;
}

/** Compile a Shape to an example body + type-matching rules. */
function compileShape(shape: Shape): { body: unknown; rules: BodyRules } {
  const rules: BodyRules = {};
  const build = (s: Shape, path: string): unknown => {
    if (s.kind === 'array') {
      rules[path] = { matchers: [{ match: 'type', min: 1 }] };
      return [build(s.item, `${path}[*]`)];
    }
    if (s.kind === 'object') {
      const obj: Record<string, unknown> = {};
      for (const f of s.fields) obj[f.name] = build(f.shape, `${path}.${f.name}`);
      return obj;
    }
    switch (s.type) {
      case 'integer': rules[path] = { matchers: [{ match: 'integer' }] }; return 0;
      case 'number': rules[path] = { matchers: [{ match: 'number' }] }; return 0;
      case 'boolean': rules[path] = { matchers: [{ match: 'boolean' }] }; return false;
      case 'null': rules[path] = { matchers: [{ match: 'null' }] }; return null;
      // string uses the generic `type` matcher: ruleToMatcher has no `string`
      // case, so `match: "string"` would fall through to an exact match.
      default: rules[path] = { matchers: [{ match: 'type' }] }; return 'string';
    }
  };
  const body = build(shape, '$');
  return { body, rules };
}

/**
 * Compile a design-first response body into a pact body + matchingRules.
 * Valid JSON is treated as a concrete example (matched by type when loose);
 * otherwise it is parsed as a type-shape shorthand. Returns undefined only when
 * the text is neither valid JSON nor a parseable shape.
 */
export function compileResponseBody(text?: string, loose = true): { body: unknown; rules?: BodyRules } | undefined {
  if (!text || !text.trim()) return undefined;

  try {
    const json = JSON.parse(text);
    const rules = loose ? typeMatchingRules(json) : {};
    return { body: json, rules: Object.keys(rules).length ? rules : undefined };
  } catch {
    // not JSON — fall through to the type-shape shorthand
  }

  const shape = parseShape(text);
  if (shape) {
    const { body, rules } = compileShape(shape);
    return { body, rules: Object.keys(rules).length ? rules : undefined };
  }

  return undefined;
}

function interactionToPact(it: DesignInteraction): Record<string, unknown> {
  const request: Record<string, unknown> = {
    method: (it.request.method || 'GET').toUpperCase(),
    path: it.request.path || '/',
  };
  const query = kvToQuery(it.request.query);
  if (query) request['query'] = query;
  const reqHeaders = kvToHeaders(it.request.headers);
  if (reqHeaders) request['headers'] = reqHeaders;
  const reqBody = parseJson(it.request.body);
  if (reqBody !== undefined) request['body'] = reqBody;

  const response: Record<string, unknown> = { status: it.response.status };
  const respHeaders = kvToHeaders(it.response.headers);
  if (respHeaders) response['headers'] = respHeaders;
  const respBody = compileResponseBody(it.response.body, it.looseMatch !== false);
  if (respBody) {
    response['body'] = respBody.body;
    if (respBody.rules) response['matchingRules'] = { body: respBody.rules };
  }

  const interaction: Record<string, unknown> = {
    type: V4_SYNC_HTTP,
    key: interactionKey(`${(it.request.method || 'GET').toUpperCase()}|${it.request.path || '/'}|${it.response.status}|${it.description ?? ''}`),
    description: it.description || `${it.request.method} ${it.request.path}`,
    request,
    response,
  };
  if (it.providerState?.trim()) interaction['providerStates'] = [{ name: it.providerState.trim() }];
  return interaction;
}

/** Compile the contract to a Pact v3 document ready for `publishPact`. */
export function designContractToPact(cc: ConsumerContract): object {
  return {
    consumer: { name: cc.consumer },
    provider: { name: cc.provider },
    interactions: cc.interactions.map(interactionToPact),
    metadata: {
      pactSpecification: { version: '4.0' },
      client: { name: 'api-spector', designFirst: true },
    },
  };
}

