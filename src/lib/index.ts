// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Engine library entry. Node-only re-exports of the mock engine and request runner
// so other programs (e.g. the cloud) can embed them instead of shelling out to the
// CLI. Same graphs the `mock` and `run` CLI commands use; no Electron dependency.

// Mock engine. Stateless use: updateMockRoutes(id, routes) to register, then
// handleRequest(id, req, res, Date.now()) per request. Handles path matching,
// per-route scripts, faker/dayjs body interpolation, and delays.
export {
  startMock,
  stopMock,
  stopAll,
  updateMockRoutes,
  setHitCallback,
  isRunning,
  getRunningIds,
  handleRequest,
  findRoute,
} from '../main/mock-server';

// Request runner engine. executeRunnerRequest() runs one ApiRequest headlessly with
// pre/post scripts, dynamic/faker variables, and assertions, returning the response
// plus test results. Powers monitors running tests exported from the desktop app.
export {
  executeRunnerRequest,
  performHttpExchange,
  buildDispatcher,
  applyRequestDefaults,
  deriveRunStatus,
  syntheticHttpFailure,
  buildSchemaTestResults,
  buildProtocolFaultTests,
  maskPii,
  maskHeaders,
  HookSkipTracker,
} from '../main/request-exec';

export type {
  RunnerExecOptions,
  RunnerExecResult,
  ExchangeOptions,
  ExchangeResult,
  ProxyConfig,
  TlsConfig,
} from '../main/request-exec';

// External secret managers (HashiCorp Vault, ...). The engine resolves `vault:...`
// (and any registered scheme) references in auth and env vars automatically. Register
// backends via registerSecretProvider; set connection config with setSecretsConfig.
export {
  registerSecretProvider,
  registeredSchemes,
  hasSecretScheme,
  resolveExternalSecret,
  setSecretsConfig,
} from '../main/secrets';
export type { SecretProvider, SecretResolveContext } from '../main/secrets';

// Flow engine. runFlowHeadless() runs a whole flow (request/logic/loop/visualize
// blocks) headlessly, resolving request blocks from a pre-baked map. Called by the
// cloud `runtime/flow` worker, with semantics identical to the desktop app and CLI.
export { runFlowHeadless } from '../main/flow-run';
export type { HeadlessFlowInput } from '../main/flow-run';
export { runFlow } from '../shared/flow-engine';
export type {
  FlowRunSummary,
  FlowRunEvent,
  FlowBlockRunRecord,
  FlowEngineDeps,
} from '../shared/flow-engine';
export { normalizeFlow, BLOCK_SPECS } from '../shared/flow-blocks';

// Shared types
export type {
  MockServer,
  MockRoute,
  MockHit,
  ApiRequest,
  HttpMethod,
  TestResult,
  KeyValuePair,
  AuthConfig,
  Flow,
  FlowBlock,
  FlowEdge,
} from '../shared/types';
