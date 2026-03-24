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
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import JSZip from 'jszip';
import { generateRobotFramework } from '../generators/robot-framework';
import { generatePlaywright }     from '../generators/playwright';
import { generatePlaywrightJs }   from '../generators/playwright-js';
import { generateSupertestTs }    from '../generators/supertest-ts';
import { generateSupertestJs }    from '../generators/supertest-js';
import { generateRestAssured }    from '../generators/rest-assured';
import type { GenerateOptions, GeneratedFile } from '../../shared/types';

export function registerGenerateHandlers(ipc: IpcMain): void {
  ipc.handle('generate:code', (_e, opts: GenerateOptions): GeneratedFile[] => {
    const { collection, environment, target } = opts;
    switch (target) {
      case 'robot_framework': return generateRobotFramework(collection, environment);
      case 'playwright_ts':   return generatePlaywright(collection, environment);
      case 'playwright_js':   return generatePlaywrightJs(collection, environment);
      case 'supertest_ts':    return generateSupertestTs(collection, environment);
      case 'supertest_js':    return generateSupertestJs(collection, environment);
      case 'rest_assured':    return generateRestAssured(collection, environment);
      default:                throw new Error(`Unknown target: ${target}`);
    }
  });

  ipc.handle('generate:save', async (_e, files: GeneratedFile[], outputDir: string) => {
    for (const file of files) {
      const fullPath = join(outputDir, file.path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, file.content, 'utf8');
    }
  });

  ipc.handle('generate:saveZip', async (_e, files: GeneratedFile[], collectionName: string, target: string): Promise<boolean> => {
    const colSlug    = collectionName.replace(/\W+/g, '-').toLowerCase();
    const targetSlug = target.replace(/_/g, '-');
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
