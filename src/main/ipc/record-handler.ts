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

import { type IpcMain, type WebContents } from 'electron';
import type { RecorderConfig, RecordingSession } from '../../shared/types';
import {
  startRecorder, stopRecorder, isRecorderRunning,
  getRecorderEntries, setRecorderHitCallback,
  entriesToMockServer,
} from '../recorder';

export function registerRecordHandlers(ipc: IpcMain, getWebContents: () => WebContents | null): void {

  ipc.handle('record:start', async (_e, config: RecorderConfig) => {
    await startRecorder(config);
    setRecorderHitCallback(entry => {
      getWebContents()?.send('record:hit', entry);
    });
  });

  ipc.handle('record:stop', async (): Promise<RecordingSession> => {
    const session = stopRecorder();
    setRecorderHitCallback(null);
    return session;
  });

  ipc.handle('record:isRunning', () => isRecorderRunning());

  ipc.handle('record:entries', () => getRecorderEntries());

  ipc.handle('record:toMock', (_e, entries: RecordingSession['entries'], upstream: string, name: string, port: number) => {
    return entriesToMockServer(entries, upstream, name, port);
  });
}
