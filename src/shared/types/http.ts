// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// ─── Core data model ─────────────────────────────────────────────────────────

// QUERY (RFC 10008): safe + idempotent like GET, but carries the query in a
// request body — the body and its Content-Type are mandatory per the RFC.
// The `(string & {})` arm keeps editor autocomplete for the well-known verbs
// while still allowing any custom method (e.g. PURGE, LINK, a WebDAV verb).
export type HttpMethod =
  | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'QUERY'
  | (string & {})

/** The well-known verbs, for menus and iteration. */
export const KNOWN_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY'] as const;

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
  /**
   * Allowed values for this entry. When set and non-empty, the value cell is
   * edited as a dropdown of these choices instead of a free-text field. Captured
   * from an OpenAPI `enum` on import, or defined by hand. Empty/undefined means
   * free text.
   */
  enum?: string[]
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
  /** Subscription (graphql-ws) WebSocket endpoint. Defaults to the request URL
   *  with a ws/wss scheme when empty. */
  subscriptionUrl?: string
  /** connection_init payload for the graphql-ws handshake (JSON text), used for
   *  auth tokens etc. */
  connectionParams?: string
  /** Assertion script (sp.* sandbox) run over the subscription payloads when
   *  running the subscription as a test. Each collected payload is exposed as
   *  an `sp.messages` entry with `.data` and `.json()`. */
  subscriptionTestScript?: string
  /** How long to collect subscription payloads before running the test (ms). */
  subscriptionCollectMs?: number
}

/** One entry in a GraphQL subscription (graphql-ws) stream. */
export interface GraphQlWsMessage {
  id: string
  /** 'next' = a subscription payload, 'error' = a GraphQL error payload,
   *  'complete' = the stream ended, 'system' = a connection note. */
  kind: 'next' | 'error' | 'complete' | 'system'
  /** JSON-serialized payload (next/error) or a short message (system). */
  data: string
  timestamp: number
}

export interface SoapBody {
  wsdlUrl: string
  serviceName?: string
  portName?: string
  operationName?: string
  /** SOAP version + binding of the selected operation. A WSDL can expose the
   *  same operation name in both a 1.1 and a 1.2 binding, so these disambiguate
   *  which one is selected (operationName alone is not unique). */
  soapVersion?: '1.1' | '1.2'
  binding?: string
  envelope: string        // the XML envelope (hand-edited or template-generated)
  soapAction?: string
}

/** A gRPC call definition. The proto schema comes from pasted source or a file
 *  path (server reflection is a follow-up); the call targets one service/method
 *  and sends a single request message as JSON (client streaming is a follow-up). */
export interface GrpcBody {
  /** Pasted .proto source, or use protoPath. */
  protoSource?: string
  /** Path to a .proto file on disk. */
  protoPath?: string
  /** Extra import roots so a proto's `import` statements resolve. */
  importPaths?: string[]
  /** Fully-qualified service name, e.g. "helloworld.Greeter". */
  serviceName?: string
  /** Method name as declared in the proto, e.g. "SayHello". */
  methodName?: string
  /** Request message as a JSON string (kept as text for {{var}} interpolation). */
  message: string
  /** Per-call metadata (gRPC's equivalent of headers). */
  metadata?: KeyValuePair[]
  /** Connect without TLS (h2c). Default is TLS. */
  plaintext?: boolean
}

/** One method discovered from a proto, with its streaming shape. */
export interface GrpcMethodInfo {
  name: string
  requestStream: boolean
  responseStream: boolean
}

/** One service discovered from a proto. */
export interface GrpcServiceInfo {
  name: string
  methods: GrpcMethodInfo[]
}

export interface RequestBody {
  mode: 'none' | 'json' | 'form' | 'raw' | 'graphql' | 'soap' | 'grpc'
  json?: string
  form?: KeyValuePair[]
  raw?: string
  rawContentType?: string
  graphql?: GraphQLBody
  soap?: SoapBody
  grpc?: GrpcBody
}

export interface WsMessage {
  id: string
  direction: 'sent' | 'received'
  data: string
  timestamp: number
}

/** A single frame in a gRPC call's log (a sent request or a received message). */
export interface GrpcMessage {
  id: string
  direction: 'sent' | 'received'
  data: string
  timestamp: number
}

/** One entry in a Socket.IO session log: an emitted event, a received event,
 *  an acknowledgement payload, or a system note (connect / disconnect / error). */
export interface SocketIoMessage {
  id: string
  direction: 'sent' | 'received'
  /** 'event' = a named Socket.IO event, 'ack' = an acknowledgement callback
   *  payload, 'system' = a connection status note. */
  kind: 'event' | 'ack' | 'system'
  /** Event name for events/acks; a short label for system notes. */
  event: string
  /** JSON-serialized argument array (events/acks) or message text (system). */
  data: string
  timestamp: number
}

/** One entry in an MQTT session log: a published message, a received message on
 *  a subscribed topic, or a system note (connect / subscribe / disconnect /
 *  error). */
export interface MqttMessage {
  id: string
  direction: 'sent' | 'received'
  /** 'message' = a publish/receive on a topic, 'system' = a connection note. */
  kind: 'message' | 'system'
  /** The topic for messages; a short label for system notes. */
  topic: string
  /** The payload (messages) or message text (system notes). */
  data: string
  qos?: 0 | 1 | 2
  retain?: boolean
  timestamp: number
}
