// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { KeyValuePair } from './http';

// Design-first consumer contracts (CDCT): authored before any endpoint exists.
// Compile to a Pact v3 document (provider-verified) and to a mock to develop against.

export interface DesignInteractionRequest {
  method: string
  /** Path or path template, e.g. "/brands/{id}"; no host. */
  path: string
  query?: KeyValuePair[]
  headers?: KeyValuePair[]
  /** Request body as a JSON string (optional). */
  body?: string
}

export interface DesignInteractionResponse {
  status: number
  headers?: KeyValuePair[]
  /** Expected response body as JSON; the Pact example, matched by type not
   *  value by default. */
  body?: string
}

export interface DesignInteraction {
  id: string
  description: string
  /** Data the provider must set up for this interaction (Pact provider state). */
  providerState?: string
  request: DesignInteractionRequest
  response: DesignInteractionResponse
  /** When false, response fields are matched by exact value, not type. Defaults
   *  to type-matching (true). */
  looseMatch?: boolean
}

export interface ConsumerContract {
  id: string
  consumer: string
  provider: string
  interactions: DesignInteraction[]
  /** ISO timestamp of the last edit. */
  updatedAt?: string
}
