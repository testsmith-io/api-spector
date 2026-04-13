// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { esc } from './format';

export type JsonPath = (string | number)[]

/**
 * Render a JsonPath as a JavaScript accessor expression rooted at `json`.
 *
 *   ['users', 0, 'name']    → json.users[0].name
 *   ['my key', 'value']     → json["my key"].value
 */
export function jsonAccessor(path: JsonPath): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === 'number') return `${acc}[${key}]`;
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? `${acc}.${key}` : `${acc}["${esc(key)}"]`;
  }, 'json');
}

/** Render a JsonPath as a human-readable label, as used in test names. */
export function jsonPathLabel(path: JsonPath): string {
  if (path.length === 0) return '$';
  return path.map(k => (typeof k === 'number' ? `[${k}]` : k)).join('.');
}

/** Walk a JSON object/array tree following `path`, returning undefined on miss. */
export function getAtPath(root: unknown, path: JsonPath): unknown {
  let cur = root;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

/**
 * Build a JSONPath filter expression for "the entry in this array whose
 * `filterKey` equals `filterValue`, then drill down to the leaf field of
 * the original `path`."
 *
 * Returns '' if `path` doesn't traverse an array.
 */
export function toJsonPathExpr(path: JsonPath, filterKey: string, filterValue: string): string {
  // Find last numeric index in path — that's the array boundary
  let arrayIdx = -1;
  for (let i = path.length - 1; i >= 0; i--) {
    if (typeof path[i] === 'number') { arrayIdx = i; break; }
  }
  if (arrayIdx < 0) return '';

  const prefix    = path.slice(0, arrayIdx).join('.');
  const arrayPart = prefix ? '$.' + prefix : '$';                    // e.g. $.data or just $
  const leafPart  = path.slice(arrayIdx + 1).join('.');               // e.g. price
  const filterVal = isNaN(Number(filterValue))
    ? `"${filterValue.replace(/"/g, '\\"')}"`
    : filterValue;

  return leafPart
    ? `${arrayPart}[?(@.${filterKey}==${filterVal})].${leafPart}`
    : `${arrayPart}[?(@.${filterKey}==${filterVal})]`;
}

/**
 * Pick a sensible variable name from a JsonPath: the last string segment, or
 * 'extracted_value' if every segment is numeric.
 */
export function varNameFromPath(path: JsonPath): string {
  const stringSegments = path.filter((k): k is string => typeof k === 'string');
  return stringSegments[stringSegments.length - 1] ?? 'extracted_value';
}
