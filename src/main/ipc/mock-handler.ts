// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { type IpcMain } from 'electron';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import type { MockServer } from '../../shared/types';
import { startMock, stopMock, isRunning, getRunningIds, setHitCallback, updateMockRoutes } from '../mock-server';
import type { MockRoute } from '../../shared/types';
import { getWorkspaceDir } from './file-handler';

export function registerMockHandlers(ipc: IpcMain): void {
  ipc.handle('mock:start', async (e, server: MockServer) => {
    setHitCallback(hit => e.sender.send('mock:hit', hit));
    await startMock(server);
  });

  ipc.handle('mock:stop', async (_e, id: string) => {
    await stopMock(id);
  });

  ipc.handle('mock:isRunning', (_e, id: string) => isRunning(id));

  ipc.handle('mock:updateRoutes', (_e, id: string, routes: MockRoute[]) => {
    updateMockRoutes(id, routes);
  });

  ipc.handle('mock:runningIds', () => getRunningIds());

  ipc.handle('file:saveMock', async (_e, relPath: string, server: MockServer) => {
    const wsDir = getWorkspaceDir();
    if (!wsDir) throw new Error('No workspace open');
    const fullPath = join(wsDir, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, JSON.stringify(server, null, 2), 'utf8');
  });

  ipc.handle('file:loadMock', async (_e, relPath: string) => {
    const wsDir = getWorkspaceDir();
    if (!wsDir) throw new Error('No workspace open');
    const raw = await readFile(join(wsDir, relPath), 'utf8');
    return JSON.parse(raw) as MockServer;
  });
}
