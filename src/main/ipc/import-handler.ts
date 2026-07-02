// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { type IpcMain, dialog } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import { importPostman }                                    from '../importers/postman';
import { importOpenApi, importOpenApiFromUrl,
         extractSchemasFromFile, extractSchemasFromUrl }    from '../importers/openapi';
import { importInsomnia }                                   from '../importers/insomnia';
import { importBruno }                                      from '../importers/bruno';
import { importHttpFile }                                   from '../importers/http-file';

export function registerImportHandlers(ipc: IpcMain): void {
  handleIpc(ipc, IPC.import.postman, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Postman Collection',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return importPostman(result.filePaths[0]);
  });

  handleIpc(ipc, IPC.import.openapi, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import OpenAPI Definition',
      filters: [{ name: 'OpenAPI', extensions: ['json', 'yaml', 'yml'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return importOpenApi(result.filePaths[0]);
  });

  handleIpc(ipc, IPC.import.openapiUrl, async (_event, url: string) => {
    return importOpenApiFromUrl(url);
  });

  handleIpc(ipc, IPC.import.insomnia, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Insomnia Collection',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return importInsomnia(result.filePaths[0]);
  });

  handleIpc(ipc, IPC.import.bruno, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Bruno Collection',
      filters: [{ name: 'Bruno Collection', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return importBruno(result.filePaths[0]);
  });

  handleIpc(ipc, IPC.import.http, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import .http / .rest file',
      filters: [{ name: 'HTTP file', extensions: ['http', 'rest'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return importHttpFile(result.filePaths[0]);
  });

  // ─── Schema sync (extract schemas without full import) ─────────────────────
  handleIpc(ipc, IPC.import.openapiSchemas, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Load OpenAPI spec for schema sync',
      filters: [{ name: 'OpenAPI', extensions: ['json', 'yaml', 'yml'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return extractSchemasFromFile(result.filePaths[0]);
  });

  handleIpc(ipc, IPC.import.openapiSchemasUrl, async (_event, url: string) => {
    return extractSchemasFromUrl(url);
  });
}
