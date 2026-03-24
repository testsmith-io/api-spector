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
