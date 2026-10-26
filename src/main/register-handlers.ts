// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// All IPC handler registrations in one composable call. Extracted from the
// app's startup so the same backend can be hosted by another Electron process
// (e.g. the webinar presenter, which embeds the app's renderer in a <webview>
// and re-hosts these handlers). The normal app calls this during whenReady; its
// behaviour is unchanged.

import { BrowserWindow, type IpcMain, type WebContents } from 'electron';
import { IPC } from '../shared/ipc-channels';
import { handleIpc } from './ipc/handle';
import { registerFileHandlers } from './ipc/file-handler';
import { registerRequestHandler } from './ipc/request-handler';
import { registerSecretHandlers } from './ipc/secret-handler';
import { registerAiHandlers } from './ipc/ai-handler';
import { registerImportHandlers } from './ipc/import-handler';
import { registerGenerateHandlers } from './ipc/generate-handler';
import { registerRunnerHandler } from './ipc/runner-handler';
import { registerFlowHandler } from './ipc/flow-handler';
import { registerMockHandlers } from './ipc/mock-handler';
import { registerOAuth2Handlers } from './ipc/oauth2-handler';
import { registerVaultHandlers } from './ipc/vault-handler';
import { registerWsHandlers } from './ipc/ws-handler';
import { registerSocketIoHandlers } from './ipc/socketio-handler';
import { registerJqHandlers } from './ipc/jq-handler';
import { registerGraphqlWsHandlers } from './ipc/graphqlws-handler';
import { registerMqttHandlers } from './ipc/mqtt-handler';
import { registerPerfHandlers } from './ipc/perf-handler';
import { registerGrpcHandlers } from './ipc/grpc-handler';
import { registerSoapHandlers } from './ipc/soap-handler';
import { registerDocsHandlers } from './ipc/docs-handler';
import { registerCoverageHandlers } from './ipc/coverage-handler';
import { registerContractHandlers } from './ipc/contract-handler';
import { registerGitHandlers } from './ipc/git-handler';
import { registerRecordHandlers } from './ipc/record-handler';
import { registerCloudHandlers } from './ipc/cloud-handler';

export interface RegisterHandlersOptions {
  /** WebContents the recorder streams into; defaults to the first window's. */
  getRecordWebContents?: () => WebContents | null
  /** Open an external URL; defaults to shell.openExternal. */
  openExternal?: (url: string) => void
  /** Update-check hooks (no-ops by default — only the shipped app wires these). */
  checkUpdate?: () => unknown
  updateMode?: () => unknown
  installUpdate?: () => unknown
}

export function registerAllHandlers(ipc: IpcMain, opts: RegisterHandlersOptions = {}): void {
  registerFileHandlers(ipc);
  registerRequestHandler(ipc);
  registerSecretHandlers(ipc);
  registerAiHandlers(ipc);
  registerImportHandlers(ipc);
  registerGenerateHandlers(ipc);
  registerRunnerHandler(ipc);
  registerFlowHandler(ipc);
  registerMockHandlers(ipc);
  registerOAuth2Handlers(ipc);
  registerVaultHandlers(ipc);
  registerWsHandlers(ipc);
  registerSocketIoHandlers(ipc);
  registerJqHandlers(ipc);
  registerGraphqlWsHandlers(ipc);
  registerMqttHandlers(ipc);
  registerPerfHandlers(ipc);
  registerGrpcHandlers(ipc);
  registerSoapHandlers(ipc);
  registerDocsHandlers(ipc);
  registerCoverageHandlers(ipc);
  registerContractHandlers(ipc);
  registerGitHandlers(ipc);
  registerRecordHandlers(ipc, opts.getRecordWebContents ?? (() => BrowserWindow.getAllWindows()[0]?.webContents ?? null));
  registerCloudHandlers(ipc);

  if (opts.openExternal)  handleIpc(ipc, IPC.shell.openExternal, (_e, url: string) => opts.openExternal!(url));
  if (opts.checkUpdate)   handleIpc(ipc, IPC.app.checkUpdate,   () => opts.checkUpdate!());
  if (opts.updateMode)    handleIpc(ipc, IPC.app.updateMode,    () => opts.updateMode!());
  if (opts.installUpdate) handleIpc(ipc, IPC.app.installUpdate, () => opts.installUpdate!());
}
