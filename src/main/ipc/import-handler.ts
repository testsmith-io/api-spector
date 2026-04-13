// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { type IpcMain, dialog } from 'electron';
import { importPostman }                                    from '../importers/postman';
import { importOpenApi, importOpenApiFromUrl,
         extractSchemasFromFile, extractSchemasFromUrl }    from '../importers/openapi';
import { importInsomnia }                                   from '../importers/insomnia';
import { importBruno }                                      from '../importers/bruno';

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

  // ─── Schema sync (extract schemas without full import) ─────────────────────
  ipc.handle('import:openapi-schemas', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Load OpenAPI spec for schema sync',
      filters: [{ name: 'OpenAPI', extensions: ['json', 'yaml', 'yml'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return extractSchemasFromFile(result.filePaths[0]);
  });

  ipc.handle('import:openapi-schemas-url', async (_event, url: string) => {
    return extractSchemasFromUrl(url);
  });
}
