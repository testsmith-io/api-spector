// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../main/ipc/secret-handler', () => ({
  getSecret: vi.fn().mockResolvedValue(null),
}));

import { buildAuthHeaders, buildApiKeyParam, buildDigestAuthHeader, fetchOAuth2Token } from '../main/auth-builder';
import { getSecret } from '../main/ipc/secret-handler';

const mockGetSecret = vi.mocked(getSecret);

// ─── buildDigestAuthHeader ────────────────────────────────────────────────────

describe('buildDigestAuthHeader', () => {
  it('builds a basic Digest header without qop', () => {
    const header = buildDigestAuthHeader(
      { realm: 'example.com', nonce: 'abc123' },
      'alice', 'secret', 'GET', '/api',
    );
    expect(header).toContain('Digest username="alice"');
    expect(header).toContain('realm="example.com"');
    expect(header).toContain('nonce="abc123"');
    expect(header).toContain('uri="/api"');
    expect(header).toContain('response="');
    // no qop fields when qop is absent
    expect(header).not.toContain('qop=');
    expect(header).not.toContain('nc=');
    expect(header).not.toContain('cnonce=');
  });

  it('includes nc, cnonce, and qop when qop=auth', () => {
    const header = buildDigestAuthHeader(
      { realm: 'r', nonce: 'n', qop: 'auth' },
      'u', 'p', 'POST', '/data',
    );
    expect(header).toContain('qop=auth');
    expect(header).toContain('nc=00000001');
    expect(header).toContain('cnonce="');
  });

  it('includes opaque when provided', () => {
    const header = buildDigestAuthHeader(
      { realm: 'r', nonce: 'n', opaque: 'op999' },
      'u', 'p', 'GET', '/',
    );
    expect(header).toContain('opaque="op999"');
  });

  it('includes algorithm when it is not MD5', () => {
    const header = buildDigestAuthHeader(
      { realm: 'r', nonce: 'n', algorithm: 'SHA-256' },
      'u', 'p', 'GET', '/',
    );
    expect(header).toContain('algorithm=SHA-256');
  });

  it('omits algorithm field for the default MD5', () => {
    const header = buildDigestAuthHeader(
      { realm: 'r', nonce: 'n', algorithm: 'MD5' },
      'u', 'p', 'GET', '/',
    );
    expect(header).not.toContain('algorithm');
  });

  it('handles MD5-SESS algorithm without throwing', () => {
    const header = buildDigestAuthHeader(
      { realm: 'r', nonce: 'n', algorithm: 'MD5-SESS' },
      'u', 'p', 'GET', '/',
    );
    expect(header).toContain('Digest username="u"');
  });

  it('produces a different response hash for different credentials', () => {
    const h1 = buildDigestAuthHeader({ realm: 'r', nonce: 'n' }, 'user1', 'pass', 'GET', '/');
    const h2 = buildDigestAuthHeader({ realm: 'r', nonce: 'n' }, 'user2', 'pass', 'GET', '/');
    const getResponse = (h: string) => /response="([^"]+)"/.exec(h)?.[1];
    expect(getResponse(h1)).not.toBe(getResponse(h2));
  });
});

// ─── buildAuthHeaders ─────────────────────────────────────────────────────────

describe('buildAuthHeaders', () => {
  beforeEach(() => {
    mockGetSecret.mockResolvedValue(null);
  });

  it('returns empty headers for type none', async () => {
    expect(await buildAuthHeaders({ type: 'none' }, {})).toEqual({});
  });

  it('builds Bearer header from inline token', async () => {
    const h = await buildAuthHeaders({ type: 'bearer', token: 'tok123' }, {});
    expect(h['Authorization']).toBe('Bearer tok123');
  });

  it('fetches bearer token from secret ref when token is empty', async () => {
    mockGetSecret.mockResolvedValue('fetched-secret');
    const h = await buildAuthHeaders({ type: 'bearer', tokenSecretRef: 'MY_TOKEN' }, {});
    expect(h['Authorization']).toBe('Bearer fetched-secret');
    expect(mockGetSecret).toHaveBeenCalledWith('MY_TOKEN');
  });

  it('interpolates {{var}} in bearer token', async () => {
    const h = await buildAuthHeaders({ type: 'bearer', token: '{{myToken}}' }, { myToken: 'interpolated' });
    expect(h['Authorization']).toBe('Bearer interpolated');
  });

  it('omits Authorization when bearer token resolves to empty string', async () => {
    const h = await buildAuthHeaders({ type: 'bearer', token: '' }, {});
    expect(h['Authorization']).toBeUndefined();
  });

  it('builds Basic header from username and password', async () => {
    const h = await buildAuthHeaders({ type: 'basic', username: 'user', password: 'pass' }, {});
    expect(h['Authorization']).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`);
  });

  it('fetches basic password from secret ref', async () => {
    mockGetSecret.mockResolvedValue('s3cret');
    const h = await buildAuthHeaders({ type: 'basic', username: 'alice', passwordSecretRef: 'PASS' }, {});
    expect(h['Authorization']).toBe(`Basic ${Buffer.from('alice:s3cret').toString('base64')}`);
  });

  it('builds API key header with configured name', async () => {
    const h = await buildAuthHeaders({
      type: 'apikey', apiKeyIn: 'header', apiKeyName: 'X-Custom-Key', apiKeyValue: 'key123',
    }, {});
    expect(h['X-Custom-Key']).toBe('key123');
  });

  it('defaults API key header name to X-API-Key', async () => {
    const h = await buildAuthHeaders({ type: 'apikey', apiKeyIn: 'header', apiKeyValue: 'v' }, {});
    expect(h['X-API-Key']).toBe('v');
  });

  it('does not add a header for apikey-in-query', async () => {
    const h = await buildAuthHeaders({
      type: 'apikey', apiKeyIn: 'query', apiKeyName: 'k', apiKeyValue: 'v',
    }, {});
    expect(Object.keys(h)).toHaveLength(0);
  });

  it('uses cached oauth2 token when not yet expired', async () => {
    const h = await buildAuthHeaders({
      type: 'oauth2',
      oauth2CachedToken: 'cached',
      oauth2TokenExpiry: Date.now() + 60_000,
    }, {});
    expect(h['Authorization']).toBe('Bearer cached');
  });

  it('does not use an expired oauth2 cached token', async () => {
    const h = await buildAuthHeaders({
      type: 'oauth2',
      oauth2CachedToken: 'old',
      oauth2TokenExpiry: Date.now() - 1000,
    }, {});
    expect(h['Authorization']).toBeUndefined();
  });

  it('does not use oauth2 token expiring within 5 s (safety margin)', async () => {
    const h = await buildAuthHeaders({
      type: 'oauth2',
      oauth2CachedToken: 'almost-expired',
      oauth2TokenExpiry: Date.now() + 3000,   // within 5 000 ms window
    }, {});
    expect(h['Authorization']).toBeUndefined();
  });
});

// ─── buildApiKeyParam ─────────────────────────────────────────────────────────

describe('buildApiKeyParam', () => {
  beforeEach(() => {
    mockGetSecret.mockResolvedValue(null);
  });

  it('returns null for non-apikey auth types', async () => {
    expect(await buildApiKeyParam({ type: 'bearer' }, {})).toBeNull();
    expect(await buildApiKeyParam({ type: 'basic' }, {})).toBeNull();
    expect(await buildApiKeyParam({ type: 'none' }, {})).toBeNull();
  });

  it('returns null for apikey placed in header', async () => {
    expect(await buildApiKeyParam({ type: 'apikey', apiKeyIn: 'header' }, {})).toBeNull();
  });

  it('returns key/value for apikey-in-query', async () => {
    const result = await buildApiKeyParam({
      type: 'apikey', apiKeyIn: 'query', apiKeyName: 'api_key', apiKeyValue: 'abc',
    }, {});
    expect(result).toEqual({ key: 'api_key', value: 'abc' });
  });

  it('defaults to name "apikey" when apiKeyName is absent', async () => {
    const result = await buildApiKeyParam({ type: 'apikey', apiKeyIn: 'query', apiKeyValue: 'v' }, {});
    expect(result?.key).toBe('apikey');
  });

  it('fetches api key value from secret ref', async () => {
    mockGetSecret.mockResolvedValue('my-api-key');
    const result = await buildApiKeyParam({
      type: 'apikey', apiKeyIn: 'query', apiKeyName: 'key', apiKeySecretRef: 'API_KEY_REF',
    }, {});
    expect(result?.value).toBe('my-api-key');
  });
});

// ─── fetchOAuth2Token — error branches ────────────────────────────────────────

describe('fetchOAuth2Token error branches', () => {
  it('throws for authorization_code flow (requires browser redirect)', async () => {
    await expect(fetchOAuth2Token({ type: 'oauth2', oauth2Flow: 'authorization_code' }, {}))
      .rejects.toThrow('oauth2:startFlow');
  });

  it('throws for implicit flow (server-side not possible)', async () => {
    await expect(fetchOAuth2Token({ type: 'oauth2', oauth2Flow: 'implicit' }, {}))
      .rejects.toThrow('implicit');
  });

  it('throws when tokenUrl is missing', async () => {
    await expect(fetchOAuth2Token({ type: 'oauth2', oauth2Flow: 'client_credentials' }, {}))
      .rejects.toThrow('tokenUrl is required');
  });
});
