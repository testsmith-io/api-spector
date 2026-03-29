#!/usr/bin/env node
// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

/**
 * API Spector Record Proxy CLI
 *
 * Usage:
 *   api-spector record --upstream https://api.example.com [options]
 *
 * Options:
 *   --upstream <url>    Real API base URL (required)
 *   --port <n>          Local port to listen on (default: 4001)
 *   --output <path>     Output directory (default: ./recordings)
 *   --mask <header>     Mask this header value with *** (repeatable)
 *   --ignore <header>   Omit this header from recordings entirely (repeatable)
 *   --help              Show this message
 */

import { writeFile, mkdir } from 'fs/promises';
import { resolve, join } from 'path';
import {
  startRecorder, stopRecorder, setRecorderHitCallback, entriesToMockServer,
} from '../main/recorder';
import type { RecordedEntry } from '../shared/types';

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green:  '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan:   '\x1b[36m', gray: '\x1b[90m', white: '\x1b[97m',
};

function color(str: string, ...codes: string[]): string {
  return process.stdout.isTTY ? codes.join('') + str + C.reset : str;
}

function methodBadge(method: string): string {
  const m = method.toUpperCase();
  const c = m === 'GET' ? C.green : m === 'POST' ? C.cyan
          : (m === 'PUT' || m === 'PATCH') ? C.yellow : m === 'DELETE' ? C.red : C.white;
  return color(m.padEnd(7), c, C.bold);
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
      if (key === 'mask' || key === 'ignore') {
        const existing = args[key];
        args[key] = Array.isArray(existing) ? [...existing, next] : [next];
      } else {
        args[key] = next;
      }
      i++;
    }
  }
  return args;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(
      '\nUsage:\n  api-spector record --upstream <url> [options]\n\n' +
      'Options:\n' +
      '  --upstream <url>    Real API base URL (required)\n' +
      '  --port <n>          Local port (default: 4001)\n' +
      '  --output <path>     Output directory (default: ./recordings)\n' +
      '  --mask <header>     Mask header value with *** (repeatable)\n' +
      '  --ignore <header>   Omit header from recordings (repeatable)\n'
    );
    process.exit(0);
  }

  const upstream = (args.upstream as string | undefined)?.replace(/\/$/, '');
  if (!upstream) {
    console.error(color('Error: --upstream <url> is required', C.red));
    process.exit(1);
  }

  const port      = parseInt((args.port    as string | undefined) ?? '4001', 10);
  const outputDir = resolve((args.output   as string | undefined) ?? './recordings');
  const extraMask:   string[] = Array.isArray(args.mask)   ? args.mask   as string[] : args.mask   ? [args.mask   as string] : [];
  const extraIgnore: string[] = Array.isArray(args.ignore) ? args.ignore as string[] : args.ignore ? [args.ignore as string] : [];

  setRecorderHitCallback((entry: RecordedEntry) => {
    const { method, path } = entry.request;
    const { status, binary } = entry.response;
    const sc  = status < 300 ? C.green : status < 400 ? C.cyan : C.red;
    const st  = status > 0 ? color(String(status), sc, C.bold) : color('ERR', C.red, C.bold);
    const bin = binary ? color(' [binary]', C.yellow) : '';
    console.log(`  ${methodBadge(method)} ${color(path, C.white)}  ${st}  ${color(`${entry.durationMs}ms`, C.gray)}${bin}`);
  });

  await startRecorder({ upstream, port, maskHeaders: extraMask, ignoreHeaders: extraIgnore });

  console.log('');
  console.log(color('  API Spector — Record Proxy', C.bold, C.white));
  console.log(color(`  Upstream:  ${upstream}`, C.gray));
  console.log(color(`  Listening: http://localhost:${port}`, C.cyan));
  console.log(color(`  Output:    ${outputDir}`, C.gray));
  console.log(color('  Press Ctrl+C to stop and save recordings.\n', C.dim));

  async function shutdown() {
    console.log('');
    const session = stopRecorder();
    setRecorderHitCallback(null);

    if (session.entries.length === 0) {
      console.log(color('  No requests recorded.', C.yellow));
      process.exit(0);
    }

    await mkdir(outputDir, { recursive: true });
    const slug = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    const sessionPath = join(outputDir, `session-${slug}.recording.json`);
    await writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf8');

    const mockName   = `Recorded — ${new URL(upstream).hostname} ${slug}`;
    const mockServer = entriesToMockServer(session.entries, upstream, mockName, port);
    const mockPath   = join(outputDir, `session-${slug}.mock.json`);
    await writeFile(mockPath, JSON.stringify(mockServer, null, 2), 'utf8');

    console.log(color(`  Recorded ${session.entries.length} request${session.entries.length !== 1 ? 's' : ''}.`, C.green, C.bold));
    console.log(color(`  Session:    ${sessionPath}`, C.gray));
    console.log(color(`  Mock stubs: ${mockPath}`, C.gray));
    console.log('');
    process.exit(0);
  }

  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error(color(`Fatal: ${err instanceof Error ? err.message : String(err)}`, '\x1b[31m'));
  process.exit(2);
});
