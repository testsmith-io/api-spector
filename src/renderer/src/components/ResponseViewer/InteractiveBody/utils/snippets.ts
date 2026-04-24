// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { esc, toLit } from './format';
import { jsonAccessor, jsonPathLabel, toJsonPathExpr, varNameFromPath, type JsonPath } from './jsonPath';

// ─── JSON assertions ──────────────────────────────────────────────────────────

// Snippets reference the `json` variable directly. `appendSnippetToScript`
// hoists a single `const json = sp.response.json();` to the top of the
// script so multiple assertions don't each redeclare it.

export function makeJsonSnippet(
  path: JsonPath,
  value: unknown,
  mode: 'equals' | 'exists' | 'type' | 'contains',
): string {
  const acc = jsonAccessor(path);
  const label = jsonPathLabel(path);
  const lit = toLit(value);

  switch (mode) {
    case 'equals':
      return `sp.test('${label} equals ${lit}', function() {\n  sp.expect(${acc}).to.equal(${lit});\n});`;
    case 'exists':
      return `sp.test('${label} exists', function() {\n  sp.expect(${acc}).to.not.be.oneOf([null, undefined]);\n});`;
    case 'type': {
      const t = value === null ? 'null' : typeof value;
      return `sp.test('${label} is ${t}', function() {\n  sp.expect(${acc}).to.be.a("${t}");\n});`;
    }
    case 'contains':
      return `sp.test('${label} contains ${lit}', function() {\n  sp.expect(${acc}).to.include(${lit});\n});`;
  }
}

export function makeJsonPathSnippet(path: JsonPath, value: unknown, filterKey: string, filterValue: string): string {
  const expr = toJsonPathExpr(path, filterKey, filterValue);
  const lit  = toLit(value);
  return `sp.test('${expr} equals ${lit}', function() {\n  const matches = sp.jsonPath(json, '${expr}');\n  sp.expect(matches.length).to.be.above(0);\n  sp.expect(matches[0]).to.equal(${lit});\n});`;
}

// ─── XML assertions ───────────────────────────────────────────────────────────

export function makeXmlSnippet(
  selector: string,
  value: string,
  mode: 'equals' | 'exists' | 'contains',
): string {
  const sel = selector.replace(/"/g, '\\"');
  switch (mode) {
    case 'equals':
      return `sp.test('${selector} equals "${esc(value)}"', function() {\n  sp.expect(sp.response.xmlText("${sel}")).to.equal("${esc(value)}");\n});`;
    case 'exists':
      return `sp.test('${selector} exists', function() {\n  sp.expect(sp.response.xmlText("${sel}")).to.not.equal(null);\n});`;
    case 'contains':
      return `sp.test('${selector} contains "${esc(value)}"', function() {\n  sp.expect(sp.response.xmlText("${sel}")).to.include("${esc(value)}");\n});`;
  }
}

// ─── Extract snippets (variable / environment) ────────────────────────────────

export function makeJsonExtractSnippet(path: JsonPath, target: 'variables' | 'environment'): string {
  const acc     = jsonAccessor(path);
  const varName = varNameFromPath(path);
  return `sp.${target}.set("${varName}", String(${acc}));`;
}

export function makeJsonPathExtractSnippet(
  path: JsonPath,
  filterKey: string,
  filterValue: string,
  target: 'variables' | 'environment',
): string {
  const expr    = toJsonPathExpr(path, filterKey, filterValue);
  const varName = varNameFromPath(path);
  return `const matches = sp.jsonPath(json, '${expr}');\nsp.${target}.set("${varName}", String(matches[0] ?? ''));`;
}

export function makeXmlExtractSnippet(selector: string, target: 'variables' | 'environment'): string {
  return `sp.${target}.set("extracted_value", sp.response.xmlText("${selector.replace(/"/g, '\\"')}") ?? '');`;
}
