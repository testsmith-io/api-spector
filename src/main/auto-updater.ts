// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// In-app auto-update for the packaged desktop app (electron-updater): downloads
// in-app, applies on restart. From npm it can't self-update, so `updateMode()`
// reports 'npm' and the renderer shows the "npm update -g" hint.

import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC } from '../shared/ipc-channels';

export function updateMode(): 'auto' | 'npm' {
  return app.isPackaged ? 'auto' : 'npm';
}

let installReady = false;

export function initAutoUpdater(): void {
  if (updateMode() !== 'auto') return; // npm / dev: handled by the registry check

  const send = (channel: string, payload: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
  };

  autoUpdater.autoDownload = true;          // fetch the update in the background
  autoUpdater.autoInstallOnAppQuit = true;  // apply on next quit if not restarted sooner

  autoUpdater.on('update-available', info => {
    send(IPC.app.onUpdateAvailable, { version: info.version });
  });
  autoUpdater.on('download-progress', p => {
    send(IPC.app.onUpdateProgress, { percent: p.percent, transferred: p.transferred, total: p.total });
  });
  autoUpdater.on('update-downloaded', info => {
    installReady = true;
    send(IPC.app.onUpdateDownloaded, { version: info.version });
  });
  autoUpdater.on('error', err => {
    send(IPC.app.onUpdateError, { message: err instanceof Error ? err.message : String(err) });
  });

  // Offline, no release, or blocked network just no-ops. Never let an update
  // check crash startup.
  autoUpdater.checkForUpdates().catch(() => { /* ignore */ });
}

/** Quit and install a previously-downloaded update. No-op until one is ready. */
export function installUpdate(): void {
  if (installReady) autoUpdater.quitAndInstall();
}
