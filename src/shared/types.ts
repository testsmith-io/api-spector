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

// ─── Core data model ─────────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface KeyValuePair {
  key: string
  value: string
  enabled: boolean
  description?: string
}

export interface AuthConfig {
  type: 'none' | 'basic' | 'bearer' | 'apikey' | 'digest' | 'ntlm' | 'oauth2'

  // Basic / Digest / NTLM — shared credential fields
  username?: string
  password?: string
  passwordSecretRef?: string

  // Bearer
  token?: string
  tokenSecretRef?: string

  // API Key
  apiKeyName?: string
  apiKeyValue?: string
  apiKeySecretRef?: string
  apiKeyIn?: 'header' | 'query'

  // NTLM (username/password reused from above)
  ntlmDomain?: string
  ntlmWorkstation?: string

  // OAuth 2.0
  oauth2Flow?: 'client_credentials' | 'authorization_code' | 'implicit' | 'password'
  oauth2TokenUrl?: string
  oauth2AuthUrl?: string
  oauth2ClientId?: string
  oauth2ClientSecret?: string
  oauth2ClientSecretRef?: string
  oauth2Scopes?: string        // space-separated
  oauth2RedirectPort?: number  // for authorization_code flow, default 9876
  /** In-memory cache — NOT persisted to disk. Cleared on app load. */
  oauth2CachedToken?: string
  oauth2TokenExpiry?: number   // unix timestamp ms
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
  /** Strip this base URL from request URLs before matching against spec paths.
   *  Useful when collection requests point at a different host than the spec's servers[]. */
  requestBaseUrl?: string
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
  schema?: string
  contract?: ContractExpectation
  meta?: { tags?: string[]; createdAt?: string; [key: string]: unknown }
  protocol?: 'http' | 'websocket'  // default 'http'
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/** Scripts that execute once before/after a collection or folder run. */
export interface CollectionHooks {
  /** Runs once before any request in the scope executes. Use to authenticate, seed data, etc. */
  setup?: string
  /** Runs once after all requests in the scope have executed. Use to clean up created resources. */
  teardown?: string
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
  hooks?: CollectionHooks
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
  /** Collection-level lifecycle hooks executed once per run. */
  hooks?: CollectionHooks
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
  settings?: {
    proxy?: {
      url: string
      auth?: { username: string; password: string }
    }
    tls?: TlsSettings
    piiMaskPatterns?: string[]
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

export type RunStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error'

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

// ─── Git ──────────────────────────────────────────────────────────────────────

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'

export interface GitFile {
  path: string
  status: GitFileStatus
}

export interface GitStatus {
  staged:    GitFile[]
  unstaged:  GitFile[]
  untracked: GitFile[]
  branch:    string
  ahead:     number
  behind:    number
  remote:    string | null
}

export interface GitCommit {
  hash:    string
  short:   string
  message: string
  author:  string
  email:   string
  date:    string
}

export interface GitBranch {
  name:    string
  current: boolean
  remote:  boolean
}

export interface GitRemote {
  name: string
  url:  string
}

export type CiPlatform = 'github' | 'gitlab' | 'azure' | 'unknown'
