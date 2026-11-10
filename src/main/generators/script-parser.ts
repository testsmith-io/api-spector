// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

/**
 * Regex-parse a post-request script into assertions + variable extractions for each
 * code generator to render. Covers the button-emitted patterns and hand-written ones.
 */

export interface ParsedAssertion {
  name: string
  /** The accessor on the parsed JSON body (e.g. `json.users[0].name`). */
  accessor: string
  kind: 'equals' | 'exists' | 'type' | 'contains' | 'above' | 'status'
  expected?: string  // literal value, e.g. `"alice"` or `200`
}

/**
 * A sp.jsonPath(json, '<query>') behind an extraction, with optional [index] pick
 * and ?? fallback. jsonpath-plus/Jayway syntax. See script-runner.ts sp.jsonPath.
 */
export interface JsonPathQuery {
  /** The JSONPath expression, e.g. `$.data[?(@.name=="Widget")].id`. */
  query: string
  /** Element index when the script picks one match (`matches[0]` -> 0); null = whole result list. */
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

export function parsePostScript(script: string | undefined): ParsedScript {
  const assertions: ParsedAssertion[] = [];
  const extractions: ParsedExtraction[] = [];

  if (!script?.trim()) return { assertions, extractions };

  // sp.test('name', fn) blocks; name may contain escaped quotes, so match broadly.
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

  // Status code assertions outside of sp.test
  // sp.response.to.have.status(200)
  const statusMatch = /sp\.response\.to\.have\.status\((\d+)\)/.exec(script);
  if (statusMatch) {
    assertions.push({ name: `status is ${statusMatch[1]}`, accessor: '', kind: 'status', expected: statusMatch[1] });
  }

  // Local JSONPath bindings
  // const matches = sp.jsonPath(json, '$.data[?(@.name=="X")].id');
  const jsonPathLocals = new Map<string, string>();
  const localRegex = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*sp\.jsonPath\(\s*[^,]+,\s*(['"])((?:(?!\2).|\\.)*)\2\s*\)\s*;?/g;
  while ((match = localRegex.exec(script))) {
    jsonPathLocals.set(match[1], match[3]);
  }

  // Variable extractions
  // sp.variables.set("name", expr)  /  sp.environment.set("name", expr)  /  sp.globals.set("name", expr)
  const extractRegex = /sp\.(variables|environment|globals)\.set\(\s*"([^"]+)"\s*,\s*(.+)\s*\)\s*;/g;
  while ((match = extractRegex.exec(script))) {
    const target = match[1] as ParsedExtraction['target'];
    const varName = match[2];
    let accessor = match[3].trim();
    // Clean up common wrappers: String(...), JSON.stringify(...)
    const stringWrap = /^String\((.+)\)$/.exec(accessor);
    if (stringWrap) accessor = stringWrap[1];

    // Keep JSONPath queries (local or inline sp.jsonPath): they map to each target's JSONPath idiom.
    const jsonPath = parseJsonPathAccessor(accessor, jsonPathLocals);
    if (jsonPath) {
      extractions.push({ varName, accessor: '', target, jsonPath });
    } else {
      extractions.push({ varName, accessor, target });
    }
  }

  // Keep only plain JSON paths and JSONPath queries; other expressions (locals,
  // ?? defaults, calls) would emit code that throws at runtime, so drop them.
  return {
    assertions: assertions.filter(a => a.kind === 'status' || isSimpleAccessor(a.accessor)),
    extractions: extractions.filter(e => e.jsonPath || isSimpleAccessor(e.accessor)),
  };
}

/**
 * Recognize an extraction value backed by sp.jsonPath(...): a local binding or an
 * inline call, with optional [index] pick and ?? fallback. Returns null otherwise.
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
 * True when accessor is a plain field/path read (json.user.id, users[0].name), not
 * an expression (?? / || / && defaults, arrow functions, template literals).
 */
export function isSimpleAccessor(accessor: string): boolean {
  if (!accessor) return false;
  if (/\?\?|\|\||&&|=>|[`]|\bfunction\b/.test(accessor)) return false;
  // A space outside a bracket key (`json["my key"]` is fine) signals an expression.
  const withoutBracketKeys = accessor.replaceAll(/\[(['"]).*?\1\]/g, '');
  return !/\s/.test(withoutBracketKeys);
}

/**
 * Convert a json.users[0].name accessor to a JSONPath-style string (REST Assured's jsonPath()).
 */
export function accessorToJsonPath(accessor: string): string {
  return accessor.replace(/^json\.?/, '').replaceAll(/\["([^"]+)"\]/g, "['$1']");
}
