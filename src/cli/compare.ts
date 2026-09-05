#!/usr/bin/env node
// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

/**
 * API Spector compare CLI
 *
 * Diff two OpenAPI specs, classify breaking vs non-breaking changes, and (with a
 * workspace) analyse which tests a breaking change affects and give a deploy
 * verdict.
 *
 * Usage:
 *   api-spector compare <old-spec> <new-spec> [options]
 *
 * Options:
 *   --workspace <path>     Analyse impact: which requests/tests hit a changed operation.
 *   --fail-on-breaking     Exit 1 if there are any breaking changes (CI gate).
 *   --json                 Print the diff (+ impact) as JSON.
 *   --help                 Show this help.
 */

import { readFile } from 'fs/promises';
import { load as yamlLoad } from 'js-yaml';
import { fetch } from 'undici';
import type { ApiRequest } from '../shared/types';
import { diffSpecs, summarizeDiff, type SpecChange } from '../shared/openapi-diff';
import { pathMatches } from '../shared/coverage';
import { parseArgs, loadWorkspace, loadCollections, C, color } from './cli-common';

async function loadSpec(source: string): Promise<unknown> {
  const isUrl = /^https?:\/\//i.test(source);
  const raw = isUrl
    ? await (async () => { const r = await fetch(source); if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${source}`); return r.text(); })()
    : await readFile(source, 'utf8');
  return /\.ya?ml$/i.test(source) || (!isUrl && !raw.trim().startsWith('{')) ? yamlLoad(raw) : JSON.parse(raw);
}

interface Affected { change: SpecChange; tests: string[] }

async function analyseImpact(changes: SpecChange[], wsPath: string): Promise<Affected[]> {
  const { workspace, dir } = await loadWorkspace(wsPath);
  const collections = await loadCollections(workspace, dir);
  const reqs: { name: string; method: string; url: string }[] = [];
  for (const col of collections) {
    for (const r of Object.values(col.requests ?? {}) as ApiRequest[]) {
      if (r.disabled) continue;
      reqs.push({ name: `${col.name} / ${r.name}`, method: r.method, url: r.url });
    }
  }
  return changes.filter(c => c.breaking && c.method).map(change => ({
    change,
    tests: reqs.filter(r => r.method.toUpperCase() === change.method && pathMatches(r.url, change.path)).map(r => r.name),
  }));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const positional = argv.filter(a => !a.startsWith('--'));
  const args = parseArgs(argv);

  if (args.help || args.h || positional.length < 2) {
    console.log('\nUsage:\n  api-spector compare <old-spec> <new-spec> [--workspace <path>] [--fail-on-breaking] [--json]\n');
    process.exit(positional.length < 2 && !args.help && !args.h ? 2 : 0);
  }

  const [oldSource, newSource] = positional;
  let changes: SpecChange[];
  try {
    const [oldSpec, newSpec] = await Promise.all([loadSpec(oldSource), loadSpec(newSource)]);
    changes = diffSpecs(oldSpec, newSpec);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  const impact = args.workspace ? await analyseImpact(changes, args.workspace as string) : null;
  const { breaking, nonBreaking } = summarizeDiff(changes);

  if (args.json) {
    console.log(JSON.stringify({ changes, impact, summary: { breaking, nonBreaking } }, null, 2));
  } else {
    console.log('');
    if (breaking) {
      console.log(color('  BREAKING CHANGES', C.bold, C.red));
      for (const c of changes.filter(c => c.breaking)) console.log(`  ${color('✗', C.red)} ${c.detail}`);
      console.log('');
    }
    if (nonBreaking) {
      console.log(color('  NON-BREAKING', C.bold, C.green));
      for (const c of changes.filter(c => !c.breaking)) console.log(`  ${color('✓', C.green)} ${c.detail}`);
      console.log('');
    }
    if (!changes.length) console.log(color('  No differences.\n', C.gray));

    if (impact) {
      const hit = impact.filter(a => a.tests.length > 0);
      const totalTests = new Set(hit.flatMap(a => a.tests)).size;
      console.log(color('  IMPACT', C.bold, C.white));
      if (!breaking) {
        console.log(color('  No breaking changes. Safe to deploy.\n', C.green));
      } else if (totalTests === 0) {
        console.log(`  ${breaking} breaking change(s), but no test in this workspace exercises the affected operations.`);
        console.log(color('  Recommendation: add tests for those operations, then re-check.\n', C.yellow));
      } else {
        for (const a of hit) {
          console.log(`  ${color(a.change.detail, C.yellow)}`);
          for (const t of a.tests) console.log(color(`      - ${t}`, C.gray));
        }
        console.log('');
        console.log(color(`  BLOCK DEPLOYMENT: ${breaking} breaking change(s) affect ${totalTests} test(s).`, C.bold, C.red));
        console.log('');
      }
    }
  }

  if (args['fail-on-breaking'] && breaking > 0) process.exit(1);
}

main().catch(err => { console.error(err instanceof Error ? err.message : String(err)); process.exit(2); });
