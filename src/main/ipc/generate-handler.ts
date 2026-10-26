// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { type IpcMain, dialog } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import JSZip from 'jszip';
import { generateRobotFramework } from '../generators/robot-framework';
import { generatePlaywright }     from '../generators/playwright';
import { generatePlaywrightJs }   from '../generators/playwright-js';
import { generateSupertestTs }    from '../generators/supertest-ts';
import { generateSupertestJs }    from '../generators/supertest-js';
import { generateRestAssured }    from '../generators/rest-assured';
import { generateKarate }         from '../generators/karate';
import { generateHttpFile }       from '../generators/http-file';
import { generateCurl }           from '../generators/curl';
import { stripJsonComments }       from '../../shared/strip-json-comments';
import type { GenerateOptions, GeneratedFile, Collection } from '../../shared/types';

// JSON bodies may contain // and /* */ comments (JSONC). Strip them before any
// generator runs, so generated code embeds valid JSON, not commented source.
function stripJsonBodyComments(collection: Collection): Collection {
  const requests = Object.fromEntries(
    Object.entries(collection.requests).map(([id, req]) =>
      req.body?.mode === 'json' && req.body.json
        ? [id, { ...req, body: { ...req.body, json: stripJsonComments(req.body.json) } }]
        : [id, req],
    ),
  );
  return { ...collection, requests };
}

export function registerGenerateHandlers(ipc: IpcMain): void {
  handleIpc(ipc, IPC.generate.code, (_e, opts: GenerateOptions): GeneratedFile[] => {
    const { environment, target } = opts;
    const collection = stripJsonBodyComments(opts.collection);
    switch (target) {
      case 'robot_framework': return generateRobotFramework(collection, environment);
      case 'playwright_ts':   return generatePlaywright(collection, environment);
      case 'playwright_js':   return generatePlaywrightJs(collection, environment);
      case 'supertest_ts':    return generateSupertestTs(collection, environment);
      case 'supertest_js':    return generateSupertestJs(collection, environment);
      case 'rest_assured':    return generateRestAssured(collection, environment);
      case 'karate':          return generateKarate(collection, environment);
      case 'http_file':       return generateHttpFile(collection, environment);
      case 'curl':            return generateCurl(collection, environment);
      default:                throw new Error(`Unknown target: ${target}`);
    }
  });

  handleIpc(ipc, IPC.generate.save, async (_e, files: GeneratedFile[], outputDir: string) => {
    for (const file of files) {
      const fullPath = join(outputDir, file.path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, file.content, 'utf8');
    }
  });

  handleIpc(ipc, IPC.generate.saveZip, async (_e, files: GeneratedFile[], collectionName: string, target: string): Promise<boolean> => {
    const colSlug    = collectionName.replaceAll(/\W+/g, '-').toLowerCase();
    const targetSlug = target.replaceAll('_', '-');
    const defaultName = `${colSlug}-${targetSlug}.zip`;
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save as ZIP',
      defaultPath: defaultName,
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    });
    if (canceled || !filePath) return false;

    const zip = new JSZip();
    for (const file of files) zip.file(file.path, file.content);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    await writeFile(filePath, buffer);
    return true;
  });
}
