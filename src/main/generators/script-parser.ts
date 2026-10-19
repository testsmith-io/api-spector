// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

/**
 * Parse the user's post-request script to extract assertions and variable
 * extractions. These are then translated into the target framework's idiom
 * by each code generator.
 *
 * This is best-effort regex parsing — it covers the common patterns that the
 * app's tree-view "insert assertion" and "extract variable" buttons generate,
 * plus hand-written equivalents.
 */

export interface ParsedAssertion {
  name: string
  /** The accessor on the parsed JSON body (e.g. `json.users[0].name`). */
  accessor: string
  kind: 'equals' | 'exists' | 'type' | 'contains' | 'above' | 'status'
  expected?: string  // literal value, e.g. `"alice"` or `200`
}

/**
 * A `sp.jsonPath(json, '<query>')` query behind an extraction, with an optional
 * `[index]` element pick and `?? <fallback>` default. Jayway/`jsonpath-plus`
 * syntax, which translates faithfully to the JS targets (same engine), Karate,
 * and REST Assured (Jayway). See `src/main/script-runner.ts` `sp.jsonPath`.
 */
export interface JsonPathQuery {
  /** The JSONPath expression, e.g. `$.data[?(@.name=="Widget")].id`. */
  query: string
  /** Element index when the script picks one match (`matches[0]` → 0); null = whole result list. */
  index: number | null
  /** Default from a trailing `?? <value>` (the raw literal text), or null when absent. */
  fallback: string | null
}

export interface ParsedExtraction {
  /** Variable name being set. */
  varName: string
  /** The JS expression being stored (e.g. `json.user.token`). Empty when `jsonPath` is set. */
  accessor: string
  /** Which scope it targets. */
  target: 'variables' | 'environment' | 'globals'
  /** Set instead of `accessor` when the value comes from a `sp.jsonPath(...)` query. */
  jsonPath?: JsonPathQuery
}

export interface ParsedScript {
  assertions: ParsedAssertion[]
  extractions: ParsedExtraction[]
}

/**
 * Parse a post-request script and extract assertions + variable extractions.
 */
export function parsePostScript(script: string | undefined): ParsedScript {
  const assertions: ParsedAssertion[] = [];
  const extractions: ParsedExtraction[] = [];

  if (!script?.trim()) return { assertions, extractions };

  // ── Extract sp.test blocks ────────────────────────────────────────────────
  // Pattern: sp.test('name', function() { ... sp.expect(...).to.xxx ... })
  // The test name may contain escaped quotes, so we match more broadly.
  const testBlockRegex = /sp\.test\(\s*(['"])((?:(?!\1).|\\.)*)\1\s*,\s*(?:function\s*\(\)|\(\)\s*=>)\s*\{([\s\S]*?)\}\s*\)/g;
  let match;
  while ((match = testBlockRegex.exec(script))) {
    const name = match[2];
    const body = match[3];

    // sp.expect(expr).to.equal(value)
    const equalMatch = /sp\.expect\(([^)]+)\)\.to(?:\.be)?\.equal\(([^)]+)\)/.exec(body);
    if (equalMatch) {
      assertions.push({ name, accessor: equalMatch[1].trim(), kind: 'equals', expected: equalMatch[2].trim() });
      continue;
    }

    // sp.expect(expr).to.include(value) / .to.contain(value)
    const includeMatch = /sp\.expect\(([^)]+)\)\.to\.(?:include|contain)\(([^)]+)\)/.exec(body);
    if (includeMatch) {
      assertions.push({ name, accessor: includeMatch[1].trim(), kind: 'contains', expected: includeMatch[2].trim() });
      continue;
    }

    // sp.expect(expr).to.not.be.oneOf([null, undefined])  (exists check)
    const existsMatch = /sp\.expect\(([^)]+)\)\.to\.not\.be\.oneOf\(\[null,\s*undefined\]\)/.exec(body);
    if (existsMatch) {
      assertions.push({ name, accessor: existsMatch[1].trim(), kind: 'exists' });
      continue;
    }

    // sp.expect(expr).to.be.a("type")
    const typeMatch = /sp\.expect\(([^)]+)\)\.to\.be\.a\(\s*"([^"]+)"\s*\)/.exec(body);
    if (typeMatch) {
      assertions.push({ name, accessor: typeMatch[1].trim(), kind: 'type', expected: `"${typeMatch[2]}"` });
      continue;
    }

    // sp.expect(expr).to.be.above(n)
    const aboveMatch = /sp\.expect\(([^)]+)\)\.to\.be\.above\((\d+)\)/.exec(body);
    if (aboveMatch) {
      assertions.push({ name, accessor: aboveMatch[1].trim(), kind: 'above', expected: aboveMatch[2] });
      continue;
    }

    // Fallback: if nothing matched, still record it as a generic assertion
    assertions.push({ name, accessor: '', kind: 'status' });
  }

  // ── Status code assertions outside of sp.test ────────────────────────────
  // sp.response.to.have.status(200)
  const statusMatch = /sp\.response\.to\.have\.status\((\d+)\)/.exec(script);
  if (statusMatch) {
    assertions.push({ name: `status is ${statusMatch[1]}`, accessor: '', kind: 'status', expected: statusMatch[1] });
  }

  // ── Local JSONPath bindings ───────────────────────────────────────────────
  // const matches = sp.jsonPath(json, '$.data[?(@.name=="X")].id');
  const jsonPathLocals = new Map<string, string>();
  const localRegex = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*sp\.jsonPath\(\s*[^,]+,\s*(['"])((?:(?!\2).|\\.)*)\2\s*\)\s*;?/g;
  while ((match = localRegex.exec(script))) {
    jsonPathLocals.set(match[1], match[3]);
  }

  // ── Variable extractions ──────────────────────────────────────────────────
  // sp.variables.set("name", expr)  /  sp.environment.set("name", expr)  /  sp.globals.set("name", expr)
  const extractRegex = /sp\.(variables|environment|globals)\.set\(\s*"([^"]+)"\s*,\s*(.+)\s*\)\s*;/g;
  while ((match = extractRegex.exec(script))) {
    const target = match[1] as ParsedExtraction['target'];
    const varName = match[2];
    let accessor = match[3].trim();
    // Clean up common wrappers: String(...), JSON.stringify(...)
    const stringWrap = /^String\((.+)\)$/.exec(accessor);
    if (stringWrap) accessor = stringWrap[1];

    // A JSONPath query (local binding or inline sp.jsonPath(...)) translates to
    // each target's JSONPath idiom, so keep it even though it is not a plain path.
    const jsonPath = parseJsonPathAccessor(accessor, jsonPathLocals);
    if (jsonPath) {
      extractions.push({ varName, accessor: '', target, jsonPath });
    } else {
      extractions.push({ varName, accessor, target });
    }
  }

  // Drop anything whose accessor is not a plain JSON path (and not a JSONPath
  // query). Scripts can reference unresolvable locals, JS operators (`?? ''`),
  // function calls, etc.; those would emit code that throws at runtime (e.g.
  // `json.matches[0]` when `matches` was a local). Keeping only translatable
  // reads means the request still runs with the checks we can map.
  return {
    assertions: assertions.filter(a => a.kind === 'status' || isSimpleAccessor(a.accessor)),
    extractions: extractions.filter(e => e.jsonPath || isSimpleAccessor(e.accessor)),
  };
}

/**
 * Recognize an extraction value that is a `sp.jsonPath(...)` result: a local
 * bound to one earlier, or an inline call, optionally with an `[index]` pick and
 * a trailing `?? <fallback>`. Returns null when the accessor is not such a query.
 *
 *   matches[0] ?? ''                       (local `matches` = sp.jsonPath(...))
 *   matches                                 (whole result list)
 *   sp.jsonPath(json, '$.a[*].id')[0]       (inline)
 */
function parseJsonPathAccessor(accessor: string, locals: Map<string, string>): JsonPathQuery | null {
  let core = accessor.trim();

  // Trailing `?? <fallback>` default.
  let fallback: string | null = null;
  const fbMatch = /\?\?\s*(.+)$/.exec(core);
  if (fbMatch) {
    fallback = fbMatch[1].trim().replace(/^(['"])(.*)\1$/, '$2');
    core = core.slice(0, fbMatch.index).trim();
  }

  // Trailing `[<n>]` element pick.
  let index: number | null = null;
  const idxMatch = /\[(\d+)\]$/.exec(core);
  if (idxMatch) {
    index = Number.parseInt(idxMatch[1], 10);
    core = core.slice(0, idxMatch.index).trim();
  }

  // Inline sp.jsonPath(arg, 'query')
  const inline = /^sp\.jsonPath\(\s*[^,]+,\s*(['"])((?:(?!\1).|\\.)*)\1\s*\)$/.exec(core);
  if (inline) return { query: inline[2], index, fallback };

  // Local binding
  if (locals.has(core)) return { query: locals.get(core)!, index, fallback };

  return null;
}

/**
 * True when `accessor` is a plain field/path read we can translate to every
 * target (`json.user.id`, `sp.response.json().id`, `users[0].name`). Rejects JS
 * expressions we cannot turn into a response-field read: nullish/logical
 * operators and defaults (`matches[0] ?? ''`), arrow functions, template
 * literals. Those typically reference script locals (e.g. an `sp.jsonPath(...)`
 * result) and otherwise emit code that throws at runtime.
 */
export function isSimpleAccessor(accessor: string): boolean {
  if (!accessor) return false;
  if (/\?\?|\|\||&&|=>|[`]|\bfunction\b/.test(accessor)) return false;
  // A space outside a bracket key (`json["my key"]` is fine) signals an expression.
  const withoutBracketKeys = accessor.replaceAll(/\[(['"]).*?\1\]/g, '');
  return !/\s/.test(withoutBracketKeys);
}

/**
 * Convert a `json.users[0].name` accessor into a JSONPath-style string
 * for frameworks that use JSONPath (e.g. REST Assured's `jsonPath()`).
 *
 *   json.users[0].name  →  users[0].name
 *   json["my key"].val  →  ['my key'].val
 */
export function accessorToJsonPath(accessor: string): string {
  return accessor.replace(/^json\.?/, '').replaceAll(/\["([^"]+)"\]/g, "['$1']");
}
