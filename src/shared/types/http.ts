// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

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
