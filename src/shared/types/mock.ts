// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Mock server

import type { HttpMethod } from './http';

/** Connection-level faults a route can inject instead of a response. WireMock-style:
 *   - EMPTY_RESPONSE:           close with no bytes.
 *   - MALFORMED_RESPONSE_CHUNK: a 200 status line, then garbage, then close.
 *   - RANDOM_DATA_THEN_CLOSE:   garbage (no valid HTTP), then close.
 *   - CONNECTION_RESET_BY_PEER: reset the socket (TCP RST), not a clean EOF. */
export type MockFault =
  | 'EMPTY_RESPONSE'
  | 'MALFORMED_RESPONSE_CHUNK'
  | 'RANDOM_DATA_THEN_CLOSE'
  | 'CONNECTION_RESET_BY_PEER';

export interface MockRoute {
  id: string
  method: HttpMethod | 'ANY'
  path: string            // e.g. /users/:id
  statusCode: number
  headers: Record<string, string>
  body: string
  delay?: number           // ms before responding
  /** Inject a fault instead of the response. Honors `delay` and still advances
   *  the scenario. */
  fault?: MockFault
  /** Scenario (stateful behavior): the route matches only while its scenario is
   *  in `requiredState` (default "Started"), then moves it to `newState`. Lets one
   *  method+path answer differently in sequence. */
  scenario?: string
  requiredState?: string
  newState?: string
  description?: string
  /** JavaScript that runs before the response is sent.
   *  Context: { request, response, metadata, faker, dayjs, console }
   *  Mutate `response.statusCode`/`body`/`headers` to shape the output. */
  script?: string
  /** Free-form data exposed to `script` as `metadata`. The WSDL importer uses it
   *  to externalize per-operation SOAP envelopes (`metadata.soapEnvelopes[opName]`). */
  metadata?: Record<string, unknown>
}

export interface MockServer {
  version: '1.0'
  id: string
  name: string
  port: number
  routes: MockRoute[]
  /** Base URL to forward unmatched requests to (path + query appended as-is),
   *  relaying the response. Unset = unmatched requests 404. */
  proxyBaseUrl?: string
  /** Set once the mock is pushed to the cloud: public share URL + record id, so
   *  the UI can show the link without re-pushing. Refreshed on the next push. */
  cloud?: { id: number; url: string; pushedAt: number }
}

export interface MockHit {
  id: string
  serverId: string
  timestamp: number      // Date.now() when request arrived
  method: string
  path: string
  matchedRouteId: string | null   // null = no match (404 or proxied)
  /** No route matched and the request was proxied; status/body are the upstream's. */
  proxied?: boolean
  /** A fault was injected; status is 0 (the connection was broken). */
  fault?: MockFault
  status: number
  durationMs: number
  responseBody?: string
  responseHeaders?: Record<string, string>
}
