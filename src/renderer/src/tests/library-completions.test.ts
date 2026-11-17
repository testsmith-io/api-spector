// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { parseLibraryExports, parseLibrarySignatures, callNameBeforeCursor, makeAtCompletionSource, type LibrarySource } from '../components/RequestBuilder/atCompletions';

const AUTH: LibrarySource = { name: 'auth', code: 'export function parseToken(b) { return b.token; }\nexport const scheme = "bearer";' };

import { javascript } from '@codemirror/lang-javascript';

function labelsAt(code: string, pos: number, libs: LibrarySource[] = [AUTH], explicit = false): string[] {
  const source = makeAtCompletionSource([], libs);
  // The JS language is needed so the string/comment guard can read the syntax tree.
  const state = EditorState.create({ doc: code, extensions: [javascript({ typescript: true })] });
  const res = source(new CompletionContext(state, pos, explicit));
  return res ? res.options.map(o => o.label) : [];
}

describe('parseLibraryExports', () => {
  it('finds const / function / class exports', () => {
    const code = [
      'export const add = (a: number, b: number) => a + b;',
      'export function greet(n: string): string { return n; }',
      'export class Client {}',
      'export async function load() {}',
    ].join('\n');
    expect(parseLibraryExports(code).sort()).toEqual(['Client', 'add', 'greet', 'load']);
  });

  it('finds names in export { ... } with aliases', () => {
    const code = 'const a = 1, b = 2;\nexport { a, b as bee };';
    expect(parseLibraryExports(code).sort()).toEqual(['a', 'bee']);
  });

  it('ignores type-only exports and default', () => {
    const code = 'export type Foo = string;\nexport default function () {}\nexport const real = 1;';
    expect(parseLibraryExports(code)).toEqual(['real']);
  });

  it('returns nothing for a module with no exports', () => {
    expect(parseLibraryExports('const x = 1;')).toEqual([]);
  });
});

describe('parseLibrarySignatures', () => {
  it('reads params from function and arrow exports', () => {
    const code = [
      'export function parseToken(body: { token: string }): string { return body.token; }',
      'export const add = (a: number, b: number): number => a + b;',
      'export async function load(id: string) {}',
    ].join('\n');
    const sigs = parseLibrarySignatures(code);
    expect(sigs.parseToken).toBe('(body: { token: string })');
    expect(sigs.add).toBe('(a: number, b: number)');
    expect(sigs.load).toBe('(id: string)');
  });
});

describe('callNameBeforeCursor', () => {
  it('finds the function of the innermost open call', () => {
    expect(callNameBeforeCursor('parseToken(')).toBe('parseToken');
    expect(callNameBeforeCursor('a.parseToken(sp.response.json(), ')).toBe('parseToken');
    expect(callNameBeforeCursor('const x = add(1, ')).toBe('add');
  });
  it('returns null outside a call', () => {
    expect(callNameBeforeCursor('const x = 1 + ')).toBeNull();
    expect(callNameBeforeCursor('foo()')).toBeNull();
  });
});

describe('sp.require completion in scripts', () => {
  it('completes the library name inside sp.require()', () => {
    const code = `const x = sp.require('au`;
    expect(labelsAt(code, code.length)).toContain('auth');
  });

  it('completes exports after sp.require("name").', () => {
    const code = `sp.require('auth').par`;
    expect(labelsAt(code, code.length)).toContain('parseToken');
  });

  it('completes exports off a namespace binding, anywhere later', () => {
    const code = `const a = sp.require('auth')\na.sch`;
    expect(labelsAt(code, code.length)).toContain('scheme');
  });

  it('completes export names inside a destructure', () => {
    const code = `const {  } = sp.require('auth')`;
    const pos = code.indexOf('{') + 2; // inside the braces
    const labels = labelsAt(code, pos);
    expect(labels).toEqual(expect.arrayContaining(['parseToken', 'scheme']));
  });

  it('offers a destructured name as an identifier where it is used', () => {
    const code = `const { parseToken } = sp.require('auth')\npars`;
    expect(labelsAt(code, code.length)).toContain('parseToken');
  });

  it('does not offer bindings right after a dot', () => {
    const code = `const { parseToken } = sp.require('auth')\nfoo.pars`;
    // `foo` is not a known binding, so no library member list; and the bare-word
    // binding fallback must not fire after a dot.
    expect(labelsAt(code, code.length)).not.toContain('parseToken');
  });

  it('offers top-level globals on explicit (Ctrl+Space) in a neutral position', () => {
    const labels = labelsAt('', 0, [], true);
    expect(labels).toEqual(expect.arrayContaining(['sp', 'faker', 'dayjs', 'console']));
  });

  it('suggests a global as you type an identifier', () => {
    expect(labelsAt('fak', 3, [])).toContain('faker');
  });

  it('includes imported names alongside globals in a neutral position', () => {
    const code = `const { parseToken } = sp.require('auth')\n`;
    expect(labelsAt(code, code.length, [AUTH], true)).toEqual(expect.arrayContaining(['parseToken', 'sp']));
  });

  it('does not suggest globals inside a string literal', () => {
    const code = `const u = "faker"`;
    expect(labelsAt(code, 14)).not.toContain('faker');
  });
});
