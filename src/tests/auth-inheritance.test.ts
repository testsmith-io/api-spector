// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { authIsConfigured, resolveInheritedAuthAndHeaders } from '../shared/request-collection';
import type { Collection } from '../shared/types';

describe('authIsConfigured', () => {
  it('is false for none and undefined', () => {
    expect(authIsConfigured(undefined)).toBe(false);
    expect(authIsConfigured({ type: 'none' })).toBe(false);
  });

  it('is false for empty-credential stubs (the OpenAPI import case)', () => {
    expect(authIsConfigured({ type: 'bearer', token: '' })).toBe(false);
    expect(authIsConfigured({ type: 'bearer' })).toBe(false);
    expect(authIsConfigured({ type: 'basic', username: '', password: '' })).toBe(false);
    expect(authIsConfigured({ type: 'apikey', apiKeyName: 'X-API-Key', apiKeyValue: '' })).toBe(false);
  });

  it('is true when a credential is present', () => {
    expect(authIsConfigured({ type: 'bearer', token: 'abc' })).toBe(true);
    expect(authIsConfigured({ type: 'bearer', tokenSecretRef: 'ref' })).toBe(true);
    expect(authIsConfigured({ type: 'basic', username: 'u' })).toBe(true);
    expect(authIsConfigured({ type: 'apikey', apiKeyValue: 'k' })).toBe(true);
    expect(authIsConfigured({ type: 'bearer', token: '{{token}}' })).toBe(true); // a variable is a credential
  });

  it('treats whitespace-only credentials as unconfigured', () => {
    expect(authIsConfigured({ type: 'bearer', token: '   ' })).toBe(false);
  });
});

describe('folder auth inheritance with imported stubs', () => {
  const collection = (reqAuth: object): Collection => ({
    version: '1.0', id: 'c', name: 'c',
    rootFolder: { id: 'root', name: 'root', description: '', folders: [
      { id: 'f1', name: 'Secured', description: '', folders: [], requestIds: ['r1'], auth: { type: 'bearer', token: 'FOLDER' } },
    ], requestIds: [] },
    requests: { r1: { id: 'r1', name: 'r', method: 'GET', url: 'http://x/y', headers: [], params: [], auth: reqAuth as never, body: { mode: 'none' } } },
  } as Collection);

  it('resolves the folder bearer regardless of the request stub', () => {
    // The resolver itself always returns folder auth; the decision to use it is
    // authIsConfigured(req.auth) at the call site.
    const inherited = resolveInheritedAuthAndHeaders('r1', collection({ type: 'bearer', token: '' }));
    expect(inherited.auth).toEqual({ type: 'bearer', token: 'FOLDER' });

    // The imported empty stub must NOT win over the folder auth.
    const stub = { type: 'bearer', token: '' };
    const effective = authIsConfigured(stub) ? stub : inherited.auth;
    expect(effective).toEqual({ type: 'bearer', token: 'FOLDER' });

    // A request with its own real token DOES win.
    const own = { type: 'bearer', token: 'OWN' };
    const effective2 = authIsConfigured(own) ? own : inherited.auth;
    expect(effective2).toEqual({ type: 'bearer', token: 'OWN' });
  });
});
