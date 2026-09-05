// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { type IpcMain } from 'electron';
import { readFile } from 'node:fs/promises';
import { load as yamlLoad } from 'js-yaml';
import { fetch } from 'undici';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';

// Read + parse an OpenAPI spec for the coverage view. The renderer runs the
// (pure) coverage computation itself; only spec loading needs file / network /
// YAML access, so it lives here.
export function registerCoverageHandlers(ipc: IpcMain): void {
  handleIpc(ipc, IPC.coverage.loadSpec, async (_e, source: { path?: string; url?: string; text?: string }): Promise<unknown> => {
    if (source.text && source.text.trim()) {
      const t = source.text.trim();
      return t.startsWith('{') ? JSON.parse(t) : yamlLoad(t);
    }
    if (source.url) {
      const resp = await fetch(source.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${source.url}`);
      const raw = await resp.text();
      const ct = resp.headers.get('content-type') ?? '';
      return (ct.includes('yaml') || /\.ya?ml$/i.test(source.url)) ? yamlLoad(raw) : JSON.parse(raw);
    }
    if (source.path) {
      const raw = await readFile(source.path, 'utf8');
      return /\.ya?ml$/i.test(source.path) ? yamlLoad(raw) : JSON.parse(raw);
    }
    throw new Error('No spec source: provide a file path, URL, or pasted text.');
  });
}
