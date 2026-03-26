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

import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type {
  Collection,
  Environment,
  Workspace,
  AuthConfig,
  SendRequestPayload,
  RequestExecutionResult,
  GenerateOptions,
  GeneratedFile,
  GenerateTarget,
  RunnerPayload,
  RunSummary,
  RunRequestResult,
  MockServer,
  MockRoute,
  MockHit,
  WsMessage,
  ApiRequest,
  ContractRunPayload,
  ContractReport,
  GitStatus,
  GitCommit,
  GitBranch,
  GitRemote,
} from '../shared/types';


// Expose a typed API to the renderer. Note: getSecret is intentionally absent —
// the renderer never holds raw secret values.
const api = {
  // ─── Workspace / File ──────────────────────────────────────────────────────
  openWorkspace: (): Promise<{ workspace: Workspace; workspacePath: string } | null> =>
    ipcRenderer.invoke('file:openWorkspace'),
  getLastWorkspace: (): Promise<{ workspace: Workspace; workspacePath: string } | null> =>
    ipcRenderer.invoke('file:getLastWorkspace'),
  saveWorkspace: (ws: Workspace): Promise<void> =>
    ipcRenderer.invoke('file:saveWorkspace', ws),
  newWorkspace: (): Promise<{ workspace: Workspace; workspacePath: string } | null> =>
    ipcRenderer.invoke('file:newWorkspace'),
  closeWorkspace: (): Promise<void> =>
    ipcRenderer.invoke('file:closeWorkspace'),
  loadCollection: (relPath: string): Promise<Collection> =>
    ipcRenderer.invoke('file:loadCollection', relPath),
  saveCollection: (relPath: string, col: Collection): Promise<void> =>
    ipcRenderer.invoke('file:saveCollection', relPath, col),
  loadEnvironment: (relPath: string): Promise<Environment> =>
    ipcRenderer.invoke('file:loadEnvironment', relPath),
  saveEnvironment: (relPath: string, env: Environment): Promise<void> =>
    ipcRenderer.invoke('file:saveEnvironment', relPath, env),

  // ─── HTTP execution ────────────────────────────────────────────────────────
  sendRequest: (payload: SendRequestPayload): Promise<RequestExecutionResult> =>
    ipcRenderer.invoke('request:send', payload),

  // ─── Secrets (encrypted, master-key-based) ───────────────────────────────
  checkMasterKey: (): Promise<{ set: boolean }> =>
    ipcRenderer.invoke('secret:checkMasterKey'),
  setMasterKey: (value: string): Promise<void> =>
    ipcRenderer.invoke('secret:setMasterKey', value),
  /** Save a named secret to the OS keychain (safeStorage). */
  setSecret: (ref: string, value: string): Promise<void> =>
    ipcRenderer.invoke('secret:set', ref, value),

  // ─── Globals ──────────────────────────────────────────────────────────────
  getGlobals: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke('globals:get'),
  setGlobals: (globals: Record<string, string>): Promise<void> =>
    ipcRenderer.invoke('globals:set', globals),

  // ─── Runner ───────────────────────────────────────────────────────────────
  runCollection: (payload: RunnerPayload): Promise<RunSummary> =>
    ipcRenderer.invoke('runner:start', payload),
  onRunProgress: (cb: (result: RunRequestResult) => void): void => {
    ipcRenderer.on('runner:progress', (_e, result) => cb(result));
  },
  offRunProgress: (): void => {
    ipcRenderer.removeAllListeners('runner:progress');
  },
  saveResults: (content: string, defaultName: string): Promise<boolean> =>
    ipcRenderer.invoke('results:save', content, defaultName),

  // ─── Import ────────────────────────────────────────────────────────────────
  importPostman: (): Promise<Collection | null> =>
    ipcRenderer.invoke('import:postman'),
  importOpenApi: (): Promise<Collection | null> =>
    ipcRenderer.invoke('import:openapi'),
  importOpenApiFromUrl: (url: string): Promise<Collection | null> =>
    ipcRenderer.invoke('import:openapi-url', url),
  importInsomnia: (): Promise<Collection | null> =>
    ipcRenderer.invoke('import:insomnia'),
  importBruno: (): Promise<Collection | null> =>
    ipcRenderer.invoke('import:bruno'),

  // ─── Code generation ──────────────────────────────────────────────────────
  generateCode: (opts: GenerateOptions): Promise<GeneratedFile[]> =>
    ipcRenderer.invoke('generate:code', opts),
  pickOutputDir: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:pickDir'),
  saveGeneratedFiles: (files: GeneratedFile[], outputDir: string): Promise<void> =>
    ipcRenderer.invoke('generate:save', files, outputDir),
  saveGeneratedFilesAsZip: (files: GeneratedFile[], collectionName: string, target: GenerateTarget): Promise<boolean> =>
    ipcRenderer.invoke('generate:saveZip', files, collectionName, target),

  // ─── OAuth 2.0 ────────────────────────────────────────────────────────────
  oauth2StartFlow: (
    auth: AuthConfig,
    vars: Record<string, string>,
  ): Promise<{ accessToken: string; expiresAt: number; refreshToken?: string }> =>
    ipcRenderer.invoke('oauth2:startFlow', auth, vars),

  oauth2RefreshToken: (
    auth: AuthConfig,
    vars: Record<string, string>,
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresAt: number; refreshToken?: string }> =>
    ipcRenderer.invoke('oauth2:refreshToken', auth, vars, refreshToken),

  // ─── Mock servers ─────────────────────────────────────────────────────────────
  mockStart:    (server: MockServer): Promise<void> =>
    ipcRenderer.invoke('mock:start', server),
  mockStop:     (id: string): Promise<void> =>
    ipcRenderer.invoke('mock:stop', id),
  mockIsRunning:(id: string): Promise<boolean> =>
    ipcRenderer.invoke('mock:isRunning', id),
  mockRunningIds: (): Promise<string[]> =>
    ipcRenderer.invoke('mock:runningIds'),
  saveMock:     (relPath: string, server: MockServer): Promise<void> =>
    ipcRenderer.invoke('file:saveMock', relPath, server),
  loadMock:     (relPath: string): Promise<MockServer> =>
    ipcRenderer.invoke('file:loadMock', relPath),
  mockUpdateRoutes: (id: string, routes: MockRoute[]): Promise<void> =>
    ipcRenderer.invoke('mock:updateRoutes', id, routes),
  onMockHit:    (cb: (hit: MockHit) => void): void => {
    ipcRenderer.on('mock:hit', (_e, hit) => cb(hit));
  },
  offMockHit:   (): void => {
    ipcRenderer.removeAllListeners('mock:hit');
  },

  // ─── WebSocket ────────────────────────────────────────────────────────────
  wsConnect: (requestId: string, url: string, headers: Record<string, string>): Promise<void> =>
    ipcRenderer.invoke('ws:connect', requestId, url, headers),

  wsSend: (requestId: string, data: string): Promise<void> =>
    ipcRenderer.invoke('ws:send', requestId, data),

  wsDisconnect: (requestId: string): Promise<void> =>
    ipcRenderer.invoke('ws:disconnect', requestId),

  onWsMessage: (cb: (event: { requestId: string; message: WsMessage }) => void): void => {
    ipcRenderer.on('ws:message', (_e, payload) => cb(payload));
  },

  onWsStatus: (cb: (event: { requestId: string; status: string; error?: string }) => void): void => {
    ipcRenderer.on('ws:status', (_e, payload) => cb(payload));
  },

  offWsEvents: (): void => {
    ipcRenderer.removeAllListeners('ws:message');
    ipcRenderer.removeAllListeners('ws:status');
  },

  // ─── SOAP / WSDL ──────────────────────────────────────────────────────────
  wsdlFetch: (url: string, extraHeaders?: Record<string, string>): Promise<{
    operations: Array<{ name: string; soapAction?: string; inputTemplate: string }>
    targetNamespace: string
  }> => ipcRenderer.invoke('wsdl:fetch', url, extraHeaders ?? {}),

  // ─── Docs generation ──────────────────────────────────────────────────────
  generateDocs: (payload: {
    collections: Array<{ collection: Collection; requests: Record<string, ApiRequest> }>
    format: 'html' | 'markdown'
  }): Promise<string> => ipcRenderer.invoke('docs:generate', payload),

  // ─── Contract testing ─────────────────────────────────────────────────────
  runContracts: (payload: ContractRunPayload): Promise<ContractReport> =>
    ipcRenderer.invoke('contract:run', payload),
  inferContractSchema: (jsonBody: string): Promise<string | null> =>
    ipcRenderer.invoke('contract:inferSchema', jsonBody),

  // ─── Script hooks ─────────────────────────────────────────────────────────
  runScriptHook: (payload: {
    script:         string
    envVars:        Record<string, string>
    collectionVars: Record<string, string>
    globals:        Record<string, string>
  }): Promise<{
    updatedEnvVars:        Record<string, string>
    updatedCollectionVars: Record<string, string>
    updatedGlobals:        Record<string, string>
    consoleOutput:         string[]
    error?:                string
  }> => ipcRenderer.invoke('script:run-hook', payload),

  // ─── Git ──────────────────────────────────────────────────────────────────
  gitIsRepo:     (): Promise<boolean> =>
    ipcRenderer.invoke('git:isRepo'),
  gitInit:       (): Promise<void> =>
    ipcRenderer.invoke('git:init'),
  gitStatus:     (): Promise<GitStatus> =>
    ipcRenderer.invoke('git:status'),
  gitDiff:       (filePath?: string): Promise<string> =>
    ipcRenderer.invoke('git:diff', filePath),
  gitDiffStaged: (filePath?: string): Promise<string> =>
    ipcRenderer.invoke('git:diffStaged', filePath),
  gitStage:      (paths: string[]): Promise<void> =>
    ipcRenderer.invoke('git:stage', paths),
  gitUnstage:    (paths: string[]): Promise<void> =>
    ipcRenderer.invoke('git:unstage', paths),
  gitStageAll:   (): Promise<void> =>
    ipcRenderer.invoke('git:stageAll'),
  gitCommit:     (message: string): Promise<void> =>
    ipcRenderer.invoke('git:commit', message),
  gitLog:        (limit?: number): Promise<GitCommit[]> =>
    ipcRenderer.invoke('git:log', limit),
  gitBranches:   (): Promise<GitBranch[]> =>
    ipcRenderer.invoke('git:branches'),
  gitCheckout:   (branch: string, create: boolean): Promise<void> =>
    ipcRenderer.invoke('git:checkout', branch, create),
  gitPull:       (): Promise<void> =>
    ipcRenderer.invoke('git:pull'),
  gitPush:       (setUpstream: boolean): Promise<void> =>
    ipcRenderer.invoke('git:push', setUpstream),
  gitRemotes:      (): Promise<GitRemote[]> =>
    ipcRenderer.invoke('git:remotes'),
  gitAddRemote:    (name: string, url: string): Promise<void> =>
    ipcRenderer.invoke('git:addRemote', name, url),
  gitSetRemoteUrl: (name: string, url: string): Promise<void> =>
    ipcRenderer.invoke('git:setRemoteUrl', name, url),
  gitRemoveRemote: (name: string): Promise<void> =>
    ipcRenderer.invoke('git:removeRemote', name),
  gitWriteCiFile:  (relPath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('git:writeCiFile', relPath, content),

  // ─── Zoom ─────────────────────────────────────────────────────────────────
  setZoomFactor: (factor: number): void => webFrame.setZoomFactor(factor),

  // ─── Platform ─────────────────────────────────────────────────────────────
  platform: process.platform as string,
};

contextBridge.exposeInMainWorld('electron', api);

export type ElectronAPI = typeof api
