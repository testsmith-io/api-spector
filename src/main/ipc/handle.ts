// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { IpcMain, IpcMainInvokeEvent } from 'electron';

/** Register an ipcMain.handle handler that logs any thrown error as
 *  `[<channel>] <error>` and rethrows, so the renderer's `invoke` rejects
 *  unchanged. Handlers returning their own `{ ok: false }` are unaffected. */
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
