// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// ─── Mock server ──────────────────────────────────────────────────────────────

import type { HttpMethod } from './http';

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
   *  Context: { request, response, metadata, faker, dayjs, console }
   *  Mutate `response.statusCode`, `response.body`, `response.headers` to customise output. */
  script?: string
  /** Free-form data exposed to `script` as `metadata`. Used by the WSDL importer
   *  to externalize per-operation SOAP envelopes so the script body stays compact
   *  (`metadata.soapEnvelopes[opName]` instead of a giant JSON literal). */
  metadata?: Record<string, unknown>
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
