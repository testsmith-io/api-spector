#!/usr/bin/env node
// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

/**
 * API Spector test-generation CLI
 *
 * Generate tests from an OpenAPI spec: a happy-path call per operation (with a
 * response-schema assertion), plus negative and boundary tests. Writes a
 * collection file you can drop into a workspace or import in the app.
 *
 * Usage:
 *   api-spector generate-tests --spec <file|url> --output <collection.json> [options]
 *
 * Options:
 *   --spec <file|url>       OpenAPI 3.x document (required).
 *   --output <path>         Collection JSON to write (required).
 *   --name <label>          Collection name (default: from the spec title).
 *   --workspace <path>      With --untested-only, measure coverage against this
 *                           workspace and generate only for untested operations.
 *   --untested-only         Only generate tests for operations with no test yet.
 *   --no-negative           Skip negative (missing field / wrong type) tests.
 *   --no-boundary           Skip boundary (min/max/length) tests.
 *   --help                  Show this help.
 */

import { readFile, writeFile } from 'fs/promises';
import { load as yamlLoad } from 'js-yaml';
import { fetch } from 'undici';
import { v4 as uuidv4 } from 'uuid';
import type { Collection, ApiRequest } from '../shared/types';
import { generateTests, toApiRequest, type GeneratedTest } from '../shared/openapi-testgen';
import { computeCoverage, type CoverageRequestInput } from '../shared/coverage';
import { parseArgs, loadWorkspace, loadCollections, C, color } from './cli-common';

async function loadSpec(source: string): Promise<unknown> {
  const isUrl = /^https?:\/\//i.test(source);
  const raw = isUrl
    ? await (async () => { const r = await fetch(source); if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${source}`); return r.text(); })()
    : await readFile(source, 'utf8');
  return /\.ya?ml$/i.test(source) || (!isUrl && !raw.trim().startsWith('{')) ? yamlLoad(raw) : JSON.parse(raw);
}

async function untestedOperations(specSource: string, spec: unknown, wsPath: string): Promise<Set<string>> {
  const { workspace, dir } = await loadWorkspace(wsPath);
  const collections = await loadCollections(workspace, dir);
  const requests: CoverageRequestInput[] = [];
  for (const col of collections) {
    for (const req of Object.values(col.requests ?? {}) as ApiRequest[]) {
      if (req.disabled) continue;
      requests.push({ name: `${col.name} / ${req.name}`, method: req.method, url: req.url, expectedStatus: req.contract?.statusCode });
    }
  }
  const report = computeCoverage(spec, requests);
  return new Set(report.operations.filter(o => !o.tested).map(o => `${o.method} ${o.path}`));
}

function buildCollection(name: string, tests: GeneratedTest[]): Collection {
  const requests: Record<string, ApiRequest> = {};
  const requestIds: string[] = [];
  for (const t of tests) {
    const id = uuidv4();
    requests[id] = toApiRequest(t, id);
    requestIds.push(id);
  }
  return {
    version: '1.0',
    id: uuidv4(),
    name,
    description: 'Generated from an OpenAPI spec by api-spector generate-tests.',
    rootFolder: { id: uuidv4(), name: 'root', description: '', folders: [], requestIds },
    requests,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log('\nUsage:\n  api-spector generate-tests --spec <file|url> --output <collection.json> [--untested-only --workspace <ws>] [--name <label>] [--no-negative] [--no-boundary]\n');
    process.exit(0);
  }

  const specSource = args.spec as string;
  const output = args.output as string;
  if (!specSource) { console.error('Error: --spec <file|url> is required.'); process.exit(2); }
  if (!output) { console.error('Error: --output <collection.json> is required.'); process.exit(2); }

  let spec: unknown;
  try {
    spec = await loadSpec(specSource);
  } catch (err) {
    console.error(`Error loading spec: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  let only: Set<string> | undefined;
  if (args['untested-only']) {
    if (!args.workspace) { console.error('Error: --untested-only requires --workspace.'); process.exit(2); }
    only = await untestedOperations(specSource, spec, args.workspace as string);
    if (only.size === 0) {
      console.log(color('\n  Every operation already has a test. Nothing to generate.\n', C.green));
      process.exit(0);
    }
  }

  const tests = generateTests(spec, {
    only,
    includeNegative: args['no-negative'] !== true,
    includeBoundary: args['no-boundary'] !== true,
  });

  const specTitle = (spec as { info?: { title?: string } })?.info?.title;
  const name = (args.name as string) || `${specTitle ?? 'API'} tests`;
  const collection = buildCollection(name, tests);
  await writeFile(output, JSON.stringify(collection, null, 2), 'utf8');

  const byCat = tests.reduce<Record<string, number>>((m, t) => { m[t.category] = (m[t.category] ?? 0) + 1; return m; }, {});
  console.log('');
  console.log(color(`  Generated ${tests.length} tests`, C.bold, C.white) + color(` -> ${output}`, C.gray));
  console.log(`  ${color(String(byCat.happy ?? 0), C.green)} happy path, ${color(String(byCat.negative ?? 0), C.yellow)} negative, ${color(String(byCat.boundary ?? 0), C.yellow)} boundary`);
  console.log(color(`  Add it to a workspace, or open the app and import the collection.`, C.gray));
  console.log('');
}

main().catch(err => { console.error(err instanceof Error ? err.message : String(err)); process.exit(2); });
