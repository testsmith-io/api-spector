// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

// ─── In-memory globals singleton ─────────────────────────────────────────────

let globals: Record<string, string> = {};
let currentDir: string | null = null;

function globalsPath(dir: string): string {
  return join(dir, 'globals.json');
}

export async function loadGlobals(workspaceDir: string): Promise<Record<string, string>> {
  currentDir = workspaceDir;
  try {
    const raw = await readFile(globalsPath(workspaceDir), 'utf8');
    globals = JSON.parse(raw);
  } catch {
    globals = {};
  }
  return { ...globals };
}

export async function persistGlobals(): Promise<void> {
  if (!currentDir) return;
  await writeFile(globalsPath(currentDir), JSON.stringify(globals, null, 2), 'utf8');
}

export function getGlobals(): Record<string, string> {
  return { ...globals };
}

export function setGlobals(next: Record<string, string>): void {
  globals = { ...next };
}

export function patchGlobals(patch: Record<string, string>): void {
  globals = { ...globals, ...patch };
}
