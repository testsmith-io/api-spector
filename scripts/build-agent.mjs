// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT
//
// Bundles the private runner (agent) into a single self-contained CJS file with
// the engine embedded, so the published npm package has no install-time
// dependencies and needs only Node 18+. Output: agent/dist/index.cjs
//
//   node scripts/build-agent.mjs
//
// CJS (not ESM) because the engine graph contains a dynamic require of a
// node: builtin, which esbuild's ESM output cannot shim but CJS handles
// natively.

import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version ?? '';

// Keep the published agent version in lockstep with the app, so a release bump
// never tries to re-publish an existing version.
const agentPkgPath = resolve(root, 'agent/package.json');
const agentPkg = JSON.parse(readFileSync(agentPkgPath, 'utf8'));
if (agentPkg.version !== version) {
  agentPkg.version = version;
  writeFileSync(agentPkgPath, JSON.stringify(agentPkg, null, 2) + '\n');
  console.log(`[build-agent] synced agent version -> ${version}`);
}

await build({
  entryPoints: [resolve(root, 'src/agent/index.ts')],
  outfile: resolve(root, 'agent/dist/index.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  banner: { js: '#!/usr/bin/env node' },
  define: { __APP_VERSION__: JSON.stringify(version) },
  logLevel: 'info',
});

console.log(`[build-agent] bundled agent ${version} -> agent/dist/index.cjs`);
