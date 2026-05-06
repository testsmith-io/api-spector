#!/usr/bin/env node
// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

/**
 * API Spector WSDL CLI
 *
 * Usage:
 *   api-spector wsdl describe        --url <wsdlUrl>
 *   api-spector wsdl import-collection --workspace <path> --url <wsdlUrl> [--name <label>]
 *   api-spector wsdl import-mock       --workspace <path> --url <wsdlUrl> [--name <label>] [--start]
 *
 * `describe` prints operations + endpoints. `import-collection` writes a new
 * Collection JSON with one POST request per WSDL operation. `import-mock`
 * writes a MockServer JSON with one dispatch route per endpoint that picks
 * the matching response envelope by SOAPAction / operation element.
 */

import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import https from 'https';
import http from 'http';
import type { Workspace, MockServer } from '../shared/types';
import { parseWsdl } from '../main/ipc/soap-handler';
import { importWsdl, defaultCollectionRelPath, defaultMockRelPath } from '../main/wsdl/import';

// ─── Arg parsing (shared shape with other CLI entry points) ──────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) { args[key] = true; }
      else { args[key] = next; i++; }
    }
  }
  return args;
}

// ─── HTTP fetch (no electron dep — works in plain node) ──────────────────────

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, res => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolveP(Buffer.concat(chunks).toString('utf8')));
      res.on('error', rejectP);
    });
    req.on('error', rejectP);
    req.setTimeout(15000, () => { req.destroy(); rejectP(new Error('WSDL fetch timed out')); });
  });
}

// ─── Workspace loading (shared pattern with other CLI commands) ──────────────

async function resolveWorkspacePath(wsPath: string): Promise<string> {
  const s = await stat(wsPath);
  if (!s.isDirectory()) return wsPath;
  const entries = await readdir(wsPath);
  const spector = entries.find(e => e.endsWith('.spector'));
  if (!spector) throw new Error(`No .spector workspace file found in directory: ${wsPath}`);
  return join(wsPath, spector);
}

async function loadWorkspace(wsPath: string): Promise<{ workspace: Workspace; dir: string; file: string }> {
  const resolved = await resolveWorkspacePath(wsPath);
  const raw = await readFile(resolved, 'utf8');
  return { workspace: JSON.parse(raw), dir: dirname(resolve(resolved)), file: resolved };
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdDescribe(args: Record<string, string | boolean>): Promise<void> {
  const url = typeof args['url'] === 'string' ? args['url'] : undefined;
  if (!url) {
    console.error('  [error] --url <wsdlUrl> is required');
    process.exit(2);
  }
  const wsdlText = await fetchUrl(url);
  const parsed   = parseWsdl(wsdlText);

  console.log('');
  console.log(`  Target namespace: ${parsed.targetNamespace || '(none)'}`);
  if (parsed.endpoints.length) {
    console.log('  Endpoints:');
    for (const e of parsed.endpoints) {
      console.log(`    [${e.soapVersion}] ${e.binding}  →  ${e.address}`);
    }
  }
  console.log('');
  if (parsed.operations.length === 0) {
    console.log('  No operations found.');
    return;
  }
  console.log('  Operation                             Ver   SOAPAction');
  console.log('  ───────────────────────────────────── ───── ──────────────────────────────');
  for (const op of parsed.operations) {
    const name = op.name.slice(0, 37).padEnd(37);
    const ver  = op.soapVersion.padEnd(5);
    const sa   = (op.soapAction ?? '—').slice(0, 30);
    console.log(`  ${name} ${ver} ${sa}`);
  }
  console.log('');
}

async function loadExistingMockPorts(workspace: Workspace, dir: string): Promise<number[]> {
  const ports: number[] = [];
  for (const relPath of workspace.mocks ?? []) {
    try {
      const raw = await readFile(join(dir, relPath), 'utf8');
      const m = JSON.parse(raw) as MockServer;
      if (typeof m.port === 'number') ports.push(m.port);
    } catch { /* ignore */ }
  }
  return ports;
}

async function cmdImportCollection(args: Record<string, string | boolean>): Promise<void> {
  const url   = typeof args['url'] === 'string' ? args['url'] : undefined;
  const wsArg = typeof args['workspace'] === 'string' ? args['workspace'] : undefined;
  if (!url)   { console.error('  [error] --url <wsdlUrl> is required');   process.exit(2); }
  if (!wsArg) { console.error('  [error] --workspace <path> is required'); process.exit(2); }

  const wsdlText = await fetchUrl(url);
  const { workspace, dir, file } = await loadWorkspace(wsArg);
  const name = typeof args['name'] === 'string' ? args['name'] : undefined;
  const { collection } = importWsdl(wsdlText, { name });

  const relPath = defaultCollectionRelPath(workspace, collection);
  const fullPath = resolve(dir, relPath);
  await ensureDir(dirname(fullPath));
  await writeFile(fullPath, JSON.stringify(collection, null, 2), 'utf8');

  workspace.collections.push(relPath);
  await writeFile(file, JSON.stringify(workspace, null, 2), 'utf8');

  console.log(`  ✓ Wrote ${relPath} (${Object.keys(collection.requests).length} requests)`);
}

async function cmdImportMock(args: Record<string, string | boolean>): Promise<void> {
  const url   = typeof args['url'] === 'string' ? args['url'] : undefined;
  const wsArg = typeof args['workspace'] === 'string' ? args['workspace'] : undefined;
  if (!url)   { console.error('  [error] --url <wsdlUrl> is required');   process.exit(2); }
  if (!wsArg) { console.error('  [error] --workspace <path> is required'); process.exit(2); }

  const wsdlText = await fetchUrl(url);
  const { workspace, dir, file } = await loadWorkspace(wsArg);
  const existingPorts = await loadExistingMockPorts(workspace, dir);
  const name = typeof args['name'] === 'string' ? args['name'] : undefined;
  const { mock } = importWsdl(wsdlText, { name, existingMockPorts: existingPorts });

  const relPath  = defaultMockRelPath(mock);
  const fullPath = resolve(dir, relPath);
  await ensureDir(dirname(fullPath));
  await writeFile(fullPath, JSON.stringify(mock, null, 2), 'utf8');

  if (!workspace.mocks) workspace.mocks = [];
  workspace.mocks.push(relPath);
  await writeFile(file, JSON.stringify(workspace, null, 2), 'utf8');

  console.log(`  ✓ Wrote ${relPath} on port ${mock.port} (${mock.routes.length} dispatch route${mock.routes.length === 1 ? '' : 's'})`);
  if (args['start'] === true) {
    console.log('  [note] --start is not supported in CLI mode; launch the mock from the app.');
  }
}

// ─── Entry ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [, , sub, ...rest] = process.argv;
  const args = parseArgs(rest);

  if (sub === 'describe')          return cmdDescribe(args);
  if (sub === 'import-collection') return cmdImportCollection(args);
  if (sub === 'import-mock')       return cmdImportMock(args);

  if (args['help'] || !sub) {
    console.log(`
  api-spector wsdl describe          --url <wsdlUrl>
  api-spector wsdl import-collection --workspace <path> --url <wsdlUrl> [--name <label>]
  api-spector wsdl import-mock       --workspace <path> --url <wsdlUrl> [--name <label>]
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
