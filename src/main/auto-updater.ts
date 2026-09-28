// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// In-app auto-update for the packaged desktop app (electron-updater). The
// installer is downloaded *inside the app* from the GitHub release and applied
// on restart — so it never goes through the browser (no Edge SmartScreen
// download prompt) and, since the NSIS build is per-user, needs no admin. This
// is what makes updates work on locked-down/controlled machines.
//
// When the app is run from the npm package (not packaged), electron-updater
// can't self-update, so `updateMode()` reports 'npm' and the renderer falls
// back to the "npm update -g" hint (see update-check.ts / UpdateToast).

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
  autoUpdater.on('update-downloaded', info => {
    installReady = true;
    send(IPC.app.onUpdateDownloaded, { version: info.version });
  });
  autoUpdater.on('error', err => {
    send(IPC.app.onUpdateError, { message: err instanceof Error ? err.message : String(err) });
  });

  // Best-effort: offline, no release, or blocked network just no-ops (the
  // renderer shows nothing). Never let an update check crash startup.
  autoUpdater.checkForUpdates().catch(() => { /* ignore */ });
}

/** Quit and install a previously-downloaded update. No-op until one is ready. */
export function installUpdate(): void {
  if (installReady) autoUpdater.quitAndInstall();
}
