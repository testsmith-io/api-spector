// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Filter a JSON response with a jq expression. We run the real jq, compiled to
// WebAssembly (jq-web), in the main process so the renderer bundle stays light
// and the wasm module is loaded once, lazily, on first use.

import { type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';

interface JqModule { json(data: unknown, filter: string): unknown }

let jqPromise: Promise<JqModule> | null = null;
function getJq(): Promise<JqModule> {
  if (!jqPromise) {
    jqPromise = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('jq-web');
      // jq-web resolves to the ready module synchronously once the wasm is
      // compiled, but exposes a thenable during init — await it to be safe.
      return (mod && typeof mod.json === 'function') ? mod : await mod;
    })();
  }
  return jqPromise;
}

export function registerJqHandlers(ipc: IpcMain): void {
  handleIpc(ipc, IPC.jq.filter, async (_event: IpcMainInvokeEvent, jsonText: string, filter: string): Promise<string> => {
    const expr = (filter ?? '').trim();
    if (!expr) return jsonText;

    let data: unknown;
    try { data = JSON.parse(jsonText); }
    catch { throw new Error('The response body is not valid JSON, so it cannot be filtered with jq.'); }

    const jq = await getJq();
    let result: unknown;
    try { result = jq.json(data, expr); }
    catch (e) { throw new Error(e instanceof Error ? e.message.trim() : String(e)); }

    return JSON.stringify(result, null, 2);
  });
}
