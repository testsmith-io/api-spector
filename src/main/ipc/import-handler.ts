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

import { type IpcMain, dialog } from 'electron';
import { importPostman }              from '../importers/postman';
import { importOpenApi, importOpenApiFromUrl } from '../importers/openapi';
import { importInsomnia }             from '../importers/insomnia';
import { importBruno }                from '../importers/bruno';

export function registerImportHandlers(ipc: IpcMain): void {
  ipc.handle('import:postman', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Postman Collection',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return importPostman(result.filePaths[0]);
  });

  ipc.handle('import:openapi', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import OpenAPI Definition',
      filters: [{ name: 'OpenAPI', extensions: ['json', 'yaml', 'yml'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return importOpenApi(result.filePaths[0]);
  });

  ipc.handle('import:openapi-url', async (_event, url: string) => {
    return importOpenApiFromUrl(url);
  });

  ipc.handle('import:insomnia', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Insomnia Collection',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return importInsomnia(result.filePaths[0]);
  });

  ipc.handle('import:bruno', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Bruno Collection',
      filters: [{ name: 'Bruno Collection', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return importBruno(result.filePaths[0]);
  });
}
