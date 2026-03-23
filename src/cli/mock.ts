#!/usr/bin/env node
/**
 * API Tester Mock Server CLI
 *
 * Starts one or more mock servers defined in a workspace and keeps them running.
 *
 * Usage:
 *   api-spector mock --workspace ./my-workspace.spector [options]
 *
 * Options:
 *   --workspace <path>   Path to workspace.json (required)
 *   --name <name>        Start only the server with this name (can be repeated)
 *   --help               Show this message
 */

import { readFile } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import type { Workspace, MockServer } from '../shared/types';
import { startMock, stopAll } from '../main/mock-server';

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  white:  '\x1b[97m',
};

function color(str: string, ...codes: string[]): string {
  return process.stdout.isTTY ? codes.join('') + str + C.reset : str;
}

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean | string[]> {
  const args: Record<string, string | boolean | string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key  = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      // --name can be repeated
      if (key === 'name') {
        const prev = args[key];
        args[key] = Array.isArray(prev) ? [...prev, next] : [next];
      } else {
        args[key] = next;
      }
      i++;
    }
  }
  return args;
}

// ─── File loading ─────────────────────────────────────────────────────────────

async function loadWorkspace(wsPath: string): Promise<{ workspace: Workspace; dir: string }> {
  const raw = await readFile(wsPath, 'utf8');
  return { workspace: JSON.parse(raw), dir: dirname(resolve(wsPath)) };
}

async function loadMocks(workspace: Workspace, dir: string): Promise<MockServer[]> {
  const mocks: MockServer[] = [];
  for (const relPath of workspace.mocks ?? []) {
    try {
      const raw = await readFile(join(dir, relPath), 'utf8');
      mocks.push(JSON.parse(raw));
    } catch {
      console.warn(color(`  [warn] Could not load mock: ${relPath}`, C.yellow));
    }
  }
  return mocks;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(
      '\nUsage:\n  api-spector mock --workspace <path> [--name <server-name>]\n\n' +
      'Options:\n' +
      '  --workspace <path>   Path to workspace.json (required)\n' +
      '  --name <name>        Start only the named server (repeat for multiple)\n' +
      '  --help               Show this message\n'
    );
    process.exit(0);
  }

  const wsPath = args.workspace as string;
  if (!wsPath) {
    console.error(color('Error: --workspace is required', C.red));
    process.exit(1);
  }

  let workspace: Workspace, wsDir: string;
  try {
    ;({ workspace, dir: wsDir } = await loadWorkspace(wsPath));
  } catch {
    console.error(color(`Error: could not read workspace: ${wsPath}`, C.red));
    process.exit(1);
  }

  const allMocks = await loadMocks(workspace, wsDir);

  if (allMocks.length === 0) {
    console.error(color('  No mock servers defined in this workspace.', C.yellow));
    process.exit(0);
  }

  // Filter by --name if given
  const nameFilter = args.name
    ? (Array.isArray(args.name) ? args.name : [args.name as string]).map(n => n.toLowerCase())
    : null;

  const toStart = nameFilter
    ? allMocks.filter(m => nameFilter.includes(m.name.toLowerCase()))
    : allMocks;

  if (toStart.length === 0) {
    console.error(color(`  No mock servers matched the given --name filter.`, C.yellow));
    console.log(color(`  Available: ${allMocks.map(m => `"${m.name}"`).join(', ')}`, C.gray));
    process.exit(1);
  }

  console.log('');
  console.log(color('  Mock Servers', C.bold, C.white));
  console.log(color(`  Workspace: ${wsPath}`, C.gray));
  console.log('');

  let started = 0;
  for (const mock of toStart) {
    try {
      await startMock(mock);
      console.log(
        color('  ✓', C.green, C.bold) +
        `  ${color(mock.name, C.white)}  ` +
        color(`http://127.0.0.1:${mock.port}`, C.cyan) +
        color(`  (${mock.routes.length} route${mock.routes.length !== 1 ? 's' : ''})`, C.gray)
      );
      for (const route of mock.routes) {
        const delay = route.delay ? color(`  ${route.delay}ms`, C.gray) : '';
        console.log(
          color(`       ${(route.method).padEnd(7)} ${route.path}`, C.gray) +
          color(`  →  ${route.statusCode}`, route.statusCode < 400 ? C.green : C.red) +
          delay
        );
      }
      started++;
    } catch (e) {
      console.error(
        color('  ✗', C.red, C.bold) +
        `  ${mock.name}  ` +
        color(e instanceof Error ? e.message : String(e), C.red)
      );
    }
  }

  if (started === 0) {
    process.exit(1);
  }

  console.log('');
  console.log(color('  Press Ctrl+C to stop all servers.\n', C.gray));

  // Graceful shutdown
  async function shutdown() {
    console.log(color('\n  Stopping mock servers…', C.gray));
    await stopAll();
    process.exit(0);
  }

  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process alive
  setInterval(() => {}, 1 << 30);
}

main().catch(err => {
  console.error(color(`Fatal: ${err.message}`, C.red));
  process.exit(2);
});
