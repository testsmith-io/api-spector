// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { describe, it, expect } from 'vitest';
import {
  validateSendRequestPayload,
  validateContractRunPayload,
  validateWsdlFetchUrl,
  validateWsdlImport,
} from '../main/ipc/ipc-validate';

const goodRequest = {
  id: 'r1',
  name: 'Get user',
  method: 'GET',
  url: 'https://api.example.com/users/1',
  headers: [],
  params: [],
  auth: { type: 'none' },
  body: { mode: 'none' },
};

describe('validateSendRequestPayload', () => {
  it('accepts a well-formed payload', () => {
    expect(() => validateSendRequestPayload({ request: goodRequest })).not.toThrow();
  });

  it('rejects when request is missing', () => {
    expect(() => validateSendRequestPayload({})).toThrow(/Invalid IPC payload/);
  });

  it('rejects when headers is not an array', () => {
    expect(() => validateSendRequestPayload({
      request: { ...goodRequest, headers: 'oops' },
    })).toThrow(/headers/);
  });

  it('rejects when auth is missing its type', () => {
    expect(() => validateSendRequestPayload({
      request: { ...goodRequest, auth: { token: 'x' } },
    })).toThrow(/type/);
  });
});

describe('validateContractRunPayload', () => {
  it('accepts consumer mode with minimal fields', () => {
    expect(() => validateContractRunPayload({ mode: 'consumer', requests: [] })).not.toThrow();
  });

  it('rejects an unknown mode', () => {
    expect(() => validateContractRunPayload({ mode: 'unknown', requests: [] }))
      .toThrow(/mode/);
  });

  it('rejects when requests is missing', () => {
    expect(() => validateContractRunPayload({ mode: 'provider' })).toThrow(/requests/);
  });
});

describe('validateWsdlFetchUrl', () => {
  it('accepts http and https URLs', () => {
    expect(() => validateWsdlFetchUrl('http://example.com/svc?WSDL')).not.toThrow();
    expect(() => validateWsdlFetchUrl('https://example.com/svc?WSDL')).not.toThrow();
  });

  it('rejects empty string', () => {
    expect(() => validateWsdlFetchUrl('')).toThrow();
    expect(() => validateWsdlFetchUrl('   ')).toThrow();
  });

  it('rejects non-string values', () => {
    expect(() => validateWsdlFetchUrl(null)).toThrow();
    expect(() => validateWsdlFetchUrl(123)).toThrow();
  });

  it('rejects non-http schemes', () => {
    expect(() => validateWsdlFetchUrl('file:///etc/passwd')).toThrow(/http/);
    expect(() => validateWsdlFetchUrl('data:text/plain,foo')).toThrow(/http/);
  });
});

describe('validateWsdlImport', () => {
  it('accepts a url-only payload', () => {
    expect(() => validateWsdlImport({ url: 'https://example.com/svc?WSDL' })).not.toThrow();
  });

  it('accepts an xml-only payload', () => {
    expect(() => validateWsdlImport({ xml: '<definitions/>' })).not.toThrow();
  });

  it('rejects when existingMockPorts is not numeric array', () => {
    expect(() => validateWsdlImport({ existingMockPorts: ['oops'] })).toThrow();
  });
});
