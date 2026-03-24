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

import { type IpcMain, dialog, app } from 'electron';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import type { Collection, Environment, Workspace } from '../../shared/types';
import { loadGlobals, getGlobals, setGlobals, persistGlobals } from '../globals-store';

const LAST_WS_FILE = join(app.getPath('userData'), 'last-workspace.json');

async function saveLastWorkspacePath(wsPath: string): Promise<void> {
  await writeFile(LAST_WS_FILE, JSON.stringify({ path: wsPath }), 'utf8');
}

async function readLastWorkspacePath(): Promise<string | null> {
  try {
    const raw = await readFile(LAST_WS_FILE, 'utf8');
    return (JSON.parse(raw) as { path: string }).path ?? null;
  } catch {
    return null;
  }
}

let workspaceDir: string | null = null;
let workspaceFile: string | null = null;

function atomicWrite(path: string, data: string): Promise<void> {
  return writeFile(path, data, 'utf8');
}

export function registerFileHandlers(ipc: IpcMain): void {
  ipc.handle('file:openWorkspace', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Workspace',
      filters: [{ name: 'api Spector Workspace', extensions: ['spector', 'json'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const wsPath = result.filePaths[0];
    workspaceDir = dirname(wsPath);
    workspaceFile = wsPath;
    await loadGlobals(workspaceDir);
    await saveLastWorkspacePath(wsPath);
    const raw = await readFile(wsPath, 'utf8');
    return { workspace: JSON.parse(raw) as Workspace, workspacePath: wsPath };
  });

  ipc.handle('file:newWorkspace', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Create Workspace',
      defaultPath: 'my-workspace.spector',
      filters: [{ name: 'api Spector Workspace', extensions: ['spector', 'json'] }]
    });
    if (result.canceled || !result.filePath) return null;
    workspaceDir = dirname(result.filePath);
    workspaceFile = result.filePath;
    await loadGlobals(workspaceDir);

    // Create data dirs
    await mkdir(join(workspaceDir, 'collections'), { recursive: true });
    await mkdir(join(workspaceDir, 'environments'), { recursive: true });

    // Write .gitignore
    const gitignore = '# api Spector — never commit secrets\n*.secrets\n.env.local\n';
    await atomicWrite(join(workspaceDir, '.gitignore'), gitignore);

    const ws: Workspace = {
      version: '1.0',
      collections: [],
      environments: [],
      activeEnvironmentId: null
    };
    await atomicWrite(result.filePath, JSON.stringify(ws, null, 2));
    await saveLastWorkspacePath(result.filePath);
    return { workspace: ws, workspacePath: result.filePath };
  });

  ipc.handle('file:saveWorkspace', async (_e, ws: Workspace) => {
    if (!workspaceFile) return;
    await atomicWrite(workspaceFile, JSON.stringify(ws, null, 2));
  });

  ipc.handle('file:loadCollection', async (_e, relPath: string) => {
    if (!workspaceDir) throw new Error('No workspace open');
    const raw = await readFile(resolve(workspaceDir, relPath), 'utf8');
    return JSON.parse(raw) as Collection;
  });

  ipc.handle('file:saveCollection', async (_e, relPath: string, col: Collection) => {
    if (!workspaceDir) throw new Error('No workspace open');
    const fullPath = resolve(workspaceDir, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await atomicWrite(fullPath, JSON.stringify(col, null, 2));
  });

  ipc.handle('file:loadEnvironment', async (_e, relPath: string) => {
    if (!workspaceDir) throw new Error('No workspace open');
    const raw = await readFile(resolve(workspaceDir, relPath), 'utf8');
    return JSON.parse(raw) as Environment;
  });

  ipc.handle('file:saveEnvironment', async (_e, relPath: string, env: Environment) => {
    if (!workspaceDir) throw new Error('No workspace open');
    const fullPath = resolve(workspaceDir, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await atomicWrite(fullPath, JSON.stringify(env, null, 2));
  });

  ipc.handle('dialog:pickDir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Output Directory',
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipc.handle('results:save', async (_e, content: string, defaultName: string) => {
    const ext = defaultName.endsWith('.xml') ? 'xml' : defaultName.endsWith('.html') ? 'html' : 'json';
    const allFilters = [
      { name: 'JSON',     extensions: ['json'] },
      { name: 'JUnit XML', extensions: ['xml'] },
      { name: 'HTML',     extensions: ['html'] },
    ];
    const result = await dialog.showSaveDialog({
      title: 'Save Test Results',
      defaultPath: defaultName,
      filters: ext === 'xml'   ? [allFilters[1], allFilters[0], allFilters[2]]
              : ext === 'html' ? [allFilters[2], allFilters[0], allFilters[1]]
              :                  [allFilters[0], allFilters[1], allFilters[2]],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, content, 'utf8');
    return true;
  });

  // ── Globals ──────────────────────────────────────────────────────────────
  ipc.handle('globals:get', () => getGlobals());

  ipc.handle('globals:set', async (_e, patch: Record<string, string>) => {
    setGlobals(patch);
    await persistGlobals();
  });

  ipc.handle('file:closeWorkspace', async () => {
    workspaceDir  = null;
    workspaceFile = null;
    // Clear so the app shows the welcome screen on next launch
    await writeFile(LAST_WS_FILE, JSON.stringify({ path: null }), 'utf8').catch(() => {});
  });

  ipc.handle('file:getLastWorkspace', async () => {
    const wsPath = await readLastWorkspacePath();
    if (!wsPath) return null;
    try {
      workspaceDir = dirname(wsPath);
      workspaceFile = wsPath;
      await loadGlobals(workspaceDir);
      const raw = await readFile(wsPath, 'utf8');
      return { workspace: JSON.parse(raw) as Workspace, workspacePath: wsPath };
    } catch {
      return null;
    }
  });
}

export function getWorkspaceDir(): string | null {
  return workspaceDir;
}
