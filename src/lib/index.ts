// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// ─── Engine library entry ─────────────────────────────────────────────────────
//
// Additive, Node-only surface that re-exports API Spector's mock engine and
// request runner so other programs (e.g. the cloud) can embed them instead of
// shelling out to the CLI. Nothing here changes behaviour; it only makes the
// existing engine importable:
//
//   import { updateMockRoutes, handleRequest } from '@testsmith/api-spector/engine'
//   import { executeRunnerRequest, buildDispatcher } from '@testsmith/api-spector/engine'
//
// Both graphs are the same ones the `mock` and `run` CLI commands use, so they
// carry no Electron dependency.

// ── Mock engine ──
// Stateless use: updateMockRoutes(id, routes) to register a mock, then call
// handleRequest(id, req, res, Date.now()) per incoming request. The engine does
// path matching, per-route scripts, faker/dayjs body interpolation, and delays.
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

// ── Request runner engine ──
// executeRunnerRequest() runs a single ApiRequest headlessly with pre/post
// scripts, dynamic/faker variables ($randomInt, $uuid, ...), and assertions,
// returning the response plus test results. This is what powers monitors that
// run tests exported from the desktop app.
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

// ── External secret managers (HashiCorp Vault, ...) ──
// The engine resolves `vault:...` (and any registered scheme) references inside
// auth and environment variables automatically. Register additional backends
// via registerSecretProvider; set connection config with setSecretsConfig.
export {
  registerSecretProvider,
  registeredSchemes,
  hasSecretScheme,
  resolveExternalSecret,
  setSecretsConfig,
} from '../main/secrets';
export type { SecretProvider, SecretResolveContext } from '../main/secrets';

// ── Shared types ──
export type {
  MockServer,
  MockRoute,
  MockHit,
  ApiRequest,
  HttpMethod,
  TestResult,
  KeyValuePair,
  AuthConfig,
} from '../shared/types';
