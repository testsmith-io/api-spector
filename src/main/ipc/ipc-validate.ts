// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import Ajv, { type ValidateFunction } from 'ajv';

// ─── IPC payload validation ──────────────────────────────────────────────────
//
// Hardens IPC handlers against malformed payloads from a renderer that's been
// compromised or simply has stale data. Crashes from undefined fields turn
// into clean Errors with a useful message; obviously bogus shapes are rejected
// before they reach domain code.
//
// The schemas are intentionally permissive (`additionalProperties: true`,
// optional fields not in `required`). The goal is to catch *missing* required
// arrays/objects that today blow up at runtime — not to police every minor
// shape drift.
//
// We avoid the OpenAPI-only `nullable: true` keyword (ajv rejects it in plain
// Draft-07 strict-types mode). Instead we use `type: ['x', 'null']` unions
// where actual null is meaningful, and otherwise just leave the field out of
// `required`.

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
  allowUnionTypes: true,
});

/** Build an assertion-style validator. The runtime schema is `unknown` to
 *  ajv (we don't need ajv's type inference — we only use it for runtime
 *  validation), and the assertion type is supplied separately. */
function compile<T>(schema: object): (data: unknown) => asserts data is T {
  const fn: ValidateFunction = ajv.compile(schema);
  return function validate(data: unknown): asserts data is T {
    if (!fn(data)) {
      const err = (fn.errors ?? [])
        .map(e => `${e.instancePath || '<root>'} ${e.message ?? 'invalid'}`)
        .join('; ');
      throw new Error(`Invalid IPC payload: ${err || 'unknown'}`);
    }
  };
}

// ─── Reusable sub-schemas ────────────────────────────────────────────────────

const apiRequestSchema = {
  type: 'object',
  properties: {
    id:      { type: 'string' },
    name:    { type: 'string' },
    method:  { type: 'string' },
    url:     { type: 'string' },
    headers: { type: 'array' },
    params:  { type: 'array' },
    auth: {
      type: 'object',
      properties: { type: { type: 'string' } },
      required: ['type'],
      additionalProperties: true,
    },
    body: {
      type: 'object',
      properties: { mode: { type: 'string' } },
      required: ['mode'],
      additionalProperties: true,
    },
  },
  required: ['id', 'name', 'method', 'url', 'headers', 'params'],
  additionalProperties: true,
};

const stringMap = {
  type: 'object',
  additionalProperties: { type: 'string' },
};

// ─── Validators ──────────────────────────────────────────────────────────────

interface ApiRequestShape {
  id: string
  name: string
  method: string
  url: string
  headers: unknown[]
  params: unknown[]
  auth?: { type: string; [k: string]: unknown }
  body?: { mode: string; [k: string]: unknown }
}

interface SendRequestShape {
  request: ApiRequestShape
  environment?: unknown
  collectionVars?: Record<string, string>
  globals?: Record<string, string>
  proxy?: unknown
  tls?: unknown
  piiMaskPatterns?: string[]
}

export const validateSendRequestPayload: (data: unknown) => asserts data is SendRequestShape = compile<SendRequestShape>({
  type: 'object',
  properties: {
    request:        apiRequestSchema,
    collectionVars: stringMap,
    globals:        stringMap,
    piiMaskPatterns: { type: 'array', items: { type: 'string' } },
    // `environment`, `proxy`, `tls` are accepted as anything — they're
    // covered by the IPC handler's own type-narrow + defaults.
  },
  required: ['request'],
  additionalProperties: true,
});

interface ContractRunShape {
  mode: string
  requests: ApiRequestShape[]
  envVars?: Record<string, string>
  collectionVars?: Record<string, string>
  specUrl?: string
  specPath?: string
  specSnapshotRelPath?: string
  requestBaseUrl?: string
}

export const validateContractRunPayload: (data: unknown) => asserts data is ContractRunShape = compile<ContractRunShape>({
  type: 'object',
  properties: {
    mode:     { type: 'string', enum: ['consumer', 'provider', 'bidirectional'] },
    requests: { type: 'array', items: apiRequestSchema },
    envVars:        stringMap,
    collectionVars: stringMap,
    specUrl:             { type: 'string' },
    specPath:            { type: 'string' },
    specSnapshotRelPath: { type: 'string' },
    requestBaseUrl:      { type: 'string' },
  },
  required: ['mode', 'requests'],
  additionalProperties: true,
});

export const validateWsdlFetchUrl = (url: unknown): asserts url is string => {
  if (typeof url !== 'string' || !url.trim()) throw new Error('Invalid IPC payload: url must be a non-empty string');
  // Accept http/https only — no file:// or data: schemes.
  if (!/^https?:\/\//i.test(url)) throw new Error('Invalid IPC payload: url must start with http:// or https://');
};

interface WsdlImportShape {
  url?: string
  xml?: string
  name?: string
  extraHeaders?: Record<string, string>
  existingMockPorts?: number[]
}

export const validateWsdlImport: (data: unknown) => asserts data is WsdlImportShape = compile<WsdlImportShape>({
  type: 'object',
  properties: {
    url:  { type: 'string' },
    xml:  { type: 'string' },
    name: { type: 'string' },
    extraHeaders: stringMap,
    existingMockPorts: { type: 'array', items: { type: 'number' } },
  },
  additionalProperties: true,
});
