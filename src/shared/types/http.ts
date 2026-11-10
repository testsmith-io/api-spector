// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Core data model

// QUERY (RFC 10008): like GET but carries the query in a mandatory request body.
// The `(string & {})` arm keeps autocomplete for the known verbs while allowing
// any custom method.
export type HttpMethod =
  | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'QUERY'
  | (string & {})

/** The well-known verbs, for menus and iteration. */
export const KNOWN_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY'] as const;

/** Trim + upper-case an imported method string, GET when blank. Hygiene, not
 *  validation (HttpMethod accepts any string). */
export function normalizeHttpMethod(raw: string | null | undefined): HttpMethod {
  return (raw ?? '').trim().toUpperCase() || 'GET';
}

export interface KeyValuePair {
  key: string
  value: string
  enabled: boolean
  description?: string
  /** Request `params` only: path variable (`{{name}}` in the URL) vs query
   *  parameter (`?key=value`). Defaults to `'query'`. */
  paramType?: 'query' | 'path'
  /** Allowed values; when non-empty the value cell becomes a dropdown instead of
   *  free text. Captured from an OpenAPI `enum` on import, or set by hand. */
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
  /** In-memory cache - NOT persisted to disk. Cleared on app load. */
  oauth2CachedToken?: string
  oauth2TokenExpiry?: number
  // Basic auth fields reused for oauth2 'password' flow
  username?: string
  password?: string
  passwordSecretRef?: string
}

export type AuthConfig = NoneAuth | BasicAuth | BearerAuth | ApiKeyAuth | DigestAuth | NtlmAuth | Oauth2Auth

/** Allows merging any field regardless of auth.type, for UI setters that spread
 *  partial updates. Narrowed AuthConfig stays the source of truth at consumers. */
type UnionToIntersection<U> = ( U extends unknown ? ( k: U ) => void : never ) extends ( k: infer I ) => void ? I : never
export type AuthPatch = Partial<UnionToIntersection<AuthConfig>>

/** Exhaustiveness helper for the default of a switch. */
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
  /** connection_init payload for the graphql-ws handshake (JSON text). */
  connectionParams?: string
  /** Assertion script (sp.* sandbox) run over the collected subscription
   *  payloads, each exposed as an `sp.messages` entry with `.data`/`.json()`. */
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
  /** SOAP version + binding: a WSDL can expose the same operation name in both
   *  1.1 and 1.2 bindings, so operationName alone isn't unique. */
  soapVersion?: '1.1' | '1.2'
  binding?: string
  envelope: string        // the XML envelope (hand-edited or template-generated)
  soapAction?: string
}

/** A gRPC call: proto from pasted source or a file path, targeting one
 *  service/method, sending a single JSON request message. */
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

/** One part of a `multipart/form-data` body. Text parts carry a `value`; file
 *  parts reference `filePath`, streamed at send time (never embedded in the
 *  `.spector` file). */
export interface MultipartPart {
  key: string
  enabled: boolean
  /** 'text' sends `value`; 'file' reads and uploads `filePath`. */
  type: 'text' | 'file'
  /** Text parts: the field value (supports {{var}} interpolation). */
  value?: string
  /** File parts: absolute path to the file on disk (supports {{var}}). */
  filePath?: string
  /** File parts: override the transmitted filename. Defaults to the basename of `filePath`. */
  fileName?: string
  /** Optional per-part Content-Type; auto-detected from the file extension when
   *  omitted for file parts. */
  contentType?: string
  description?: string
}

export interface RequestBody {
  mode: 'none' | 'json' | 'form' | 'raw' | 'graphql' | 'soap' | 'grpc' | 'multipart'
  json?: string
  form?: KeyValuePair[]
  /** Parts for `mode: 'multipart'` (multipart/form-data, with file uploads). */
  multipart?: MultipartPart[]
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
