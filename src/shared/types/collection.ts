// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// ─── Collections / Environments / Workspace ─────────────────────────────────

import type { AuthConfig, HttpMethod, KeyValuePair, RequestBody } from './http';
import type { ContractExpectation } from './contract';

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
  meta?: { tags?: string[]; createdAt?: string;[key: string]: unknown }
  /** Transport / wire protocol. Drives which UI shell is rendered:
   *  - 'http' (default) → method picker, URL bar, body modes
   *  - 'websocket'      → ws:// URL, message panel
   *  - 'soap'           → WSDL-driven endpoint, single SOAP editor (POST + xml) */
  protocol?: 'http' | 'websocket' | 'soap'  // default 'http'
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
  /** Variables scoped to this folder. Override collection variables and are
   *  overridden by an inner folder, the environment, and local (script) vars. */
  variables?: Record<string, string>
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
  /** Name of a parent environment to inherit variables from. The child's own
   *  variables win on key collisions. Chains are allowed (base <- staging <-
   *  staging-eu); cycles are ignored past the first repeat. */
  extends?: string
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
    /** URL of a served contract dashboard (`contract report --serve`). Used
     *  only for the "Open dashboard" link in the contract results panel —
     *  the app never sends data to it; results travel via the workspace
     *  files / git. */
    dashboardUrl?: string
    /** Name of the environment CLI runs use when no --environment flag is
     *  given, and the app activates when no environment is selected yet. */
    defaultEnvironment?: string
    /** Persist request/response history to `history.json` in the workspace dir
     *  (gitignored) so it survives restarts. Off by default. */
    persistHistory?: boolean
    /** UI appearance — previously in localStorage, now travels with the workspace */
    theme?: 'dark' | 'light' | 'system'
    zoom?: number
  }
}
