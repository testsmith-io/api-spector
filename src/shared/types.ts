// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

// ─── Core data model ─────────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface KeyValuePair {
  key: string
  value: string
  enabled: boolean
  description?: string
  /**
   * For request `params` only: distinguishes path variables (substituted into
   * the URL via `{{name}}` interpolation) from query string parameters
   * (appended as `?key=value`). Undefined defaults to `'query'`.
   */
  paramType?: 'query' | 'path'
}

export type AuthType = 'none' | 'basic' | 'bearer' | 'apikey' | 'digest' | 'ntlm' | 'oauth2'

export interface NoneAuth { type: 'none' }
export interface BasicAuth { type: 'basic'; username?: string; password?: string; passwordSecretRef?: string }
export interface BearerAuth { type: 'bearer'; token?: string; tokenSecretRef?: string }
export interface ApiKeyAuth { type: 'apikey'; apiKeyName?: string; apiKeyValue?: string; apiKeySecretRef?: string; apiKeyIn?: 'header' | 'query' }
export interface DigestAuth { type: 'digest'; username?: string; password?: string; passwordSecretRef?: string }
export interface NtlmAuth { type: 'ntlm'; username?: string; password?: string; passwordSecretRef?: string; ntlmDomain?: string; ntlmWorkstation?: string }
export interface Oauth2Auth {
  type: 'oauth2'
  oauth2Flow?: 'client_credentials' | 'authorization_code' | 'implicit' | 'password'
  oauth2TokenUrl?: string
  oauth2AuthUrl?: string
  oauth2ClientId?: string
  oauth2ClientSecret?: string
  oauth2ClientSecretRef?: string
  oauth2Scopes?: string
  oauth2RedirectPort?: number
  /** In-memory cache — NOT persisted to disk. Cleared on app load. */
  oauth2CachedToken?: string
  oauth2TokenExpiry?: number
  // Basic auth fields reused for oauth2 'password' flow
  username?: string
  password?: string
  passwordSecretRef?: string
}

export type AuthConfig = NoneAuth | BasicAuth | BearerAuth | ApiKeyAuth | DigestAuth | NtlmAuth | Oauth2Auth

/** Shape that allows merging any field regardless of current auth.type. Used by
 *  UI setters that spread partial updates (e.g. `setAuth({ username: 'x' })`).
 *  Narrowed AuthConfig is still the source of truth at consumer sites. */
type UnionToIntersection<U> = ( U extends unknown ? ( k: U ) => void : never ) extends ( k: infer I ) => void ? I : never
export type AuthPatch = Partial<UnionToIntersection<AuthConfig>>

/** Exhaustiveness helper — put in the default of a switch to get a compile
 *  error if a new auth type is added without a handler. */
export function assertNever ( x: never ): never {
  throw new Error( `Unhandled case: ${JSON.stringify( x )}` );
}

export interface GraphQLBody {
  query: string
  variables: string       // JSON string (kept as text for {{var}} interpolation)
  operationName?: string
}

export interface SoapBody {
  wsdlUrl: string
  serviceName?: string
  portName?: string
  operationName?: string
  envelope: string        // the XML envelope (hand-edited or template-generated)
  soapAction?: string
}

export interface RequestBody {
  mode: 'none' | 'json' | 'form' | 'raw' | 'graphql' | 'soap'
  json?: string
  form?: KeyValuePair[]
  raw?: string
  rawContentType?: string
  graphql?: GraphQLBody
  soap?: SoapBody
}

export interface WsMessage {
  id: string
  direction: 'sent' | 'received'
  data: string
  timestamp: number
}

export interface DataSet {
  /** Column headers = variable names injected per iteration. */
  columns: string[]
  /** Each row is an ordered list of values matching `columns`. */
  rows: string[][]
}

// ─── Contract testing ─────────────────────────────────────────────────────────

export interface ContractExpectation {
  statusCode?: number
  headers?: { key: string; value: string; required: boolean }[]
  bodySchema?: string   // JSON Schema (draft-07) as a string
}

export type ContractMode = 'consumer' | 'provider' | 'bidirectional'

export type ContractViolationType =
  | 'status_mismatch'
  | 'schema_violation'
  | 'missing_header'
  | 'request_body_invalid'
  | 'unknown_path'
  | 'schema_incompatible'

export interface ContractViolation {
  type: ContractViolationType
  message: string
  path?: string
  expected?: string
  actual?: string
}

export interface ContractResult {
  requestId: string
  requestName: string
  method: string
  url: string
  passed: boolean
  violations: ContractViolation[]
  durationMs?: number
  actualStatus?: number
}

export interface ContractReport {
  mode: ContractMode
  total: number
  passed: number
  failed: number
  results: ContractResult[]
  durationMs: number
}

export interface ContractRunPayload {
  mode: ContractMode
  requests: ApiRequest[]
  envVars: Record<string, string>
  collectionVars?: Record<string, string>
  specUrl?: string
  specPath?: string
  /** Run against a pinned snapshot stored in the workspace. Takes priority over
   *  `specUrl`/`specPath` so callers don't have to clear those when switching. */
  specSnapshotRelPath?: string
  /** Strip this base URL from request URLs before matching against spec paths.
   *  Useful when collection requests point at a different host than the spec's servers[]. */
  requestBaseUrl?: string
}

// ─── Contract snapshots (pinned OpenAPI/spec versions) ───────────────────────
//
// A snapshot captures the exact bytes of an external spec at a point in time
// so runs can be replayed against a specific version even after the provider
// ships a new release. Stored per-workspace under `contracts/*.contract.json`.

export interface ContractSnapshot {
  version: '1.0'
  /** Stable id — used as the snapshot filename and in CLI --snapshot <id>. */
  id: string
  /** Human label (e.g. "users-api v1.3"). */
  name: string
  /** Original URL or absolute path the snapshot was captured from. Informational
   *  only — the verifier reads `spec` directly from this file. */
  source?: string
  /** ISO timestamp when the snapshot was captured. */
  capturedAt: string
  /** Wire format of the embedded spec text. */
  format: 'yaml' | 'json'
  /** Optional semantic version extracted from the spec's `info.version`. */
  specVersion?: string
  /** Raw spec text as captured (yaml or json, matches `format`). */
  spec: string
  /** SHA-256 hex of `spec`. Makes git diffs easy to sanity-check. */
  sha256: string
}

export interface ApiRequest {
  id: string
  name: string
  method: HttpMethod
  url: string
  headers: KeyValuePair[]
  params: KeyValuePair[]
  auth: AuthConfig
  body: RequestBody
  description?: string
  preRequestScript?: string
  postRequestScript?: string
  /** Runs in the sandbox before GraphQL schema introspection. Use sp.environment.set() to inject auth headers. */
  graphqlIntrospectionScript?: string
  /** Standalone JSON Schema for ad-hoc body validation. Independent of `contract`. */
  schema?: string
  contract?: ContractExpectation
  meta?: { tags?: string[]; createdAt?: string;[key: string]: unknown }
  protocol?: 'http' | 'websocket'  // default 'http'
  /** When set, this request acts as a lifecycle hook within its folder/collection scope. */
  hookType?: 'beforeAll' | 'before' | 'after' | 'afterAll'
  /** When true, the request is excluded from collection/folder runs. */
  disabled?: boolean
  /** Cached GraphQL introspection result (raw JSON). Persisted so the schema
   *  explorer and query autocomplete survive tab switches and app restarts. */
  graphqlIntrospectionCache?: string
}

export interface Folder {
  id: string
  name: string
  description?: string
  folders: Folder[]
  requestIds: string[]
  tags?: string[]
  auth?: AuthConfig
  headers?: KeyValuePair[]
}

export interface TlsSettings {
  caCertPath?: string
  clientCertPath?: string
  clientKeyPath?: string
  rejectUnauthorized?: boolean
}

export interface Collection {
  version: '1.0'
  id: string
  name: string
  description?: string
  rootFolder: Folder
  requests: Record<string, ApiRequest>
  collectionVariables?: Record<string, string>
  /** Data-driven dataset: each row runs the full collection once with those variables injected. */
  dataSet?: DataSet
  /** TLS overrides applied to every request in this collection (takes priority over workspace TLS). */
  tls?: TlsSettings
  /** Auth inherited by all requests in this collection (can be overridden at folder or request level). */
  auth?: AuthConfig
  /** Headers inherited by all requests in this collection (can be overridden at folder or request level). */
  headers?: KeyValuePair[]
}

// ─── Environment / Variables ──────────────────────────────────────────────────

export interface EnvVariable {
  key: string
  value: string
  enabled: boolean
  description?: string
  /**
   * true  → value is AES-256-GCM encrypted, fields below are set.
   * false / absent → plain text value (or envRef if set)
   */
  secret?: boolean
  /**
   * AES-256-GCM ciphertext + auth-tag, base64-encoded.
   * Decrypted at send-time using the master password from API_SPECTOR_MASTER_KEY.
   */
  secretEncrypted?: string
  /** PBKDF2 salt, base64-encoded. */
  secretSalt?: string
  /** AES-GCM IV, base64-encoded. */
  secretIv?: string
  /**
   * First 8 hex chars of SHA-256(plaintext), computed in renderer.
   * Stored for fingerprint display only — cannot recover the value.
   */
  secretHash?: string
  /**
   * OS environment variable name (e.g. "MY_API_TOKEN").
   * When set, the value is read from process.env[envRef] in the main process
   * at send-time — never stored on disk. Takes precedence over value/secret.
   */
  envRef?: string
}

export interface Environment {
  version: '1.0'
  id: string
  name: string
  variables: EnvVariable[]
}

// ─── Workspace ────────────────────────────────────────────────────────────────

export interface Workspace {
  version: '1.0'
  collections: string[]
  environments: string[]
  activeEnvironmentId: string | null
  mocks?: string[]
  /** Paths (relative to the workspace dir) of pinned contract snapshots. */
  contracts?: string[]
  settings?: {
    proxy?: {
      url: string
      auth?: { username: string; password: string }
    }
    tls?: TlsSettings
    piiMaskPatterns?: string[]
    /** UI appearance — previously in localStorage, now travels with the workspace */
    theme?: 'dark' | 'light' | 'system'
    zoom?: number
  }
}

// ─── Scripting ────────────────────────────────────────────────────────────────

export interface TestResult {
  name: string
  passed: boolean
  error?: string
}

export interface ScriptExecutionMeta {
  testResults: TestResult[]
  consoleOutput: string[]
  updatedEnvVars: Record<string, string>
  updatedCollectionVars: Record<string, string>
  updatedGlobals: Record<string, string>
  updatedLocalVars: Record<string, string>
  resolvedUrl: string
  preScriptError?: string
  postScriptError?: string
}

// ─── IPC payloads ─────────────────────────────────────────────────────────────

export interface SendRequestPayload {
  request: ApiRequest
  environment: Environment | null
  collectionVars: Record<string, string>
  globals: Record<string, string>
  proxy?: {
    url: string
    auth?: { username: string; password: string }
  }
  tls?: TlsSettings
  piiMaskPatterns?: string[]
}

export interface ResponsePayload {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  bodySize: number
  durationMs: number
  error?: string
}

export interface SentRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

export interface RequestExecutionResult {
  response: ResponsePayload
  scriptResult: ScriptExecutionMeta
  sentRequest: SentRequest
}

export interface HistoryEntry {
  id: string
  timestamp: number
  request: ApiRequest
  resolvedUrl: string
  response: ResponsePayload
  environmentName: string | null
  scriptResult?: ScriptExecutionMeta
}

// ─── Code generation ─────────────────────────────────────────────────────────

export type GenerateTarget =
  | 'robot_framework'
  | 'playwright_ts'
  | 'playwright_js'
  | 'supertest_ts'
  | 'supertest_js'
  | 'rest_assured'

export interface GenerateOptions {
  collection: Collection
  environment: Environment | null
  target: GenerateTarget
  outputDir?: string
}

export interface GeneratedFile {
  path: string
  content: string
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export interface RunnerItem {
  request: ApiRequest
  collectionVars: Record<string, string>
  /** Per-iteration variable values (from data-driven dataset). */
  dataRow?: Record<string, string>
  /** Human-readable label, e.g. "2/5" when data-driven. */
  iterationLabel?: string
  // ── Hook metadata ─────────────────────────────────────────────────────────
  isHook?: boolean
  hookType?: 'beforeAll' | 'before' | 'afterAll' | 'after'
  /** The folder/collection this hook belongs to. */
  scopeId?: string
  /** Ancestor scope IDs from root outward (not including scopeId). */
  scopeAncestors?: string[]
  /** For before/after hooks: the main request this hook wraps. */
  mainRequestId?: string
  /**
   * Folder names from (just below) the root to the folder that owns this
   * request/hook. Used for grouped rendering in the runner UI and reports.
   * Empty array = direct child of the collection root.
   */
  scopePath?: string[]
}

export interface RunnerPayload {
  items: RunnerItem[]
  environment: Environment | null
  globals: Record<string, string>
  proxy?: {
    url: string
    auth?: { username: string; password: string }
  }
  tls?: {
    caCertPath?: string
    clientCertPath?: string
    clientKeyPath?: string
    rejectUnauthorized?: boolean
  }
  piiMaskPatterns?: string[]
  /** Milliseconds to wait between requests (0 = no delay) */
  requestDelay?: number
}

/**
 * Status of a single request inside a runner pass.
 *
 * - `pending`  — queued, not started yet
 * - `running`  — request in flight
 * - `passed`   — HTTP 2xx/3xx AND every test passed
 * - `failed`   — at least one test failed, OR HTTP 4xx/5xx
 * - `error`    — pre/post script crashed or transport failure
 * - `skipped`  — request completed (HTTP 2xx/3xx) but had no assertions to
 *                check; "we ran it, we didn't verify anything." Distinct
 *                from `passed` so users notice gaps in their test coverage.
 */
export type RunStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error' | 'skipped'

export interface RunRequestResult {
  requestId: string
  name: string
  method: string
  resolvedUrl: string
  status: RunStatus
  httpStatus?: number
  durationMs?: number
  error?: string
  testResults?: TestResult[]
  consoleOutput?: string[]
  preScriptError?: string
  postScriptError?: string
  /** Set when this result belongs to a data-driven iteration, e.g. "2/5". */
  iterationLabel?: string
  isHook?: boolean
  hookType?: 'beforeAll' | 'before' | 'afterAll' | 'after'
  scopeId?: string
  /** Folder names from (just below) the root to the request's owning folder.
   *  Mirror of RunnerItem.scopePath, used for grouped rendering. */
  scopePath?: string[]
  /** Actual request sent over the wire */
  sentRequest?: {
    headers: Record<string, string>
    body?: string
  }
  /** Response received */
  receivedResponse?: {
    status: number
    statusText: string
    headers: Record<string, string>
    body: string
  }
}

export interface RunSummary {
  total: number
  passed: number
  failed: number
  errors: number
  /** Requests that ran successfully (2xx/3xx) but had no assertions to check. */
  skipped: number
  durationMs: number
}

// ─── Mock server ──────────────────────────────────────────────────────────────

export interface MockRoute {
  id: string
  method: HttpMethod | 'ANY'
  path: string            // e.g. /users/:id
  statusCode: number
  headers: Record<string, string>
  body: string
  delay?: number           // ms before responding
  description?: string
  /** JavaScript that runs before the response is sent.
   *  Context: { request, response, faker, dayjs, console }
   *  Mutate `response.statusCode`, `response.body`, `response.headers` to customise output. */
  script?: string
}

export interface MockServer {
  version: '1.0'
  id: string
  name: string
  port: number
  routes: MockRoute[]
}

export interface MockHit {
  id: string
  serverId: string
  timestamp: number      // Date.now() when request arrived
  method: string
  path: string
  matchedRouteId: string | null   // null = no match (404)
  status: number
  durationMs: number
  responseBody?: string
  responseHeaders?: Record<string, string>
}

// ─── Recorder ─────────────────────────────────────────────────────────────────

export interface RecorderConfig {
  upstream: string
  port: number
  maskHeaders?: string[]
  ignoreHeaders?: string[]
}

export interface RecordedRequest {
  method: string
  path: string
  query: Record<string, string>
  headers: Record<string, string>
  body: string | null
}

export interface RecordedResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string | null
  binary: boolean
  bodySize: number
}

export interface RecordedEntry {
  id: string
  timestamp: string
  durationMs: number
  request: RecordedRequest
  response: RecordedResponse
}

export interface RecordingSession {
  version: '1.0'
  upstream: string
  port: number
  startedAt: string
  maskedHeaders: string[]
  entries: RecordedEntry[]
}

// ─── Git ──────────────────────────────────────────────────────────────────────

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'

export interface GitFile {
  path: string
  status: GitFileStatus
}

export interface GitStatus {
  staged: GitFile[]
  unstaged: GitFile[]
  untracked: GitFile[]
  conflicted: string[]   // paths with merge conflicts
  branch: string
  ahead: number
  behind: number
  remote: string | null
}

export interface GitCommit {
  hash: string
  short: string
  message: string
  author: string
  email: string
  date: string
}

export interface GitBranch {
  name: string
  current: boolean
  remote: boolean
}

export interface GitRemote {
  name: string
  url: string
}

export type CiPlatform = 'github' | 'gitlab' | 'azure' | 'unknown'
