// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

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
