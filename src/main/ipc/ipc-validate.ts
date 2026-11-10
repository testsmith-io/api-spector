// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import Ajv, { type ValidateFunction } from 'ajv';

// IPC payload validation: hardens handlers against malformed payloads (undefined-field crashes
// become clean Errors). Schemas are permissive (additionalProperties: true) - the goal is catching
// MISSING required fields, not shape drift. No `nullable: true` (ajv rejects it in Draft-07 strict);
// use `type: ['x', 'null']` where null is meaningful, else omit from `required`.

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
  allowUnionTypes: true,
});

/** Build an assertion-style validator; the assertion type is supplied separately. */
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

// Reusable sub-schemas

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

// Validators

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
  dataRow?: Record<string, string>
}

export const validateSendRequestPayload: (data: unknown) => asserts data is SendRequestShape = compile<SendRequestShape>({
  type: 'object',
  properties: {
    request:        apiRequestSchema,
    collectionVars: stringMap,
    globals:        stringMap,
    dataRow:        stringMap,
    piiMaskPatterns: { type: 'array', items: { type: 'string' } },
    // environment/proxy/tls accepted as anything; the handler narrows them.
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
    mode:     { type: 'string', enum: ['consumer', 'provider', 'provider-live', 'bidirectional'] },
    requests: { type: 'array', items: apiRequestSchema },
    envVars:        stringMap,
    collectionVars: stringMap,
    specUrl:             { type: 'string' },
    specPath:            { type: 'string' },
    specSnapshotRelPath: { type: 'string' },
    requestBaseUrl:      { type: 'string' },
    providerBaseUrl:     { type: 'string' },
    stateHandlerUrl:     { type: 'string' },
  },
  required: ['mode', 'requests'],
  additionalProperties: true,
});

export const validateWsdlFetchUrl = (url: unknown): asserts url is string => {
  if (typeof url !== 'string' || !url.trim()) throw new Error('Invalid IPC payload: url must be a non-empty string');
  // Accept http/https only - no file:// or data: schemes.
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
