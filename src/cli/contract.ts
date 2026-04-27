#!/usr/bin/env node
// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

/**
 * API Spector contract CLI
 *
 * Usage:
 *   api-spector contract list --workspace <path>
 *   api-spector contract run  --workspace <path> --mode <mode> [options]
 *
 *   Modes: consumer | provider | bidirectional
 *
 * Run options:
 *   --snapshot <id|name>      Run against a pinned snapshot (looks up by id
 *                             prefix or exact name). Takes priority over
 *                             --spec-url / --spec-path.
 *   --spec-url <url>          Fetch spec from URL for this run (not pinned).
 *   --spec-path <path>        Read spec from local file for this run.
 *   --collection <name>       Limit to a specific collection (default: all).
 *   --environment <name>      Environment to resolve {{vars}} against.
 *   --request-base-url <url>  Strip this host from request URLs before matching.
 *   --output <path>           Write ContractReport JSON to a file.
 */

import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import type { Workspace, Collection, Environment, ApiRequest, ContractSnapshot, ContractMode, ContractReport } from '../shared/types';
import { runConsumerContracts } from '../main/contract/consumer-verifier';
import { runProviderVerification } from '../main/contract/provider-verifier';
import { runBidirectional } from '../main/contract/bidirectional';
import { listSnapshots, loadSnapshot } from '../main/contract/snapshots';
import { writeFile as fsWriteFile } from 'fs/promises';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key  = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) { args[key] = true; }
      else { args[key] = next; i++; }
    }
  }
  return args;
}

// ─── Workspace loading (shared pattern with runner.ts) ───────────────────────

async function resolveWorkspacePath(wsPath: string): Promise<string> {
  const s = await stat(wsPath);
  if (!s.isDirectory()) return wsPath;
  const entries = await readdir(wsPath);
  const spector = entries.find(e => e.endsWith('.spector'));
  if (!spector) throw new Error(`No .spector workspace file found in directory: ${wsPath}`);
  return join(wsPath, spector);
}

async function loadWorkspace(wsPath: string): Promise<{ workspace: Workspace; dir: string }> {
  const resolved = await resolveWorkspacePath(wsPath);
  const raw = await readFile(resolved, 'utf8');
  return { workspace: JSON.parse(raw), dir: dirname(resolve(resolved)) };
}

async function loadCollections(ws: Workspace, dir: string, filterName?: string): Promise<Collection[]> {
  const cols: Collection[] = [];
  for (const relPath of ws.collections) {
    try {
      const raw = await readFile(join(dir, relPath), 'utf8');
      const col = JSON.parse(raw) as Collection;
      if (!filterName || col.name === filterName) cols.push(col);
    } catch { /* skip unreadable */ }
  }
  return cols;
}

async function loadEnvironments(ws: Workspace, dir: string): Promise<Environment[]> {
  const envs: Environment[] = [];
  for (const relPath of ws.environments) {
    try { envs.push(JSON.parse(await readFile(join(dir, relPath), 'utf8'))); } catch { /* ignore */ }
  }
  return envs;
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdList(args: Record<string, string | boolean>): Promise<void> {
  const wsArg = args['workspace'];
  if (typeof wsArg !== 'string') {
    console.error('  [error] --workspace <path> is required');
    process.exit(2);
  }
  const { workspace, dir } = await loadWorkspace(wsArg);
  const snapshots = await listSnapshots(dir, workspace.contracts ?? []);

  if (snapshots.length === 0) {
    console.log('  No contract snapshots. Capture one from the app or via:');
    console.log('    api-spector contract run --workspace <path> --spec-url <url> --pin');
    return;
  }

  // Pretty table
  console.log('');
  console.log('  ID       Name                                Version     Captured');
  console.log('  ──────── ─────────────────────────────────── ─────────── ──────────────────');
  for (const { snapshot } of snapshots) {
    const id      = snapshot.id.slice(0, 8);
    const name    = snapshot.name.slice(0, 35).padEnd(35);
    const version = (snapshot.specVersion ?? '—').slice(0, 11).padEnd(11);
    const when    = snapshot.capturedAt.slice(0, 19).replace('T', ' ');
    console.log(`  ${id} ${name} ${version} ${when}`);
  }
  console.log('');
  console.log('  Run against a snapshot:');
  console.log('    api-spector contract run --workspace <path> --mode provider --snapshot <id>');
}

/** Find a snapshot by exact id, id-prefix (first 8 chars are shown by `list`),
 *  or exact name. Returns the rel-path + loaded snapshot for use with run. */
async function resolveSnapshot(
  ws: Workspace,
  dir: string,
  needle: string,
): Promise<{ relPath: string; snapshot: ContractSnapshot }> {
  const all = await listSnapshots(dir, ws.contracts ?? []);
  const matches = all.filter(({ snapshot }) =>
    snapshot.id === needle ||
    snapshot.id.startsWith(needle) ||
    snapshot.name === needle,
  );
  if (matches.length === 0) throw new Error(`No snapshot matches "${needle}". Run \`api-spector contract list --workspace <path>\` to see available snapshots.`);
  if (matches.length > 1) {
    const ids = matches.map(m => m.snapshot.id.slice(0, 8)).join(', ');
    throw new Error(`Ambiguous snapshot "${needle}" matches multiple (${ids}). Use a longer id prefix.`);
  }
  return matches[0];
}

async function cmdRun(args: Record<string, string | boolean>): Promise<void> {
  const wsArg = args['workspace'];
  const mode  = args['mode'];
  if (typeof wsArg !== 'string') {
    console.error('  [error] --workspace <path> is required');
    process.exit(2);
  }
  if (mode !== 'consumer' && mode !== 'provider' && mode !== 'bidirectional') {
    console.error('  [error] --mode must be one of: consumer, provider, bidirectional');
    process.exit(2);
  }

  const { workspace, dir } = await loadWorkspace(wsArg);

  // Collections + env vars
  const collectionName = typeof args['collection'] === 'string' ? args['collection'] : undefined;
  const collections    = await loadCollections(workspace, dir, collectionName);
  const envs           = await loadEnvironments(workspace, dir);
  const envName        = typeof args['environment'] === 'string' ? args['environment'] : undefined;
  const activeEnv      = envName ? envs.find(e => e.name === envName) : envs[0];
  const envVars: Record<string, string> = {};
  for (const v of activeEnv?.variables ?? []) if (v.enabled) envVars[v.key] = v.value;
  const collectionVars: Record<string, string> = {};
  for (const c of collections) Object.assign(collectionVars, c.collectionVariables ?? {});

  const allRequests: ApiRequest[] = collections.flatMap(c => Object.values(c.requests));
  const contractRequests = allRequests.filter(r =>
    r.contract && (r.contract.statusCode !== undefined || r.contract.bodySchema || r.contract.headers?.length),
  );

  // Resolve spec source: --snapshot takes priority over --spec-url / --spec-path.
  let specUrl  = typeof args['spec-url']  === 'string' ? args['spec-url']  : undefined;
  let specPath = typeof args['spec-path'] === 'string' ? args['spec-path'] : undefined;
  let snapshotLabel: string | undefined;

  if (typeof args['snapshot'] === 'string') {
    const { snapshot } = await resolveSnapshot(workspace, dir, args['snapshot']);
    // Materialize the snapshot spec to a tmp file so the verifier can read it
    // like any other local spec file (matches how the IPC handler does it).
    const tmp = join(tmpdir(), `api-spector-${randomUUID()}.${snapshot.format === 'yaml' ? 'yaml' : 'json'}`);
    await fsWriteFile(tmp, snapshot.spec, 'utf8');
    specPath = tmp;
    specUrl  = undefined;
    snapshotLabel = `${snapshot.name}${snapshot.specVersion ? ` (${snapshot.specVersion})` : ''}`;
  }

  const requestBaseUrl = typeof args['request-base-url'] === 'string' ? args['request-base-url'] : undefined;

  if (mode !== 'consumer' && !specUrl && !specPath) {
    console.error('  [error] Provider / bidirectional mode requires --snapshot, --spec-url, or --spec-path');
    process.exit(2);
  }

  console.log(`  Running ${mode} contracts…`);
  if (snapshotLabel) console.log(`  Spec: snapshot "${snapshotLabel}"`);
  else if (specUrl)  console.log(`  Spec: ${specUrl} (live)`);
  else if (specPath) console.log(`  Spec: ${specPath}`);

  let report: ContractReport;
  const modeValue = mode as ContractMode;
  switch (modeValue) {
    case 'consumer':
      report = await runConsumerContracts(contractRequests, envVars, collectionVars);
      break;
    case 'provider':
      report = await runProviderVerification(allRequests, envVars, specUrl, specPath, requestBaseUrl);
      break;
    case 'bidirectional':
      report = await runBidirectional(contractRequests, envVars, collectionVars, specUrl, specPath, requestBaseUrl);
      break;
  }

  // Summary
  console.log('');
  if (report.failed === 0) {
    console.log(`  ✓ All ${report.passed}/${report.total} passed in ${report.durationMs}ms`);
  } else {
    console.log(`  ✗ ${report.failed}/${report.total} failed (${report.passed} passed) in ${report.durationMs}ms`);
    console.log('');
    for (const r of report.results.filter(r => !r.passed)) {
      console.log(`    ${r.method} ${r.requestName}`);
      for (const v of r.violations) {
        console.log(`      · ${v.type}: ${v.message}`);
      }
    }
  }

  if (typeof args['output'] === 'string') {
    await writeFile(args['output'], JSON.stringify(report, null, 2), 'utf8');
    console.log(`\n  Report written to ${args['output']}`);
  }

  process.exit(report.failed === 0 ? 0 : 1);
}

// ─── Entry ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [, , sub, ...rest] = process.argv;
  const args = parseArgs(rest);

  if (sub === 'list') return cmdList(args);
  if (sub === 'run')  return cmdRun(args);

  if (args['help'] || !sub) {
    console.log(`
  api-spector contract list  --workspace <path>
  api-spector contract run   --workspace <path> --mode <consumer|provider|bidirectional> [options]

  Run options:
    --snapshot <id|name>      Pinned snapshot (run list to see IDs)
    --spec-url <url>          Live URL (fetched once for this run)
    --spec-path <path>        Local spec file
    --collection <name>       Filter to one collection
    --environment <name>      Environment for {{var}} resolution
    --request-base-url <url>  Strip this host before matching spec paths
    --output <path>           Write ContractReport JSON here
`);
    return;
  }

  console.error(`  [error] Unknown subcommand "${sub}"`);
  process.exit(2);
}

main().catch(e => {
  console.error(`  [error] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
