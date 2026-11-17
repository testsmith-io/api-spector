// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// TypeScript support for the script sandbox: strip types from user scripts, and
// resolve sp.require('<name>') against the in-scope library files. Libraries are
// evaluated once per run as CommonJS modules sharing the sandbox globals.

import * as vm from 'node:vm';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { transform } from 'sucrase';
import type { ScriptLibrary } from '../shared/libraries';

/** Strip TypeScript types from a pre/post/test script. The `typescript`
 *  transform rewrites in place, so line numbers survive and stack frames still
 *  map 1:1 to the user's source. Throws on a syntax error (surfaced as a script
 *  error by the caller). */
export function transpileScript(code: string): string {
  return transform(code, { transforms: ['typescript'], filePath: 'script.ts' }).code;
}

/** Resolver for external npm packages installed in the workspace's node_modules.
 *  Only bare package specifiers are allowed (no relative/absolute paths), so a
 *  script can load a package but not read arbitrary files. CommonJS only: the
 *  sandbox is synchronous, so ESM-only packages (which need async import) cannot
 *  be loaded this way. Returns undefined when no workspace root is known. */
export function makeExternalRequire(workspaceRoot: string | undefined): ((name: string) => unknown) | undefined {
  if (!workspaceRoot) return undefined;
  const req = createRequire(join(workspaceRoot, 'noop.js'));
  return (name: string) => {
    if (/^[./\\]/.test(name) || /^[a-zA-Z]:[\\/]/.test(name)) {
      throw new Error('only package names are allowed, not file paths');
    }
    return req(name);
  };
}

/** sp.require resolver over the libraries in scope for one run. Modules evaluate
 *  lazily and are cached; a cycle gets the partially-filled exports (Node CJS
 *  semantics) rather than recursing forever. */
export function buildRequire(
  libraries: ScriptLibrary[] | undefined,
  globals: Record<string, unknown>,
  timeoutMs: number,
  externalRequire?: (name: string) => unknown,
): (name: string) => unknown {
  const sources = new Map<string, ScriptLibrary>();
  for (const lib of libraries ?? []) sources.set(lib.name, lib);

  const compiled = new Map<string, string>();
  const modules = new Map<string, { exports: unknown }>();

  function req(name: string): unknown {
    const cached = modules.get(name);
    if (cached) return cached.exports;

    const lib = sources.get(name);
    if (!lib) {
      // Not a workspace library: fall back to an npm package in the workspace's
      // node_modules (CommonJS only; the sandbox is synchronous).
      if (externalRequire) {
        try {
          const exported = externalRequire(name);
          modules.set(name, { exports: exported });
          return exported;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`Cannot load '${name}'. It is not a workspace library, and loading it from node_modules failed: ${msg}`);
        }
      }
      throw new Error(`Cannot find library '${name}'. Define it at workspace, collection or folder level.`);
    }

    let js = compiled.get(name);
    if (js === undefined) {
      // `imports` turns idiomatic `export const` / `import` into CommonJS so a
      // library can export freely and require sibling libraries.
      js = transform(lib.code, { transforms: ['typescript', 'imports'], filePath: `lib/${name}.ts` }).code;
      compiled.set(name, js);
    }

    const mod: { exports: unknown } = { exports: {} };
    modules.set(name, mod); // register before eval so a cycle sees this module
    const ctx: Record<string, unknown> = { ...globals, module: mod, exports: mod.exports, require: req };
    vm.runInNewContext(js, ctx, { timeout: timeoutMs, filename: `lib/${name}.ts` });
    return mod.exports;
  }

  return req;
}
