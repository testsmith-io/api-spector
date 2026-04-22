// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import crypto from 'crypto';
import type { AuthConfig, DigestAuth, NtlmAuth, Oauth2Auth } from '../shared/types';
import { getSecret } from './ipc/secret-handler';
import { interpolate } from './interpolation';

// ─── Auth header builder ──────────────────────────────────────────────────────

export async function buildAuthHeaders(
  auth: AuthConfig,
  vars: Record<string, string>,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};

  if (auth.type === 'bearer') {
    let token = auth.token ?? '';
    if (!token && auth.tokenSecretRef) token = (await getSecret(auth.tokenSecretRef)) ?? '';
    token = interpolate(token, vars);
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  if (auth.type === 'basic') {
    let password = auth.password ?? '';
    if (!password && auth.passwordSecretRef) password = (await getSecret(auth.passwordSecretRef)) ?? '';
    password = interpolate(password, vars);
    const username = interpolate(auth.username ?? '', vars);
    headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  if (auth.type === 'apikey' && auth.apiKeyIn === 'header') {
    let value = auth.apiKeyValue ?? '';
    if (!value && auth.apiKeySecretRef) value = (await getSecret(auth.apiKeySecretRef)) ?? '';
    value = interpolate(value, vars);
    headers[auth.apiKeyName ?? 'X-API-Key'] = value;
  }

  // digest: handled separately via performDigestAuth — no headers set here
  // ntlm:   handled separately via performNtlmRequest  — no headers set here
  // oauth2: handled separately via fetchOAuth2Token    — injected as Bearer below

  if (auth.type === 'oauth2') {
    // Use cached token if still valid
    const now = Date.now();
    if (auth.oauth2CachedToken && auth.oauth2TokenExpiry && auth.oauth2TokenExpiry > now + 5000) {
      headers['Authorization'] = `Bearer ${auth.oauth2CachedToken}`;
    }
    // Otherwise caller must invoke fetchOAuth2Token first, then retry
  }

  // apikey in query is handled at URL build time — nothing to add to headers

  return headers;
}

// ─── Query-param apikey helper ────────────────────────────────────────────────

export async function buildApiKeyParam(
  auth: AuthConfig,
  vars: Record<string, string>,
): Promise<{ key: string; value: string } | null> {
  if (auth.type !== 'apikey' || auth.apiKeyIn !== 'query') return null;
  let value = auth.apiKeyValue ?? '';
  if (!value && auth.apiKeySecretRef) value = (await getSecret(auth.apiKeySecretRef)) ?? '';
  value = interpolate(value, vars);
  return { key: auth.apiKeyName ?? 'apikey', value };
}

// ─── Digest auth helpers ──────────────────────────────────────────────────────

export interface DigestChallenge {
  realm: string
  nonce: string
  qop?: string
  algorithm?: string
  opaque?: string
}

function parseDigestChallenge(wwwAuth: string): DigestChallenge {
  const extract = (key: string): string => {
    const m = new RegExp(`${key}="([^"]*)"`, 'i').exec(wwwAuth);
    return m ? m[1] : '';
  };
  const extractUnquoted = (key: string): string => {
    const m = new RegExp(`${key}=([^,\\s]+)`, 'i').exec(wwwAuth);
    return m ? m[1] : '';
  };
  return {
    realm:     extract('realm'),
    nonce:     extract('nonce'),
    qop:       extract('qop') || extractUnquoted('qop') || undefined,
    algorithm: extract('algorithm') || extractUnquoted('algorithm') || 'MD5',
    opaque:    extract('opaque') || undefined,
  };
}

function md5(s: string): string {
  return crypto.createHash('md5').update(s).digest('hex');
}

/**
 * Build the Authorization: Digest header value given a parsed challenge,
 * credentials, HTTP method and URI.
 */
export function buildDigestAuthHeader(
  challenge: DigestChallenge,
  username: string,
  password: string,
  method: string,
  uri: string,
): string {
  const { realm, nonce, qop, algorithm, opaque } = challenge;
  const algo = (algorithm ?? 'MD5').toUpperCase();

  const ha1 = algo === 'MD5-SESS'
    ? md5(`${md5(`${username}:${realm}:${password}`)}:${nonce}:`)
    : md5(`${username}:${realm}:${password}`);

  const ha2 = md5(`${method}:${uri}`);

  let response: string;
  let nc: string | undefined;
  let cnonce: string | undefined;

  if (qop === 'auth' || qop === 'auth-int') {
    nc     = '00000001';
    cnonce = crypto.randomBytes(8).toString('hex');
    response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  } else {
    response = md5(`${ha1}:${nonce}:${ha2}`);
  }

  let header = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
  if (qop)    header += `, qop=${qop}`;
  if (nc)     header += `, nc=${nc}`;
  if (cnonce) header += `, cnonce="${cnonce}"`;
  if (opaque) header += `, opaque="${opaque}"`;
  if (algo !== 'MD5') header += `, algorithm=${algo}`;

  return header;
}

/**
 * Perform the two-round-trip Digest authentication flow.
 * Returns the Authorization header value (without key name) or null on failure.
 * The caller passes a `fetchFn` to avoid coupling to a specific undici instance
 * and to allow proxy/TLS dispatcher injection.
 */
export async function performDigestAuth(
  url: string,
  method: string,
  auth: DigestAuth,
  vars: Record<string, string>,
  fetchFn: (url: string, init: Record<string, unknown>) => Promise<{ status: number; headers: { get(k: string): string | null } }>,
): Promise<string | null> {
  // Round 1: bare request to get the WWW-Authenticate challenge
  const probeResp = await fetchFn(url, { method, headers: {} });
  if (probeResp.status !== 401) return null;

  const wwwAuth = probeResp.headers.get('www-authenticate') ?? '';
  if (!wwwAuth.toLowerCase().startsWith('digest')) return null;

  const challenge = parseDigestChallenge(wwwAuth);

  let password = auth.password ?? '';
  if (!password && auth.passwordSecretRef) password = (await getSecret(auth.passwordSecretRef)) ?? '';
  password = interpolate(password, vars);
  const username = interpolate(auth.username ?? '', vars);

  // Extract path + query from URL for the uri field
  let uri = '/';
  try { uri = new URL(url).pathname + (new URL(url).search ?? ''); } catch { /* keep '/' */ }

  return buildDigestAuthHeader(challenge, username, password, method, uri);
}

// ─── NTLM helpers ─────────────────────────────────────────────────────────────

/**
 * NTLM is a 3-message handshake that requires keeping a persistent TCP
 * connection across all three messages.  The `httpntlm` npm package handles
 * this correctly but is not currently in package.json.
 *
 * TODO: add `httpntlm` to dependencies and implement this.
 * Until then this function throws so the caller can surface a helpful error.
 */
export async function performNtlmRequest(
  _url: string,
  _method: string,
  _auth: NtlmAuth,
  _vars: Record<string, string>,
): Promise<never> {
  throw new Error(
    'NTLM auth is not yet implemented. Add "httpntlm" to package.json dependencies and implement performNtlmRequest in auth-builder.ts.',
  );
}

// ─── OAuth 2.0 token fetch ────────────────────────────────────────────────────

export interface OAuth2TokenResult {
  accessToken: string
  expiresAt: number    // unix ms
  refreshToken?: string
}

/**
 * Fetch an OAuth 2.0 token for client_credentials or password flows.
 * The token is NOT cached here — callers should store it in auth.oauth2CachedToken.
 */
export async function fetchOAuth2Token(
  auth: Oauth2Auth,
  vars: Record<string, string>,
): Promise<OAuth2TokenResult> {
  const flow = auth.oauth2Flow ?? 'client_credentials';

  if (flow === 'authorization_code') {
    throw new Error('authorization_code flow requires the oauth2:startFlow IPC call from the renderer.');
  }
  if (flow === 'implicit') {
    throw new Error('implicit flow cannot be performed server-side — tokens must be obtained via the browser redirect.');
  }

  const tokenUrl = interpolate(auth.oauth2TokenUrl ?? '', vars);
  if (!tokenUrl) throw new Error('OAuth 2.0: tokenUrl is required.');

  const clientId     = interpolate(auth.oauth2ClientId ?? '', vars);
  let clientSecret   = auth.oauth2ClientSecret ?? '';
  if (!clientSecret && auth.oauth2ClientSecretRef) {
    clientSecret = (await getSecret(auth.oauth2ClientSecretRef)) ?? '';
  }
  clientSecret = interpolate(clientSecret, vars);

  const params = new URLSearchParams();
  params.set('grant_type', flow === 'password' ? 'password' : 'client_credentials');
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  if (auth.oauth2Scopes) params.set('scope', auth.oauth2Scopes);

  if (flow === 'password') {
    let password = auth.password ?? '';
    if (!password && auth.passwordSecretRef) password = (await getSecret(auth.passwordSecretRef)) ?? '';
    password = interpolate(password, vars);
    params.set('username', interpolate(auth.username ?? '', vars));
    params.set('password', password);
  }

  const { fetch: nodeFetch } = await import('undici');
  const resp = await nodeFetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`OAuth 2.0 token request failed (${resp.status}): ${body}`);
  }

  const json = await resp.json() as Record<string, unknown>;
  const accessToken = String(json['access_token'] ?? '');
  if (!accessToken) throw new Error('OAuth 2.0: token response missing access_token.');

  const expiresIn = Number(json['expires_in'] ?? 3600);
  const expiresAt = Date.now() + expiresIn * 1000;

  return {
    accessToken,
    expiresAt,
    refreshToken: json['refresh_token'] ? String(json['refresh_token']) : undefined,
  };
}
