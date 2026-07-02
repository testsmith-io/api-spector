// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { type IpcMain, type WebContents } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import type { RecorderConfig, RecordingSession } from '../../shared/types';
import {
  startRecorder, stopRecorder, isRecorderRunning,
  getRecorderEntries, setRecorderHitCallback,
  entriesToMockServer,
} from '../recorder';

export function registerRecordHandlers(ipc: IpcMain, getWebContents: () => WebContents | null): void {

  handleIpc(ipc, IPC.record.start, async (_e, config: RecorderConfig) => {
    await startRecorder(config);
    setRecorderHitCallback(entry => {
      getWebContents()?.send(IPC.record.hit, entry);
    });
  });

  handleIpc(ipc, IPC.record.stop, async (): Promise<RecordingSession> => {
    const session = stopRecorder();
    setRecorderHitCallback(null);
    return session;
  });

  handleIpc(ipc, IPC.record.isRunning, () => isRecorderRunning());

  handleIpc(ipc, IPC.record.entries, () => getRecorderEntries());

  handleIpc(ipc, IPC.record.toMock, (_e, entries: RecordingSession['entries'], upstream: string, name: string, port: number) => {
    return entriesToMockServer(entries, upstream, name, port);
  });
}
