// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

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

export interface ParsedExtraction {
  /** Variable name being set. */
  varName: string
  /** The JS expression being stored (e.g. `json.user.token`). */
  accessor: string
  /** Which scope it targets. */
  target: 'variables' | 'environment' | 'globals'
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
    const equalMatch = body.match(/sp\.expect\(([^)]+)\)\.to(?:\.be)?\.equal\(([^)]+)\)/);
    if (equalMatch) {
      assertions.push({ name, accessor: equalMatch[1].trim(), kind: 'equals', expected: equalMatch[2].trim() });
      continue;
    }

    // sp.expect(expr).to.include(value) / .to.contain(value)
    const includeMatch = body.match(/sp\.expect\(([^)]+)\)\.to\.(?:include|contain)\(([^)]+)\)/);
    if (includeMatch) {
      assertions.push({ name, accessor: includeMatch[1].trim(), kind: 'contains', expected: includeMatch[2].trim() });
      continue;
    }

    // sp.expect(expr).to.not.be.oneOf([null, undefined])  (exists check)
    const existsMatch = body.match(/sp\.expect\(([^)]+)\)\.to\.not\.be\.oneOf\(\[null,\s*undefined\]\)/);
    if (existsMatch) {
      assertions.push({ name, accessor: existsMatch[1].trim(), kind: 'exists' });
      continue;
    }

    // sp.expect(expr).to.be.a("type")
    const typeMatch = body.match(/sp\.expect\(([^)]+)\)\.to\.be\.a\(\s*"([^"]+)"\s*\)/);
    if (typeMatch) {
      assertions.push({ name, accessor: typeMatch[1].trim(), kind: 'type', expected: `"${typeMatch[2]}"` });
      continue;
    }

    // sp.expect(expr).to.be.above(n)
    const aboveMatch = body.match(/sp\.expect\(([^)]+)\)\.to\.be\.above\((\d+)\)/);
    if (aboveMatch) {
      assertions.push({ name, accessor: aboveMatch[1].trim(), kind: 'above', expected: aboveMatch[2] });
      continue;
    }

    // Fallback: if nothing matched, still record it as a generic assertion
    assertions.push({ name, accessor: '', kind: 'status' });
  }

  // ── Status code assertions outside of sp.test ────────────────────────────
  // sp.response.to.have.status(200)
  const statusMatch = script.match(/sp\.response\.to\.have\.status\((\d+)\)/);
  if (statusMatch) {
    assertions.push({ name: `status is ${statusMatch[1]}`, accessor: '', kind: 'status', expected: statusMatch[1] });
  }

  // ── Variable extractions ──────────────────────────────────────────────────
  // sp.variables.set("name", expr)  /  sp.environment.set("name", expr)  /  sp.globals.set("name", expr)
  const extractRegex = /sp\.(variables|environment|globals)\.set\(\s*"([^"]+)"\s*,\s*(.+)\s*\)\s*;/g;
  while ((match = extractRegex.exec(script))) {
    const target = match[1] as ParsedExtraction['target'];
    const varName = match[2];
    let accessor = match[3].trim();
    // Clean up common wrappers: String(...), JSON.stringify(...)
    const stringWrap = accessor.match(/^String\((.+)\)$/);
    if (stringWrap) accessor = stringWrap[1];
    extractions.push({ varName, accessor, target });
  }

  return { assertions, extractions };
}

/**
 * Convert a `json.users[0].name` accessor into a JSONPath-style string
 * for frameworks that use JSONPath (e.g. REST Assured's `jsonPath()`).
 *
 *   json.users[0].name  →  users[0].name
 *   json["my key"].val  →  ['my key'].val
 */
export function accessorToJsonPath(accessor: string): string {
  return accessor.replace(/^json\.?/, '').replace(/\["([^"]+)"\]/g, "['$1']");
}
