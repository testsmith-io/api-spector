// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

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
