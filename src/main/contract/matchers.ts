// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// ─── Flexible matchers ────────────────────────────────────────────────────────
//
// Pact-style matchers layered on top of the existing ajv / JSON-Schema flow.
// Instead of authoring a JSON Schema by hand, a contract can carry an
// "example with matchers": a normal JSON document where any node may be wrapped
// in a matcher marker. We compile that example into a draft-07 JSON Schema so
// the rest of the pipeline (validateConsumerResponse) stays unchanged.
//
// Default semantics match Pact: a plain value means "exact match"; wrap it in a
// matcher to relax that to type / regex / each-like etc.
//
//   like(x)            type matches x (recursively), values free
//   eachLike(x, min)   array whose every item type-matches x
//   regex(re, eg)      string matching the regex
//   integer/decimal    numeric type matching
//   boolean/string     primitive type matching
//   datetime/date/time string with the corresponding format

export type JSONSchema = Record<string, unknown>

/** Marker key that flags an object as a matcher node rather than data. */
export const MATCH_KEY = '__match' as const;

export type MatcherKind =
  | 'type'
  | 'integer'
  | 'decimal'
  | 'number'
  | 'boolean'
  | 'string'
  | 'null'
  | 'regex'
  | 'datetime'
  | 'timestamp'
  | 'date'
  | 'time'
  | 'eachLike'

export interface MatcherNode {
  [MATCH_KEY]: MatcherKind
  value?: unknown
  regex?: string
  format?: string
  min?: number
}

function isMatcher(node: unknown): node is MatcherNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    !Array.isArray(node) &&
    typeof (node as Record<string, unknown>)[MATCH_KEY] === 'string'
  );
}

// ─── Ergonomic constructors (used by tests and the Pact importer) ─────────────

export const like      = (value: unknown): MatcherNode => ({ [MATCH_KEY]: 'type', value });
export const eachLike  = (value: unknown, min = 1): MatcherNode => ({ [MATCH_KEY]: 'eachLike', value, min });
export const regex     = (re: string, example = ''): MatcherNode => ({ [MATCH_KEY]: 'regex', regex: re, value: example });
export const integer   = (value = 0): MatcherNode => ({ [MATCH_KEY]: 'integer', value });
export const decimal   = (value = 0): MatcherNode => ({ [MATCH_KEY]: 'decimal', value });
export const boolean   = (value = false): MatcherNode => ({ [MATCH_KEY]: 'boolean', value });
export const string    = (value = ''): MatcherNode => ({ [MATCH_KEY]: 'string', value });
export const datetime  = (value = '', format = 'iso'): MatcherNode => ({ [MATCH_KEY]: 'datetime', value, format });

// ─── Compilation ──────────────────────────────────────────────────────────────

function compileMatcher(m: MatcherNode): JSONSchema {
  switch (m[MATCH_KEY]) {
    case 'type':      return compileMatcherExample(m.value, false);
    case 'integer':   return { type: 'integer' };
    case 'decimal':
    case 'number':    return { type: 'number' };
    case 'boolean':   return { type: 'boolean' };
    case 'string':    return { type: 'string' };
    case 'null':      return { type: 'null' };
    case 'regex':     return { type: 'string', pattern: m.regex ?? '.*' };
    case 'datetime':
    case 'timestamp': return { type: 'string', format: 'date-time' };
    case 'date':      return { type: 'string', format: 'date' };
    case 'time':      return { type: 'string', format: 'time' };
    case 'eachLike': {
      const schema: JSONSchema = { type: 'array', items: compileMatcherExample(m.value, false) };
      schema['minItems'] = typeof m.min === 'number' ? m.min : 1;
      return schema;
    }
    default:          return {};
  }
}

/**
 * Compile an "example with matchers" into a draft-07 JSON Schema.
 *
 * @param node   The example document (may contain matcher markers anywhere).
 * @param exact  When true (the default, top level), plain primitives compile to
 *               `const` (exact match). When false (inside a `type`/`eachLike`
 *               matcher) plain primitives compile to a type check only.
 */
export function compileMatcherExample(node: unknown, exact = true): JSONSchema {
  if (isMatcher(node)) return compileMatcher(node);

  if (node === null) return { type: 'null' };

  const t = typeof node;
  if (t === 'boolean') return exact ? { const: node } : { type: 'boolean' };
  if (t === 'number')  return exact ? { const: node } : (Number.isInteger(node) ? { type: 'integer' } : { type: 'number' });
  if (t === 'string')  return exact ? { const: node } : { type: 'string' };

  if (Array.isArray(node)) {
    if (node.length === 0) return { type: 'array' };
    const schema: JSONSchema = { type: 'array', items: node.map(n => compileMatcherExample(n, exact)) };
    if (exact) schema['minItems'] = node.length;
    return schema;
  }

  if (t === 'object') {
    const obj = node as Record<string, unknown>;
    const properties: Record<string, JSONSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      properties[key] = compileMatcherExample(value, exact);
      required.push(key);
    }
    return { type: 'object', properties, required, additionalProperties: true };
  }

  return {};
}

/** Parse a JSON "example with matchers" string and compile it to a schema.
 *  Returns null when the string is not valid JSON. */
export function compileMatcherJson(json: string): JSONSchema | null {
  try {
    return compileMatcherExample(JSON.parse(json));
  } catch {
    return null;
  }
}
