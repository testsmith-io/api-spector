// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { IpcMain, IpcMainInvokeEvent } from 'electron';

/**
 * Registers an ipcMain.handle handler with consistent error logging.
 *
 * Any error thrown (or rejection) from `fn` is logged to the main-process
 * console as `[<channel>] <error>` and then RETHROWN, so the renderer-side
 * `invoke` still rejects exactly as it did before — the error shape reaching
 * the renderer is unchanged. Handlers that catch their own errors and return
 * custom `{ ok: false, ... }` shapes are unaffected: those returns are not
 * errors, so they pass straight through.
 */
export function handleIpc<Args extends unknown[]>(
  ipc: IpcMain,
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: Args) => unknown,
): void {
  ipc.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...(args as Args));
    } catch (err) {
      console.error(`[${channel}]`, err);
      throw err;
    }
  });
}
