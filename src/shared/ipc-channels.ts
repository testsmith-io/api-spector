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
    getLastWorkspace:    'file:getLastWorkspace',
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
  },

  // ─── Native dialogs ────────────────────────────────────────────────────────
  dialog: {
    pickDir: 'dialog:pickDir',
  },

  // ─── HTTP execution ────────────────────────────────────────────────────────
  request: {
    send: 'request:send',
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

  // ─── Docs generation ───────────────────────────────────────────────────────
  docs: {
    generate: 'docs:generate',
  },

  // ─── Contract testing ──────────────────────────────────────────────────────
  contract: {
    run:              'contract:run',
    inferSchema:      'contract:inferSchema',
    exportReportHtml: 'contract:exportReportHtml',
    captureSnapshot:  'contract:captureSnapshot',
    listSnapshots:    'contract:listSnapshots',
    loadSnapshot:     'contract:loadSnapshot',
    deleteSnapshot:   'contract:deleteSnapshot',
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
} as const;
