// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { describe, it, expect } from 'vitest';
import {
  prettyJson,
  prettyXml,
} from '../renderer/src/components/ResponseViewer/utils/formatters';
import {
  computeLineDiff,
} from '../renderer/src/components/ResponseViewer/utils/diffEngine';
import {
  jsonAccessor,
  jsonPathLabel,
  getAtPath,
  toJsonPathExpr,
  varNameFromPath,
  type JsonPath,
} from '../renderer/src/components/ResponseViewer/InteractiveBody/utils/jsonPath';
import {
  esc,
  toLit,
} from '../renderer/src/components/ResponseViewer/InteractiveBody/utils/format';
import {
  makeJsonSnippet,
  makeJsonPathSnippet,
  makeXmlSnippet,
  makeJsonExtractSnippet,
  makeJsonPathExtractSnippet,
  makeXmlExtractSnippet,
} from '../renderer/src/components/ResponseViewer/InteractiveBody/utils/snippets';

// ─── formatters ──────────────────────────────────────────────────────────────

describe('prettyJson', () => {
  it('pretty-prints valid JSON with 2-space indent', () => {
    expect(prettyJson('{"a":1,"b":[2,3]}')).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  });

  it('returns the input unchanged if not valid JSON', () => {
    expect(prettyJson('not json at all')).toBe('not json at all');
  });

  it('handles an empty string', () => {
    expect(prettyJson('')).toBe('');
  });
});

describe('prettyXml', () => {
  it('indents nested elements', () => {
    const result = prettyXml('<a><b>1</b></a>');
    expect(result).toContain('<a>');
    expect(result).toContain('  <b>');
    expect(result).toContain('  </b>');
    expect(result).toContain('</a>');
  });

  it('handles processing instructions at the top', () => {
    const result = prettyXml('<?xml version="1.0"?><root></root>');
    expect(result).toContain('<?xml');
  });

  it('returns the input unchanged on empty string', () => {
    expect(prettyXml('')).toBe('');
  });
});

// ─── diffEngine ──────────────────────────────────────────────────────────────

describe('computeLineDiff', () => {
  it('returns all equal lines when inputs are identical', () => {
    const lines = computeLineDiff('a\nb\nc', 'a\nb\nc');
    expect(lines).toHaveLength(3);
    expect(lines.every(l => l.type === 'equal')).toBe(true);
  });

  it('marks added lines', () => {
    const lines = computeLineDiff('a\nc', 'a\nb\nc');
    expect(lines).toEqual([
      { type: 'equal',   text: 'a' },
      { type: 'added',   text: 'b' },
      { type: 'equal',   text: 'c' },
    ]);
  });

  it('marks removed lines', () => {
    const lines = computeLineDiff('a\nb\nc', 'a\nc');
    expect(lines).toEqual([
      { type: 'equal',   text: 'a' },
      { type: 'removed', text: 'b' },
      { type: 'equal',   text: 'c' },
    ]);
  });

  it('handles a complete replacement', () => {
    const lines = computeLineDiff('a', 'b');
    expect(lines).toContainEqual({ type: 'removed', text: 'a' });
    expect(lines).toContainEqual({ type: 'added',   text: 'b' });
  });

  it('handles an empty input on either side', () => {
    expect(computeLineDiff('', 'a')).toEqual([
      { type: 'removed', text: '' },
      { type: 'added',   text: 'a' },
    ]);
    expect(computeLineDiff('a', '')).toEqual([
      { type: 'removed', text: 'a' },
      { type: 'added',   text: '' },
    ]);
  });
});

// ─── format ──────────────────────────────────────────────────────────────────

describe('esc', () => {
  it('escapes backslashes, quotes, and newlines', () => {
    expect(esc('a"b')).toBe('a\\"b');
    expect(esc('a\\b')).toBe('a\\\\b');
    expect(esc('a\nb')).toBe('a\\nb');
    expect(esc('a\rb')).toBe('ab');
  });
});

describe('toLit', () => {
  it('wraps strings in escaped quotes', () => {
    expect(toLit('hello')).toBe('"hello"');
    expect(toLit('a"b')).toBe('"a\\"b"');
  });

  it('renders null as the literal "null"', () => {
    expect(toLit(null)).toBe('null');
  });

  it('stringifies numbers and booleans', () => {
    expect(toLit(42)).toBe('42');
    expect(toLit(true)).toBe('true');
    expect(toLit(false)).toBe('false');
  });
});

// ─── jsonPath ────────────────────────────────────────────────────────────────

describe('jsonAccessor', () => {
  it('returns just `json` for an empty path', () => {
    expect(jsonAccessor([])).toBe('json');
  });

  it('uses dot notation for valid identifier keys', () => {
    expect(jsonAccessor(['users', 'name'])).toBe('json.users.name');
  });

  it('uses bracket notation for numeric indices', () => {
    expect(jsonAccessor(['users', 0, 'name'])).toBe('json.users[0].name');
  });

  it('uses quoted bracket notation for non-identifier keys', () => {
    expect(jsonAccessor(['my key'])).toBe('json["my key"]');
    expect(jsonAccessor(['weird-key'])).toBe('json["weird-key"]');
  });

  it('escapes embedded quotes in non-identifier keys', () => {
    expect(jsonAccessor(['a"b'])).toBe('json["a\\"b"]');
  });
});

describe('jsonPathLabel', () => {
  it('returns $ for the root path', () => {
    expect(jsonPathLabel([])).toBe('$');
  });

  it('joins string segments with dots', () => {
    expect(jsonPathLabel(['users', 'name'])).toBe('users.name');
  });

  it('renders numeric segments with brackets', () => {
    expect(jsonPathLabel(['users', 0, 'name'])).toBe('users.[0].name');
  });
});

describe('getAtPath', () => {
  const root = { users: [{ name: 'alice', age: 30 }, { name: 'bob' }] };

  it('walks an object path', () => {
    expect(getAtPath(root, ['users', 0, 'name'])).toBe('alice');
    expect(getAtPath(root, ['users', 1, 'name'])).toBe('bob');
    expect(getAtPath(root, ['users', 0, 'age'])).toBe(30);
  });

  it('returns the root when path is empty', () => {
    expect(getAtPath(root, [])).toBe(root);
  });

  it('returns undefined for missing keys', () => {
    expect(getAtPath(root, ['missing'])).toBeUndefined();
    expect(getAtPath(root, ['users', 99, 'name'])).toBeUndefined();
    expect(getAtPath(root, ['users', 0, 'name', 'nope'])).toBeUndefined();
  });
});

describe('toJsonPathExpr', () => {
  it('returns "" when the path traverses no array', () => {
    expect(toJsonPathExpr(['users', 'name'], 'id', '1')).toBe('');
  });

  it('builds a filter expression for an array element', () => {
    const path: JsonPath = ['users', 0, 'name'];
    expect(toJsonPathExpr(path, 'id', '42')).toBe('$.users[?(@.id==42)].name');
  });

  it('quotes non-numeric filter values', () => {
    const path: JsonPath = ['users', 0, 'name'];
    expect(toJsonPathExpr(path, 'role', 'admin')).toBe('$.users[?(@.role=="admin")].name');
  });

  it('omits the leaf when the array element itself is the target', () => {
    const path: JsonPath = ['users', 0];
    expect(toJsonPathExpr(path, 'id', '42')).toBe('$.users[?(@.id==42)]');
  });

  it('handles root-level arrays without a trailing dot', () => {
    // When the response is a bare array like [{ id: "x", name: "Hand Tools" }],
    // the path is [0, 'id'] — no named prefix before the array index.
    const path: JsonPath = [0, 'id'];
    expect(toJsonPathExpr(path, 'name', 'Hand Tools')).toBe('$[?(@.name=="Hand Tools")].id');
  });

  it('handles root-level array targeting the element itself', () => {
    const path: JsonPath = [0];
    expect(toJsonPathExpr(path, 'name', 'Hand Tools')).toBe('$[?(@.name=="Hand Tools")]');
  });
});

describe('varNameFromPath', () => {
  it('returns the last string segment', () => {
    expect(varNameFromPath(['users', 0, 'name'])).toBe('name');
  });

  it('returns "extracted_value" if every segment is numeric', () => {
    expect(varNameFromPath([0, 1, 2])).toBe('extracted_value');
  });

  it('returns "extracted_value" for an empty path', () => {
    expect(varNameFromPath([])).toBe('extracted_value');
  });
});

// ─── snippets ────────────────────────────────────────────────────────────────

describe('makeJsonSnippet', () => {
  const path: JsonPath = ['user', 'name'];

  it('builds an equals assertion', () => {
    const out = makeJsonSnippet(path, 'alice', 'equals');
    expect(out).toContain("sp.test('user.name equals \"alice\"'");
    // `const json = sp.response.json();` is now hoisted by appendSnippetToScript,
    // not embedded in every sp.test block. Snippets reference `json` directly.
    expect(out).not.toContain('const json = sp.response.json();');
    expect(out).toContain('sp.expect(json.user.name).to.equal("alice");');
  });

  it('builds an exists assertion', () => {
    const out = makeJsonSnippet(path, 'alice', 'exists');
    expect(out).toContain("sp.test('user.name exists'");
    expect(out).toContain('to.not.be.oneOf([null, undefined])');
  });

  it('builds a type assertion using typeof', () => {
    const out = makeJsonSnippet(path, 42, 'type');
    expect(out).toContain("sp.test('user.name is number'");
    expect(out).toContain('to.be.a("number")');
  });

  it('handles null in type assertion', () => {
    const out = makeJsonSnippet(path, null, 'type');
    expect(out).toContain("sp.test('user.name is null'");
  });

  it('builds a contains assertion', () => {
    const out = makeJsonSnippet(path, 'alice', 'contains');
    expect(out).toContain("sp.test('user.name contains \"alice\"'");
    expect(out).toContain('to.include("alice")');
  });
});

describe('makeJsonPathSnippet', () => {
  it('builds a JSONPath assertion that filters on a sibling key', () => {
    const path: JsonPath = ['users', 0, 'name'];
    const out = makeJsonPathSnippet(path, 'alice', 'id', '42');
    expect(out).toContain("sp.jsonPath(json, '$.users[?(@.id==42)].name')");
    expect(out).toContain('matches.length).to.be.above(0)');
    expect(out).toContain('matches[0]).to.equal("alice")');
  });
});

describe('makeXmlSnippet', () => {
  it('builds an equals assertion using xmlText', () => {
    const out = makeXmlSnippet('book > title', 'Hamlet', 'equals');
    expect(out).toContain('sp.response.xmlText("book > title")');
    expect(out).toContain('to.equal("Hamlet")');
  });

  it('builds an exists assertion', () => {
    const out = makeXmlSnippet('book > title', 'Hamlet', 'exists');
    expect(out).toContain('to.not.equal(null)');
  });

  it('builds a contains assertion', () => {
    const out = makeXmlSnippet('book > title', 'Ham', 'contains');
    expect(out).toContain('to.include("Ham")');
  });
});

describe('extract snippets', () => {
  it('makeJsonExtractSnippet picks the trailing key as variable name', () => {
    const out = makeJsonExtractSnippet(['user', 'token'], 'variables');
    expect(out).toContain('sp.variables.set("token", String(json.user.token))');
  });

  it('makeJsonExtractSnippet supports environment target', () => {
    const out = makeJsonExtractSnippet(['user', 'token'], 'environment');
    expect(out).toContain('sp.environment.set');
  });

  it('makeJsonPathExtractSnippet uses the JSONPath filter expression', () => {
    const out = makeJsonPathExtractSnippet(['users', 0, 'token'], 'id', '42', 'variables');
    expect(out).toContain("sp.jsonPath(json, '$.users[?(@.id==42)].token')");
    expect(out).toContain('sp.variables.set("token"');
  });

  it('makeXmlExtractSnippet uses xmlText', () => {
    const out = makeXmlExtractSnippet('user > token', 'variables');
    expect(out).toContain('sp.variables.set("extracted_value", sp.response.xmlText("user > token")');
  });
});
