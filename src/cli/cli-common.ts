// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

/**
 * Shared scaffolding for the CLI entry points (runner, contract, mock,
 * record, wsdl, agents): ANSI colour helpers, `--flag value` argument
 * parsing, and workspace/collection/environment/mock file loading.
 *
 * Behavioral notes (kept configurable so each CLI's output is unchanged):
 *  - `color()` only emits ANSI codes on a TTY; `colorAlways()` always does
 *    (the `agents` CLI colours unconditionally).
 *  - `loadCollections`/`loadMocks` take an optional `onError` callback so
 *    callers decide whether an unreadable file warns or is skipped silently.
 */

import { readFile, stat, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import type { Workspace, Collection, Environment, MockServer, Flow } from '../shared/types';
import { inlineDataSets } from '../main/data-files';

// Design-first contract loading lives in main/contract so the app's IPC can share
// it; re-exported here so the CLI's existing import site keeps working.
export { loadDesignContractRequests } from '../main/contract/design-contracts';

// ─── ANSI colour helpers ──────────────────────────────────────────────────────

export const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  white:  '\x1b[97m',
};

/** Colourize only when stdout is a TTY (plain text when piped/redirected). */
export function color(str: string, ...codes: string[]): string {
  return process.stdout.isTTY ? codes.join('') + str + C.reset : str;
}

/** Colourize unconditionally (used by the `agents` CLI). */
export function colorAlways(str: string, ...codes: string[]): string {
  return codes.join('') + str + C.reset;
}

// ─── Arg parsing ──────────────────────────────────────────────────────────────

type ArgValue = string | boolean | string[];

export function parseArgs(argv: string[]): Record<string, string | boolean>;
export function parseArgs(argv: string[], repeatableKeys: string[]): Record<string, ArgValue>;

/**
 * Parse `--key value` / `--flag` style arguments. Keys listed in
 * `repeatableKeys` accumulate into a string[] when given more than once;
 * all other keys keep the last value.
 */
export function parseArgs(argv: string[], repeatableKeys: string[] = []): Record<string, ArgValue> {
  const args: Record<string, ArgValue> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key  = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      if (repeatableKeys.includes(key)) {
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

// ─── Workspace / file loading ─────────────────────────────────────────────────

export async function resolveWorkspacePath(wsPath: string): Promise<string> {
  const s = await stat(wsPath);
  if (!s.isDirectory()) return wsPath;
  const entries = await readdir(wsPath);
  const spector = entries.find(e => e.endsWith('.spector'));
  if (!spector) throw new Error(`No .spector workspace file found in directory: ${wsPath}`);
  return join(wsPath, spector);
}

export async function loadWorkspace(wsPath: string): Promise<{ workspace: Workspace; dir: string; file: string }> {
  const resolved = await resolveWorkspacePath(wsPath);
  const raw = await readFile(resolved, 'utf8');
  return { workspace: JSON.parse(raw), dir: dirname(resolve(resolved)), file: resolved };
}

export interface LoadCollectionsOptions {
  /** Only return collections whose name equals this exactly. */
  filterName?: string
  /** Called for each collection file that cannot be read/parsed (default: skip silently). */
  onError?: (relPath: string) => void
}

export async function loadCollections(
  workspace: Workspace,
  dir: string,
  opts: LoadCollectionsOptions = {},
): Promise<Collection[]> {
  const cols: Collection[] = [];
  for (const relPath of workspace.collections) {
    try {
      const fullPath = join(dir, relPath);
      const col = await inlineDataSets(JSON.parse(await readFile(fullPath, 'utf8')) as Collection, dirname(fullPath));
      if (!opts.filterName || col.name === opts.filterName) cols.push(col);
    } catch {
      opts.onError?.(relPath);
    }
  }
  return cols;
}

export async function loadEnvironments(workspace: Workspace, dir: string): Promise<Environment[]> {
  const envs: Environment[] = [];
  for (const relPath of workspace.environments) {
    try {
      const raw = await readFile(join(dir, relPath), 'utf8');
      envs.push(JSON.parse(raw));
    } catch {
      // ignore missing env files
    }
  }
  return envs;
}

export async function loadMocks(
  workspace: Workspace,
  dir: string,
  onError?: (relPath: string) => void,
): Promise<MockServer[]> {
  const mocks: MockServer[] = [];
  for (const relPath of workspace.mocks ?? []) {
    try {
      const raw = await readFile(join(dir, relPath), 'utf8');
      mocks.push(JSON.parse(raw));
    } catch {
      onError?.(relPath);
    }
  }
  return mocks;
}

export async function loadFlows(
  workspace: Workspace,
  dir: string,
  onError?: (relPath: string) => void,
): Promise<Flow[]> {
  const flows: Flow[] = [];
  for (const relPath of workspace.flows ?? []) {
    try {
      const raw = await readFile(join(dir, relPath), 'utf8');
      flows.push(JSON.parse(raw));
    } catch {
      onError?.(relPath);
    }
  }
  return flows;
}
