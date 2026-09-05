// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// ─── IPC channel registry ─────────────────────────────────────────────────────
//
// Single source of truth for every IPC channel name used between the renderer
// (via the preload bridge) and the main process. Both sides import from here,
// so a typo becomes a compile error instead of a silently dead channel.
//
// Values must stay byte-identical to the historical string literals — they are
// the wire protocol between preload and main.
//
// Most channels are invoke/handle pairs; a few are one-way event channels
// pushed from main via `webContents.send` and consumed with `ipcRenderer.on`
// (runner.progress, mock.hit, ws.message, ws.status, record.hit).

export const IPC = {
  // ─── Workspace / File ──────────────────────────────────────────────────────
  file: {
    openWorkspace:       'file:openWorkspace',
    openWorkspacePath:   'file:openWorkspacePath',
    getLastWorkspace:    'file:getLastWorkspace',
    getRecentWorkspaces: 'file:getRecentWorkspaces',
    saveWorkspace:       'file:saveWorkspace',
    newWorkspace:        'file:newWorkspace',
    closeWorkspace:      'file:closeWorkspace',
    loadCollection:      'file:loadCollection',
    saveCollection:      'file:saveCollection',
    loadEnvironment:     'file:loadEnvironment',
    saveEnvironment:     'file:saveEnvironment',
    deleteWorkspaceFile: 'file:deleteWorkspaceFile',
    saveMock:            'file:saveMock',
    loadMock:            'file:loadMock',
    loadHistory:         'file:loadHistory',
    saveHistory:         'file:saveHistory',
  },

  // ─── Native dialogs ────────────────────────────────────────────────────────
  dialog: {
    pickDir: 'dialog:pickDir',
  },

  // ─── HTTP execution ────────────────────────────────────────────────────────
  request: {
    send: 'request:send',
    /** Event (main→renderer): a batch of streamed response frames. */
    streamEvent: 'request:stream-event',
    /** Renderer→main: abort an in-flight streamed read by streamId. */
    stopStream: 'request:stop-stream',
  },

  // ─── Secrets ───────────────────────────────────────────────────────────────
  secret: {
    checkMasterKey: 'secret:checkMasterKey',
    setMasterKey:   'secret:setMasterKey',
    set:            'secret:set',
  },

  // ─── Global variables ──────────────────────────────────────────────────────
  globals: {
    get: 'globals:get',
    set: 'globals:set',
  },

  // ─── Collection runner ─────────────────────────────────────────────────────
  runner: {
    start:    'runner:start',
    /** Event: per-request progress pushed from main during a run. */
    progress: 'runner:progress',
  },

  // ─── Run results export ────────────────────────────────────────────────────
  results: {
    save: 'results:save',
  },

  // ─── Import ────────────────────────────────────────────────────────────────
  import: {
    postman:           'import:postman',
    openapi:           'import:openapi',
    openapiUrl:        'import:openapi-url',
    insomnia:          'import:insomnia',
    bruno:             'import:bruno',
    http:              'import:http',
    spector:           'import:spector',
    openapiSchemas:    'import:openapi-schemas',
    openapiSchemasUrl: 'import:openapi-schemas-url',
  },

  // ─── Code generation ───────────────────────────────────────────────────────
  generate: {
    code:    'generate:code',
    save:    'generate:save',
    saveZip: 'generate:saveZip',
  },

  // ─── OAuth 2.0 ─────────────────────────────────────────────────────────────
  oauth2: {
    startFlow:    'oauth2:startFlow',
    refreshToken: 'oauth2:refreshToken',
  },

  // ─── HashiCorp Vault (interactive OIDC login) ──────────────────────────────
  vault: {
    oidcLogin: 'vault:oidcLogin',
  },

  // ─── Mock servers ──────────────────────────────────────────────────────────
  mock: {
    start:        'mock:start',
    stop:         'mock:stop',
    isRunning:    'mock:isRunning',
    runningIds:   'mock:runningIds',
    updateRoutes: 'mock:updateRoutes',
    /** Event: a mock server route was hit. */
    hit:          'mock:hit',
  },

  // ─── WebSocket ─────────────────────────────────────────────────────────────
  ws: {
    connect:    'ws:connect',
    send:       'ws:send',
    disconnect: 'ws:disconnect',
    /** Event: inbound/outbound WS message. */
    message:    'ws:message',
    /** Event: connection status change. */
    status:     'ws:status',
  },

  // ─── SOAP / WSDL ───────────────────────────────────────────────────────────
  wsdl: {
    fetch:  'wsdl:fetch',
    import: 'wsdl:import',
  },

  // ─── gRPC ──────────────────────────────────────────────────────────────────
  grpc: {
    /** Load a .proto (source or path) and enumerate its services/methods. */
    loadProto: 'grpc:loadProto',
    /** Invoke a method (unary or server-streaming). Streams back messages. */
    invoke:    'grpc:invoke',
    /** Cancel an in-flight call. */
    cancel:    'grpc:cancel',
    /** Event: a received message frame. */
    message:   'grpc:message',
    /** Event: call status change (running / completed / error, with code). */
    status:    'grpc:status',
  },

  // ─── Docs generation ───────────────────────────────────────────────────────
  docs: {
    generate: 'docs:generate',
  },

  // ─── OpenAPI coverage ────────────────────────────────────────────────────────
  coverage: {
    /** Read + parse an OpenAPI spec (file path, URL, or raw text). */
    loadSpec: 'coverage:loadSpec',
  },

  // ─── Contract testing ──────────────────────────────────────────────────────
  contract: {
    run:              'contract:run',
    inferSchema:      'contract:inferSchema',
    exportReportHtml: 'contract:exportReportHtml',
    /** Compile a design-first contract to a Pact file on disk (save dialog). */
    exportDesignPact: 'contract:exportDesignPact',
    captureSnapshot:  'contract:captureSnapshot',
    listSnapshots:    'contract:listSnapshots',
    loadSnapshot:     'contract:loadSnapshot',
    deleteSnapshot:   'contract:deleteSnapshot',
    recordResult:     'contract:recordResult',
    fuzz:             'contract:fuzz',
  },

  // ─── Script hooks ──────────────────────────────────────────────────────────
  script: {
    runHook: 'script:run-hook',
  },

  // ─── Git ───────────────────────────────────────────────────────────────────
  git: {
    isRepo:         'git:isRepo',
    init:           'git:init',
    status:         'git:status',
    diff:           'git:diff',
    diffStaged:     'git:diffStaged',
    stage:          'git:stage',
    unstage:        'git:unstage',
    stageAll:       'git:stageAll',
    commit:         'git:commit',
    log:            'git:log',
    branches:       'git:branches',
    checkout:       'git:checkout',
    deleteBranch:   'git:deleteBranch',
    pull:           'git:pull',
    push:           'git:push',
    remotes:        'git:remotes',
    addRemote:      'git:addRemote',
    setRemoteUrl:   'git:setRemoteUrl',
    removeRemote:   'git:removeRemote',
    writeCiFile:    'git:writeCiFile',
    resolveOurs:    'git:resolveOurs',
    resolveTheirs:  'git:resolveTheirs',
    markResolved:   'git:markResolved',
  },

  // ─── Recorder ──────────────────────────────────────────────────────────────
  record: {
    start:     'record:start',
    stop:      'record:stop',
    isRunning: 'record:isRunning',
    entries:   'record:entries',
    toMock:    'record:toMock',
    /** Event: a recorded proxy entry was captured. */
    hit:       'record:hit',
  },

  // ─── Shell ─────────────────────────────────────────────────────────────────
  shell: {
    openExternal: 'shell:openExternal',
  },

  // ─── App ───────────────────────────────────────────────────────────────────
  app: {
    checkUpdate: 'app:checkUpdate',
  },

  // ─── Cloud (API Spector Cloud integration) ──────────────────────────────────
  cloud: {
    /** Verify the endpoint + token (GET /api/me). */
    test:        'cloud:test',
    /** Push a mock server definition (POST /api/mocks). */
    pushMock:    'cloud:pushMock',
    /** Look up an existing cloud mock's routes (GET /api/mocks/{slug}). */
    getMock:     'cloud:getMock',
    /** Push a request as a monitor, URL resolved (POST /api/monitors). */
    pushMonitor: 'cloud:pushMonitor',
    /** Publish a consumer pact built from requests (PUT /api/contracts). */
    pushPact:    'cloud:pushPact',
    /** Publish a design-first consumer contract as a pact (PUT /api/contracts). */
    pushDesignContract: 'cloud:pushDesignContract',
    /** Publish a provider OpenAPI spec (PUT /api/provider-contracts). */
    pushSpec:    'cloud:pushSpec',
    /** Open the cloud deployment matrix in the browser. */
    openMatrix:  'cloud:openMatrix',
  },
} as const;
