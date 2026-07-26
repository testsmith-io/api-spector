// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { IPC } from '../shared/ipc-channels';
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
  FuzzReport,
  HistoryEntry,
  ContractSnapshot,
  GitStatus,
  GitCommit,
  GitBranch,
  GitRemote,
  RecorderConfig,
  RecordedEntry,
  RecordingSession,
} from '../shared/types';


// Expose a typed API to the renderer. Note: getSecret is intentionally absent —
// the renderer never holds raw secret values.
const api = {
  // ─── Workspace / File ──────────────────────────────────────────────────────
  openWorkspace: (): Promise<{ workspace: Workspace; workspacePath: string } | null> =>
    ipcRenderer.invoke(IPC.file.openWorkspace),
  getLastWorkspace: (): Promise<{ workspace: Workspace; workspacePath: string } | null> =>
    ipcRenderer.invoke(IPC.file.getLastWorkspace),
  saveWorkspace: (ws: Workspace): Promise<void> =>
    ipcRenderer.invoke(IPC.file.saveWorkspace, ws),
  newWorkspace: (): Promise<{ workspace: Workspace; workspacePath: string } | null> =>
    ipcRenderer.invoke(IPC.file.newWorkspace),
  closeWorkspace: (): Promise<void> =>
    ipcRenderer.invoke(IPC.file.closeWorkspace),
  loadCollection: (relPath: string): Promise<Collection> =>
    ipcRenderer.invoke(IPC.file.loadCollection, relPath),
  saveCollection: (relPath: string, col: Collection): Promise<void> =>
    ipcRenderer.invoke(IPC.file.saveCollection, relPath, col),
  loadEnvironment: (relPath: string): Promise<Environment> =>
    ipcRenderer.invoke(IPC.file.loadEnvironment, relPath),
  saveEnvironment: (relPath: string, env: Environment): Promise<void> =>
    ipcRenderer.invoke(IPC.file.saveEnvironment, relPath, env),
  /** Idempotent unlink of a workspace-relative file. Used by collection /
   *  environment / mock delete flows so the file is removed from disk, not
   *  just from the workspace manifest. */
  deleteWorkspaceFile: (relPath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.file.deleteWorkspaceFile, relPath),
  loadHistory: (): Promise<HistoryEntry[]> =>
    ipcRenderer.invoke(IPC.file.loadHistory) as Promise<HistoryEntry[]>,
  saveHistory: (entries: HistoryEntry[]): Promise<void> =>
    ipcRenderer.invoke(IPC.file.saveHistory, entries),

  // ─── HTTP execution ────────────────────────────────────────────────────────
  sendRequest: (payload: SendRequestPayload): Promise<RequestExecutionResult> =>
    ipcRenderer.invoke(IPC.request.send, payload),

  // ─── Secrets (encrypted, master-key-based) ───────────────────────────────
  checkMasterKey: (): Promise<{ set: boolean }> =>
    ipcRenderer.invoke(IPC.secret.checkMasterKey),
  setMasterKey: (value: string): Promise<void> =>
    ipcRenderer.invoke(IPC.secret.setMasterKey, value),
  /** Save a named secret to the OS keychain (safeStorage). */
  setSecret: (ref: string, value: string): Promise<void> =>
    ipcRenderer.invoke(IPC.secret.set, ref, value),

  // ─── Globals ──────────────────────────────────────────────────────────────
  getGlobals: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke(IPC.globals.get),
  setGlobals: (globals: Record<string, string>): Promise<void> =>
    ipcRenderer.invoke(IPC.globals.set, globals),

  // ─── Runner ───────────────────────────────────────────────────────────────
  runCollection: (payload: RunnerPayload): Promise<RunSummary> =>
    ipcRenderer.invoke(IPC.runner.start, payload),
  onRunProgress: (cb: (result: RunRequestResult) => void): void => {
    ipcRenderer.on(IPC.runner.progress, (_e, result) => cb(result));
  },
  offRunProgress: (): void => {
    ipcRenderer.removeAllListeners(IPC.runner.progress);
  },
  saveResults: (content: string, defaultName: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.results.save, content, defaultName),

  // ─── Import ────────────────────────────────────────────────────────────────
  importPostman: (): Promise<Collection | null> =>
    ipcRenderer.invoke(IPC.import.postman),
  importOpenApi: (): Promise<Collection | null> =>
    ipcRenderer.invoke(IPC.import.openapi),
  importOpenApiFromUrl: (url: string): Promise<Collection | null> =>
    ipcRenderer.invoke(IPC.import.openapiUrl, url),
  importInsomnia: (): Promise<Collection | null> =>
    ipcRenderer.invoke(IPC.import.insomnia),
  importBruno: (): Promise<Collection | null> =>
    ipcRenderer.invoke(IPC.import.bruno),
  importHttpFile: (): Promise<Collection | null> =>
    ipcRenderer.invoke(IPC.import.http),
  /** Extract response-body schemas from an OpenAPI spec file (no full import). */
  extractOpenApiSchemas: (): Promise<{ method: string; pathTemplate: string; pathRewritten: string; schema: string; operationId?: string; summary?: string }[] | null> =>
    ipcRenderer.invoke(IPC.import.openapiSchemas),
  /** Extract response-body schemas from an OpenAPI spec URL (no full import). */
  extractOpenApiSchemasFromUrl: (url: string): Promise<{ method: string; pathTemplate: string; pathRewritten: string; schema: string; operationId?: string; summary?: string }[]> =>
    ipcRenderer.invoke(IPC.import.openapiSchemasUrl, url),

  // ─── Code generation ──────────────────────────────────────────────────────
  generateCode: (opts: GenerateOptions): Promise<GeneratedFile[]> =>
    ipcRenderer.invoke(IPC.generate.code, opts),
  pickOutputDir: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.dialog.pickDir),
  saveGeneratedFiles: (files: GeneratedFile[], outputDir: string): Promise<void> =>
    ipcRenderer.invoke(IPC.generate.save, files, outputDir),
  saveGeneratedFilesAsZip: (files: GeneratedFile[], collectionName: string, target: GenerateTarget): Promise<boolean> =>
    ipcRenderer.invoke(IPC.generate.saveZip, files, collectionName, target),

  // ─── OAuth 2.0 ────────────────────────────────────────────────────────────
  oauth2StartFlow: (
    auth: AuthConfig,
    vars: Record<string, string>,
  ): Promise<{ accessToken: string; expiresAt: number; refreshToken?: string }> =>
    ipcRenderer.invoke(IPC.oauth2.startFlow, auth, vars),

  oauth2RefreshToken: (
    auth: AuthConfig,
    vars: Record<string, string>,
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresAt: number; refreshToken?: string }> =>
    ipcRenderer.invoke(IPC.oauth2.refreshToken, auth, vars, refreshToken),

  // ─── Mock servers ─────────────────────────────────────────────────────────────
  mockStart:    (server: MockServer): Promise<void> =>
    ipcRenderer.invoke(IPC.mock.start, server),
  mockStop:     (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.mock.stop, id),
  mockIsRunning:(id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.mock.isRunning, id),
  mockRunningIds: (): Promise<string[]> =>
    ipcRenderer.invoke(IPC.mock.runningIds),
  saveMock:     (relPath: string, server: MockServer): Promise<void> =>
    ipcRenderer.invoke(IPC.file.saveMock, relPath, server),
  loadMock:     (relPath: string): Promise<MockServer> =>
    ipcRenderer.invoke(IPC.file.loadMock, relPath),
  mockUpdateRoutes: (id: string, routes: MockRoute[]): Promise<void> =>
    ipcRenderer.invoke(IPC.mock.updateRoutes, id, routes),
  onMockHit:    (cb: (hit: MockHit) => void): void => {
    ipcRenderer.on(IPC.mock.hit, (_e, hit) => cb(hit));
  },
  offMockHit:   (): void => {
    ipcRenderer.removeAllListeners(IPC.mock.hit);
  },

  // ─── WebSocket ────────────────────────────────────────────────────────────
  wsConnect: (requestId: string, url: string, headers: Record<string, string>): Promise<void> =>
    ipcRenderer.invoke(IPC.ws.connect, requestId, url, headers),

  wsSend: (requestId: string, data: string): Promise<void> =>
    ipcRenderer.invoke(IPC.ws.send, requestId, data),

  wsDisconnect: (requestId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.ws.disconnect, requestId),

  onWsMessage: (cb: (event: { requestId: string; message: WsMessage }) => void): void => {
    ipcRenderer.on(IPC.ws.message, (_e, payload) => cb(payload));
  },

  onWsStatus: (cb: (event: { requestId: string; status: string; error?: string }) => void): void => {
    ipcRenderer.on(IPC.ws.status, (_e, payload) => cb(payload));
  },

  offWsEvents: (): void => {
    ipcRenderer.removeAllListeners(IPC.ws.message);
    ipcRenderer.removeAllListeners(IPC.ws.status);
  },

  // ─── SOAP / WSDL ──────────────────────────────────────────────────────────
  wsdlFetch: (url: string, extraHeaders?: Record<string, string>): Promise<{
    operations: Array<{
      name: string
      binding?: string
      soapAction?: string
      soapVersion: '1.1' | '1.2'
      endpoint?: string
      inputTemplate: string
      params?: Array<{ name: string; typeHint: string; children?: unknown[] }>
    }>
    endpoints: Array<{ binding: string; address: string; soapVersion: '1.1' | '1.2' }>
    targetNamespace: string
  }> => ipcRenderer.invoke(IPC.wsdl.fetch, url, extraHeaders ?? {}),

  /** Build a Collection + MockServer from a WSDL. Renderer registers the
   *  returned objects via the usual loadCollection/loadMock + save flows. */
  wsdlImport: (opts: { url?: string; xml?: string; name?: string; existingMockPorts?: number[] }) =>
    ipcRenderer.invoke(IPC.wsdl.import, opts) as Promise<{
      parsed: { targetNamespace: string; endpoints: Array<{ binding: string; address: string; soapVersion: '1.1' | '1.2' }>; operations: unknown[] }
      collection: Collection
      mock: MockServer
    }>,

  // ─── Docs generation ──────────────────────────────────────────────────────
  generateDocs: (payload: {
    collections: Array<{ collection: Collection; requests: Record<string, ApiRequest> }>
    format: 'html' | 'markdown'
    /** Captured example exchanges (request body + response body) keyed by
     *  requestId. The docs handler appends them as "Example Request/Response"
     *  blocks so docs include real data, not just templates. */
    examples?: Record<string, { sent?: unknown; response?: unknown }>
  }): Promise<string> => ipcRenderer.invoke(IPC.docs.generate, payload),

  // ─── Contract testing ─────────────────────────────────────────────────────
  runContracts: (payload: ContractRunPayload): Promise<ContractReport> =>
    ipcRenderer.invoke(IPC.contract.run, payload),
  inferContractSchema: (jsonBody: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.contract.inferSchema, jsonBody),
  exportContractReportHtml: (
    report: ContractReport,
    meta?: { title?: string; provider?: string; consumer?: string; spec?: string },
  ): Promise<boolean> =>
    ipcRenderer.invoke(IPC.contract.exportReportHtml, report, meta),
  captureContractSnapshot: (opts: { specUrl?: string; specPath?: string; name?: string }) =>
    ipcRenderer.invoke(IPC.contract.captureSnapshot, opts) as Promise<{ relPath: string; snapshot: ContractSnapshot }>,
  listContractSnapshots: (registered: string[] = []) =>
    ipcRenderer.invoke(IPC.contract.listSnapshots, registered) as Promise<Array<{ relPath: string; snapshot: ContractSnapshot }>>,
  loadContractSnapshot: (relPath: string) =>
    ipcRenderer.invoke(IPC.contract.loadSnapshot, relPath) as Promise<ContractSnapshot>,
  deleteContractSnapshot: (relPath: string) =>
    ipcRenderer.invoke(IPC.contract.deleteSnapshot, relPath) as Promise<void>,
  recordContractResult: (opts: { pacticipant: string; version: string; report: ContractReport }) =>
    ipcRenderer.invoke(IPC.contract.recordResult, opts) as Promise<{ file: string }>,
  fuzzContracts: (payload: {
    requests: ApiRequest[]
    envVars: Record<string, string>
    collectionVars?: Record<string, string>
    specUrl?: string
    specSnapshotRelPath?: string
    providerBaseUrl?: string
    requestBaseUrl?: string
    casesPerOperation?: number
    seed?: number
    includeWrites?: boolean
    strictStatus?: boolean
    checkResponses?: boolean
    trace?: boolean
  }): Promise<FuzzReport> =>
    ipcRenderer.invoke(IPC.contract.fuzz, payload) as Promise<FuzzReport>,

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
  }> => ipcRenderer.invoke(IPC.script.runHook, payload),

  // ─── Git ──────────────────────────────────────────────────────────────────
  gitIsRepo:     (): Promise<boolean> =>
    ipcRenderer.invoke(IPC.git.isRepo),
  gitInit:       (): Promise<void> =>
    ipcRenderer.invoke(IPC.git.init),
  gitStatus:     (): Promise<GitStatus> =>
    ipcRenderer.invoke(IPC.git.status),
  gitDiff:       (filePath?: string): Promise<string> =>
    ipcRenderer.invoke(IPC.git.diff, filePath),
  gitDiffStaged: (filePath?: string): Promise<string> =>
    ipcRenderer.invoke(IPC.git.diffStaged, filePath),
  gitStage:      (paths: string[]): Promise<void> =>
    ipcRenderer.invoke(IPC.git.stage, paths),
  gitUnstage:    (paths: string[]): Promise<void> =>
    ipcRenderer.invoke(IPC.git.unstage, paths),
  gitStageAll:   (): Promise<void> =>
    ipcRenderer.invoke(IPC.git.stageAll),
  gitCommit:     (message: string): Promise<void> =>
    ipcRenderer.invoke(IPC.git.commit, message),
  gitLog:        (limit?: number): Promise<GitCommit[]> =>
    ipcRenderer.invoke(IPC.git.log, limit),
  gitBranches:   (): Promise<GitBranch[]> =>
    ipcRenderer.invoke(IPC.git.branches),
  gitCheckout:   (branch: string, create: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.git.checkout, branch, create),
  gitDeleteBranch: (name: string, force = false): Promise<void> =>
    ipcRenderer.invoke(IPC.git.deleteBranch, name, force),
  gitPull:       (): Promise<void> =>
    ipcRenderer.invoke(IPC.git.pull),
  gitPush:       (setUpstream: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.git.push, setUpstream),
  gitRemotes:      (): Promise<GitRemote[]> =>
    ipcRenderer.invoke(IPC.git.remotes),
  gitAddRemote:    (name: string, url: string): Promise<void> =>
    ipcRenderer.invoke(IPC.git.addRemote, name, url),
  gitSetRemoteUrl: (name: string, url: string): Promise<void> =>
    ipcRenderer.invoke(IPC.git.setRemoteUrl, name, url),
  gitRemoveRemote: (name: string): Promise<void> =>
    ipcRenderer.invoke(IPC.git.removeRemote, name),
  gitWriteCiFile:  (relPath: string, content: string): Promise<void> =>
    ipcRenderer.invoke(IPC.git.writeCiFile, relPath, content),
  gitResolveOurs:   (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.git.resolveOurs, filePath),
  gitResolveTheirs: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.git.resolveTheirs, filePath),
  gitMarkResolved:  (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.git.markResolved, filePath),

  // ─── Recorder ─────────────────────────────────────────────────────────────
  recordStart:    (config: RecorderConfig): Promise<void> =>
    ipcRenderer.invoke(IPC.record.start, config),
  recordStop:     (): Promise<RecordingSession> =>
    ipcRenderer.invoke(IPC.record.stop),
  recordIsRunning: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC.record.isRunning),
  recordEntries:  (): Promise<RecordedEntry[]> =>
    ipcRenderer.invoke(IPC.record.entries),
  recordToMock:   (entries: RecordedEntry[], upstream: string, name: string, port: number): Promise<MockServer> =>
    ipcRenderer.invoke(IPC.record.toMock, entries, upstream, name, port),
  onRecordHit:    (cb: (entry: RecordedEntry) => void): void => {
    ipcRenderer.on(IPC.record.hit, (_e, entry) => cb(entry));
  },
  offRecordHit:   (): void => {
    ipcRenderer.removeAllListeners(IPC.record.hit);
  },

  // ─── Shell ────────────────────────────────────────────────────────────────
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.shell.openExternal, url),

  // ─── Zoom ─────────────────────────────────────────────────────────────────
  setZoomFactor: (factor: number): void => webFrame.setZoomFactor(factor),

  // ─── Platform ─────────────────────────────────────────────────────────────
  platform: process.platform as string,
};

contextBridge.exposeInMainWorld('electron', api);

export type ElectronAPI = typeof api
