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

import { app, BrowserWindow, ipcMain, nativeImage } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { registerFileHandlers } from './ipc/file-handler';
import { registerRequestHandler } from './ipc/request-handler';
import { registerSecretHandlers, initSecretStore } from './ipc/secret-handler';
import { registerImportHandlers } from './ipc/import-handler';
import { registerGenerateHandlers } from './ipc/generate-handler';
import { registerRunnerHandler } from './ipc/runner-handler';
import { registerMockHandlers } from './ipc/mock-handler';
import { registerOAuth2Handlers } from './ipc/oauth2-handler';
import { registerWsHandlers, closeAllWsConnections } from './ipc/ws-handler';
import { registerSoapHandlers } from './ipc/soap-handler';
import { registerDocsHandlers }     from './ipc/docs-handler';
import { registerContractHandlers } from './ipc/contract-handler';
import { stopAll } from './mock-server';

function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 420,
    height: 280,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#1e1b2e',
    webPreferences: { contextIsolation: true },
  });

  const splashPath = app.isPackaged
    ? join(process.resourcesPath, 'splash.html')
    : join(app.getAppPath(), 'resources/splash.html');

  splash.loadFile(splashPath);
  return splash;
}

function loadAppIcon(): Electron.NativeImage | undefined {
  const pngCandidates = [
    join(app.getAppPath(), 'build/icon.png'),
    join(app.getAppPath(), 'resources/icon.png'),
    join(__dirname, '../../build/icon.png'),
  ];
  for (const p of pngCandidates) {
    if (existsSync(p)) return nativeImage.createFromPath(p);
  }

  const svgCandidates = [
    join(app.getAppPath(), 'resources/icon.svg'),
    join(__dirname, '../../resources/icon.svg'),
  ];
  for (const p of svgCandidates) {
    if (existsSync(p)) {
      const dataUrl = 'data:image/svg+xml;base64,' + readFileSync(p).toString('base64');
      return nativeImage.createFromDataURL(dataUrl);
    }
  }

  return undefined;
}


function createWindow(): void {
  const splash = createSplashWindow();
  const appIcon = loadAppIcon();

  // Set macOS dock icon when available
  if (appIcon && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(appIcon);
  }

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1b2e',
    icon: appIcon,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  win.webContents.once('did-finish-load', () => {
    // Brief pause so the splash is visible even on fast machines
    setTimeout(() => {
      splash.close();
      win.show();
    }, 1200);
  });

  // On Windows the native title bar is shown — include the version in the title
  if (process.platform === 'win32') {
    const version = app.getVersion();
    win.setTitle(`api Spector${version ? ` v${version}` : ''}`);
    win.webContents.on('page-title-updated', e => e.preventDefault());
  }

  // Toggle DevTools with F12 or Cmd/Ctrl+Shift+I
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    const devToolsShortcut =
      input.key === 'F12' ||
      (input.key === 'I' && input.shift && (input.meta || input.control));
    if (devToolsShortcut) win.webContents.toggleDevTools();
  });
}

app.whenReady().then(async () => {
  await initSecretStore(app.getPath('userData'));
  registerFileHandlers(ipcMain);
  registerRequestHandler(ipcMain);
  registerSecretHandlers(ipcMain);
  registerImportHandlers(ipcMain);
  registerGenerateHandlers(ipcMain);
  registerRunnerHandler(ipcMain);
  registerMockHandlers(ipcMain);
  registerOAuth2Handlers(ipcMain);
  registerWsHandlers(ipcMain);
  registerSoapHandlers(ipcMain);
  registerDocsHandlers(ipcMain);
  registerContractHandlers(ipcMain);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  closeAllWsConnections();
  await stopAll();
});
