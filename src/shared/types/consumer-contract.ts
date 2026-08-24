// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { KeyValuePair } from './http';

// ─── Design-first consumer contracts (CDCT) ──────────────────────────────────
//
// A ConsumerContract is authored up front, before any endpoint exists: you
// describe the requests a consumer will make and the responses it needs back.
// It compiles to a Pact v3 document (publishable to API Spector Cloud, verified
// by the provider) and to a mock the consumer can develop against — so the
// contract is the first artifact, not something reverse-engineered from a live
// call.

export interface DesignInteractionRequest {
  method: string
  /** Path or path template, e.g. "/brands/{id}" — no host needed. */
  path: string
  query?: KeyValuePair[]
  headers?: KeyValuePair[]
  /** Request body as a JSON string (optional). */
  body?: string
}

export interface DesignInteractionResponse {
  status: number
  headers?: KeyValuePair[]
  /** Expected response body as a JSON string — used as the Pact example and,
   *  by default, matched by TYPE not value (tolerant CDCT). */
  body?: string
}

export interface DesignInteraction {
  id: string
  description: string
  /** Data the provider must set up for this interaction (Pact provider state). */
  providerState?: string
  request: DesignInteractionRequest
  response: DesignInteractionResponse
  /** When false, response fields are matched by exact value instead of by type.
   *  Defaults to type-matching (true) — the CDCT best practice. */
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
