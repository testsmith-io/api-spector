// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Collections / Environments / Workspace

import type { AuthConfig, HttpMethod, KeyValuePair, RequestBody } from './http';
import type { ContractExpectation } from './contract';
import type { ResponsePayload } from './execution';
import type { ConsumerContract } from './consumer-contract';
import type { PerfPlan } from './perf';

/** Saved request/response snapshot (Postman/Bruno "examples"). `request` is a
 *  partial override of the parent; `response` is what was captured. Additive, so
 *  older `.spector` files load unchanged. */
export interface RequestExample {
  id: string
  name: string
  /** Overrides merged over the parent request when this example is opened/sent. */
  request?: Partial<ApiRequest>
  /** The response captured for this example. */
  response?: ResponsePayload | null
  createdAt?: string
  /** Where the example came from, for import round-tripping. */
  source?: 'saved' | 'imported'
}

export interface DataSet {
  /** Column headers = variable names injected per iteration. */
  columns: string[]
  /** Each row is an ordered list of values matching `columns`. */
  rows: string[][]
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
  /** Streaming-response limits (ms). Unset = reader default (60s idle, 300s
   *  total); 0 disables that cap. */
  stream?: { idleMs?: number; maxMs?: number }
  meta?: { tags?: string[]; createdAt?: string;[key: string]: unknown }
  /** Transport / wire protocol. Drives which UI shell is rendered:
   *  - 'http' (default) -> method picker, URL bar, body modes
   *  - 'websocket'      -> ws:// URL, message panel
   *  - 'soap'           -> WSDL-driven endpoint, single SOAP editor (POST + xml)
   *  - 'socketio'       -> Socket.IO endpoint, event emit/receive panel
   *  - 'mqtt'           -> MQTT broker URL, publish/subscribe panel */
  protocol?: 'http' | 'websocket' | 'soap' | 'grpc' | 'socketio' | 'mqtt'  // default 'http'
  /** WebSocket test config. URL + headers come from the shared fields; received
   *  frames are exposed to the script as `sp.messages` (`.data` / `.json()`). */
  websocket?: {
    /** Optional message sent once, shortly after the connection opens. */
    sendMessage?: string
    /** Assertion script (sp.* sandbox) run over the collected frames. */
    testScript?: string
    /** How long to collect frames before running the test script (ms). */
    collectMs?: number
  }
  /** Socket.IO connection config (namespace + handshake auth). URL + headers
   *  come from the shared fields, as with WebSocket. */
  socketio?: {
    namespace?: string
    auth?: string
    /** Optional event emitted once after connect, when running a test. */
    emitEvent?: string
    /** Emit arguments as JSON text (an array is spread, else sent as one arg). */
    emitArgs?: string
    /** Assertion script (sp.* sandbox) run over the collected events. The
     *  received events are exposed as `sp.messages` (each has `.event`/`.args`). */
    testScript?: string
    /** How long to collect events before running the test script (ms). */
    collectMs?: number
  }
  /** MQTT connection + default publish/subscribe config. Broker URL comes from
   *  the shared url field (mqtt://, mqtts://, ws://, wss://); username/password
   *  support {{var}} interpolation. */
  mqtt?: {
    clientId?: string
    username?: string
    password?: string
    /** Default topic to subscribe to on connect. */
    subscribeTopic?: string
    /** Default topic to publish to. */
    publishTopic?: string
    /** Quality of Service for publish + subscribe. */
    qos?: 0 | 1 | 2
    /** Retain flag for published messages. */
    retain?: boolean
    /** MQTT clean-session / clean-start flag. Defaults to true. */
    cleanSession?: boolean
    /** Payload published when running a test (so the test is repeatable). */
    publishPayload?: string
    /** Assertion script (sp.* sandbox) run over the collected messages. The
     *  received messages are exposed as `sp.messages`. */
    testScript?: string
    /** How long to collect messages before running the test script (ms). */
    collectMs?: number
  }
  /** When set, this request acts as a lifecycle hook within its folder/collection scope. */
  hookType?: 'beforeAll' | 'before' | 'after' | 'afterAll'
  /** When true, the request is excluded from collection/folder runs. */
  disabled?: boolean
  /** Cached GraphQL introspection result (raw JSON), persisted across restarts. */
  graphqlIntrospectionCache?: string
  /** Saved request/response snapshots (Postman/Bruno-style examples). Each
   *  overrides the parent request; shown nested under it in the tree. */
  examples?: RequestExample[]
  /** Request-scoped variables: the most specific static scope. Override env /
   *  folder / collection / globals; overridden by data-row, runtime (sp.set)
   *  and CLI (--var). Only the enabled ones live here. */
  variables?: Record<string, string>
  /** Disabled request variables, kept so the editor can round-trip them. Not
   *  read by the resolver. */
  variablesDisabled?: Record<string, string>
}

/** One child of a folder in display / execution order: a request or sub-folder. */
export interface ChildRef {
  type: 'request' | 'folder'
  id: string
}

export interface Folder {
  id: string
  name: string
  description?: string
  folders: Folder[]
  requestIds: string[]
  /** When set, the whole folder runs as a lifecycle hook in its parent scope:
   *  its requests run as a group in the before/after position, not inline. */
  hookType?: 'beforeAll' | 'before' | 'after' | 'afterAll'
  /** When true, the folder and its subtree are excluded from runs. */
  disabled?: boolean
  /** Unified order of this folder's children (requests + sub-folders). When
   *  absent or partial, missing items fall in after it (requests, then folders).
   *  Drives both the tree and the run order. */
  childOrder?: ChildRef[]
  tags?: string[]
  auth?: AuthConfig
  headers?: KeyValuePair[]
  /** Variables scoped to this folder. Override collection/environment; overridden
   *  by an inner folder, the request, and local (script) vars. Only enabled ones
   *  live here. */
  variables?: Record<string, string>
  /** Disabled folder variables, kept so the editor can round-trip them. Not read
   *  by the resolver. */
  variablesDisabled?: Record<string, string>
  /** Data-driven dataset: each row runs the folder once with those variables.
   *  Takes priority over the collection dataset for folder runs. */
  dataSet?: DataSet
  /** On-disk pointer to the folder's data table (separate CSV under `data/`),
   *  written in place of inline `dataSet` and resolved back on load. */
  dataSetRef?: string
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
  /** When true, the whole collection is excluded from workspace/CI runs. */
  disabled?: boolean
  collectionVariables?: Record<string, string>
  /** Disabled collection variables, kept so the editor can round-trip them. Not
   *  read by the resolver. */
  collectionVariablesDisabled?: Record<string, string>
  /** Data-driven dataset: each row runs the full collection once with those variables injected. */
  dataSet?: DataSet
  /** On-disk pointer to the collection's data table (separate CSV under `data/`),
   *  written in place of inline `dataSet` and resolved back on load. */
  dataSetRef?: string
  /** TLS overrides applied to every request in this collection (takes priority over workspace TLS). */
  tls?: TlsSettings
  /** Auth inherited by all requests in this collection (can be overridden at folder or request level). */
  auth?: AuthConfig
  /** Headers inherited by all requests in this collection (can be overridden at folder or request level). */
  headers?: KeyValuePair[]
}

// Environment / Variables

export interface EnvVariable {
  key: string
  value: string
  enabled: boolean
  description?: string
  /** true -> AES-256-GCM encrypted (fields below set); false/absent -> plain text (or envRef). */
  secret?: boolean
  /** AES-256-GCM ciphertext + auth-tag, base64. Decrypted at send-time with API_SPECTOR_MASTER_KEY. */
  secretEncrypted?: string
  /** PBKDF2 salt, base64-encoded. */
  secretSalt?: string
  /** AES-GCM IV, base64-encoded. */
  secretIv?: string
  /** First 8 hex chars of SHA-256(plaintext); fingerprint display only. */
  secretHash?: string
  /** OS environment variable name; read from process.env[envRef] at send-time,
   *  never stored on disk. Takes precedence over value/secret. */
  envRef?: string
  /** External secret-manager reference, e.g. "vault:secret/data/app#token".
   *  Resolved at send-time; only the reference is stored. Takes precedence over
   *  value/secret. */
  secretRef?: string
}

export interface Environment {
  version: '1.0'
  id: string
  name: string
  variables: EnvVariable[]
  /** Parent environment to inherit variables from; the child wins on key
   *  collisions. Chains allowed; cycles ignored past the first repeat. */
  extends?: string
}

/** Resolution context for interactive flows (e.g. the OAuth 2.0 "Get Token"
 *  button). Renderer passes the active scope; main resolves the full variable
 *  map, including secret-manager refs and encrypted values only main can read. */
export interface VarResolveContext {
  environment?: Environment | null
  collectionVars?: Record<string, string>
  globals?: Record<string, string>
}

// Workspace

export interface Workspace {
  version: '1.0'
  collections: string[]
  environments: string[]
  activeEnvironmentId: string | null
  mocks?: string[]
  /** Paths (relative to the workspace dir) of pinned contract snapshots. */
  contracts?: string[]
  /** Paths (relative to the workspace dir) of flow definitions under flows/. */
  flows?: string[]
  /** Design-first consumer contracts authored in-app, stored inline. */
  designContracts?: ConsumerContract[]
  /** Performance (load) test plans, authored in-app and stored inline. */
  perfPlans?: PerfPlan[]
  settings?: {
    proxy?: {
      url: string
      auth?: { username: string; password: string }
    }
    tls?: TlsSettings
    piiMaskPatterns?: string[]
    /** Name of the environment CLI runs use when no --environment flag is
     *  given, and the app activates when no environment is selected yet. */
    defaultEnvironment?: string
    /** Which sub-tab a request opens on (default 'docs'). Examples ignore this
     *  and open on Body. */
    defaultRequestTab?: 'docs' | 'params' | 'headers' | 'body' | 'auth' | 'scripts'
    /** Persist request/response history to `history.json` in the workspace dir
     *  (gitignored) so it survives restarts. Off by default. */
    persistHistory?: boolean
    /** Show the Performance (load) testing view and its left-nav icon. Off by
     *  default. */
    performanceTesting?: boolean
    /** UI appearance; travels with the workspace. */
    theme?: 'dark' | 'light' | 'system'
    zoom?: number
    /** API Spector Cloud integration. The token is not stored here; it lives in
     *  the OS keychain under `cloud:token`, and `tokenSet` only records that one
     *  exists. */
    cloud?: {
      enabled: boolean
      tokenSet?: boolean
    }
    /** Per-workspace sync backend: 'git' (default, workspace dir is a git repo),
     *  'cloud' (sync through API Spector Cloud), or 'local' (no sync). For
     *  'cloud', baseVersion is the last version this machine pulled/pushed. */
    sync?: {
      mode: 'local' | 'git' | 'cloud'
      cloudWorkspaceId?: number
      baseVersion?: number
    }
    /** External secret-manager connection config: non-secret only (addresses,
     *  roles, mounts). Tokens/secret-ids come from the environment (see
     *  docs/secrets-vault.md), never here; env vars override these values. */
    secrets?: SecretsSettings
    /** Path or URL of the OpenAPI spec this workspace's coverage is measured
     *  against; the default when no --spec flag is given. */
    coverageSpec?: string
    /** Git integration. `useEnclosingRepo` = scoped mode: operate on the enclosing repo but limit
     *  status/diff/stage/commit to this workspace's subtree. Off = standalone repo; never auto-detected. */
    git?: {
      useEnclosingRepo?: boolean
    }
  }
}

// External secret managers

export interface VaultSettings {
  /** Vault base URL, e.g. https://vault.acme.internal:8200 (env: VAULT_ADDR). */
  address?: string
  /** Vault Enterprise namespace (env: VAULT_NAMESPACE). */
  namespace?: string
  /** Path prefix prepended to every `vault:`/`bao:` ref path (include the KV v2 `data/` segment for v2).
   *  (env: VAULT_PATH_PREFIX / BAO_PATH_PREFIX). */
  pathPrefix?: string
  /** How API Spector authenticates to Vault. Defaults are inferred from which
   *  credentials are present (token -> approle -> jwt). */
  authMethod?: 'token' | 'approle' | 'jwt'
  /** AppRole role id (the secret id always comes from the environment). */
  roleId?: string
  /** Role name for JWT/OIDC (workload-identity) auth, e.g. in CI. */
  jwtRole?: string
  /** Auth mount path when it is not the method default (approle / jwt). */
  loginMount?: string
  /** KV secrets-engine version. `auto` detects v2 by the response shape. */
  kvVersion?: 'auto' | '1' | '2'
  /** Skip TLS verification (dev only; env: VAULT_SKIP_VERIFY). */
  skipVerify?: boolean
}

export interface AwsSecretsSettings {
  /** AWS region, e.g. eu-west-1 (env: AWS_REGION). */
  region?: string
}

export interface AzureKeyVaultSettings {
  /** Key Vault name or full base URL (https://NAME.vault.azure.net). */
  vault?: string
  /** Entra tenant id (env: AZURE_TENANT_ID). */
  tenantId?: string
  /** App registration client id (env: AZURE_CLIENT_ID). */
  clientId?: string
}

export interface OnePasswordSettings {
  /** 1Password Connect base URL (env: OP_CONNECT_HOST). */
  connectHost?: string
}

export interface GcpSecretManagerSettings {
  /** Default GCP project id for refs that omit it (env: GCP_PROJECT). */
  project?: string
}

export interface SecretsSettings {
  vault?: VaultSettings
  aws?: AwsSecretsSettings
  azure?: AzureKeyVaultSettings
  onePassword?: OnePasswordSettings
  gcp?: GcpSecretManagerSettings
}

/** Summary of a SoapUI / ReadyAPI import: structure counts, Groovy conversion
 *  tally, and anything needing attention. Surfaced by the import summary screen. */
export interface SoapUiImportReport {
  project: string
  testSuites: number
  testCases: number
  requests: number
  scripts: { total: number; clean: number; partial: number; unsupported: number }
  /** Items skipped or needing a look (unsupported step types, property
   *  transfers, unmapped auth, …). */
  warnings: string[]
}
