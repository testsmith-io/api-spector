// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { runScript } from '../main/script-runner';
import { mergeLibraries, isValidLibraryName } from '../shared/libraries';
import type { ScriptLibrary } from '../shared/libraries';

const baseCtx = {
  envVars: {},
  collectionVars: {},
  globals: {},
  localVars: {},
};

describe('sp.require — library modules', () => {
  it('imports a named export from a TypeScript library', async () => {
    const libraries: ScriptLibrary[] = [
      { name: 'math', code: `export const add = (a: number, b: number): number => a + b;` },
    ];
    const result = await runScript(
      `const { add } = sp.require('math'); sp.variables.set('sum', String(add(2, 3)));`,
      { ...baseCtx, libraries },
    );
    expect(result.error).toBeUndefined();
    expect(result.updatedLocalVars.sum).toBe('5');
  });

  it('supports module.exports / exports.* style libraries', async () => {
    const libraries: ScriptLibrary[] = [
      { name: 'legacy', code: `exports.hi = (n) => 'hi ' + n;` },
    ];
    const result = await runScript(
      `sp.variables.set('greet', sp.require('legacy').hi('sam'));`,
      { ...baseCtx, libraries },
    );
    expect(result.updatedLocalVars.greet).toBe('hi sam');
  });

  it('lets a library require another library', async () => {
    const libraries: ScriptLibrary[] = [
      { name: 'base', code: `export const prefix = (s: string) => '[' + s + ']';` },
      { name: 'fmt', code: `import { prefix } from 'base';\nexport const tag = (s: string) => prefix(s.toUpperCase());` },
    ];
    const result = await runScript(
      `sp.variables.set('out', sp.require('fmt').tag('ok'));`,
      { ...baseCtx, libraries },
    );
    expect(result.error).toBeUndefined();
    expect(result.updatedLocalVars.out).toBe('[OK]');
  });

  it('evaluates each library once (shared module state)', async () => {
    const libraries: ScriptLibrary[] = [
      { name: 'counter', code: `let n = 0;\nexport const next = () => ++n;` },
    ];
    const result = await runScript(
      `const c = sp.require('counter'); sp.variables.set('a', String(c.next())); sp.variables.set('b', String(c.next()));`,
      { ...baseCtx, libraries },
    );
    expect(result.updatedLocalVars.a).toBe('1');
    expect(result.updatedLocalVars.b).toBe('2');
  });

  it('gives libraries access to the sandbox globals (sp, dayjs)', async () => {
    const libraries: ScriptLibrary[] = [
      { name: 'auth', code: `export const token = (): string => sp.environment.get('token') ?? 'none';` },
    ];
    const result = await runScript(
      `sp.variables.set('t', sp.require('auth').token());`,
      { ...baseCtx, envVars: { token: 'abc123' }, libraries },
    );
    expect(result.updatedLocalVars.t).toBe('abc123');
  });

  it('errors clearly on an unknown library', async () => {
    const result = await runScript(`sp.require('nope');`, baseCtx);
    expect(result.error).toContain("Cannot find library 'nope'");
  });

  it('tolerates a cyclic import without hanging', async () => {
    const libraries: ScriptLibrary[] = [
      { name: 'a', code: `import { fromB } from 'b';\nexport const fromA = () => 'A';\nexport const chain = () => fromB();` },
      { name: 'b', code: `import { fromA } from 'a';\nexport const fromB = () => 'B';` },
    ];
    const result = await runScript(
      `sp.variables.set('r', sp.require('a').chain());`,
      { ...baseCtx, libraries },
    );
    expect(result.error).toBeUndefined();
    expect(result.updatedLocalVars.r).toBe('B');
  });
});

describe('sp.require — external npm packages', () => {
  it('loads a CommonJS package from the workspace node_modules', async () => {
    // The project root has dayjs installed; use it as the workspace root.
    const result = await runScript(
      `const dayjs = sp.require('dayjs'); sp.variables.set('ok', String(typeof dayjs === 'function'));`,
      { ...baseCtx, libraryRoot: process.cwd() },
    );
    expect(result.error).toBeUndefined();
    expect(result.updatedLocalVars.ok).toBe('true');
  });

  it('refuses file paths, allowing only package names', async () => {
    const result = await runScript(
      `sp.require('./secrets');`,
      { ...baseCtx, libraryRoot: process.cwd() },
    );
    expect(result.error).toContain('only package names are allowed');
  });

  it('a workspace library wins over a same-named package', async () => {
    const result = await runScript(
      `sp.variables.set('v', sp.require('dayjs').marker);`,
      { ...baseCtx, libraryRoot: process.cwd(), libraries: [{ name: 'dayjs', code: 'export const marker = "local";' }] },
    );
    expect(result.updatedLocalVars.v).toBe('local');
  });
});

describe('TypeScript in scripts', () => {
  it('strips type annotations from the script body', async () => {
    const result = await runScript(
      `const n: number = 41; const inc = (x: number): number => x + 1; sp.variables.set('v', String(inc(n)));`,
      baseCtx,
    );
    expect(result.error).toBeUndefined();
    expect(result.updatedLocalVars.v).toBe('42');
  });

  it('keeps assertion line numbers accurate after type stripping', async () => {
    // Types on lines 1-2; the failing assertion is on line 3. Type-stripping
    // must not shift it, or the reported line would be wrong.
    const code = [
      `const expected: number = 2;`,
      `const actual: number = 1;`,
      `sp.test('cmp', () => { sp.expect(actual).to.equal(expected); });`,
    ].join('\n');
    const result = await runScript(code, baseCtx);
    expect(result.testResults[0].passed).toBe(false);
    expect(result.testResults[0].error).toContain('line 3');
  });
});

describe('mergeLibraries', () => {
  it('merges scopes with innermost winning on name collisions', () => {
    const ws = [{ name: 'util', code: 'ws' }, { name: 'ws-only', code: 'w' }];
    const col = [{ name: 'util', code: 'col' }];
    const folder = [{ name: 'util', code: 'folder' }, { name: 'f-only', code: 'f' }];
    const merged = mergeLibraries(ws, col, folder);
    const byName = Object.fromEntries(merged.map(l => [l.name, l.code]));
    expect(byName.util).toBe('folder');
    expect(byName['ws-only']).toBe('w');
    expect(byName['f-only']).toBe('f');
  });

  it('accepts undefined scopes', () => {
    expect(mergeLibraries(undefined, [{ name: 'x', code: '1' }], undefined)).toEqual([{ name: 'x', code: '1' }]);
  });
});

describe('isValidLibraryName', () => {
  it('accepts identifier-like names', () => {
    expect(isValidLibraryName('auth')).toBe(true);
    expect(isValidLibraryName('date-utils')).toBe(true);
    expect(isValidLibraryName('_private')).toBe(true);
  });
  it('rejects names with paths or spaces', () => {
    expect(isValidLibraryName('a/b')).toBe(false);
    expect(isValidLibraryName('has space')).toBe(false);
    expect(isValidLibraryName('1leading')).toBe(false);
    expect(isValidLibraryName('')).toBe(false);
  });
});
