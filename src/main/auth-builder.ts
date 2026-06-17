// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import crypto from 'crypto';
import { STATUS_CODES } from 'http';
import { readFile } from 'fs/promises';
import type { AuthConfig, DigestAuth, NtlmAuth, Oauth2Auth, TlsSettings } from '../shared/types';
import { getSecret } from './ipc/secret-handler';
import { interpolate } from './interpolation';
import { createType1Message, decodeType2Message, createType3Message } from './ntlm';

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

// ─── NTLM ───────────────────────────────────────────────────────────────────

/**
 * Minimal response shape the request handler consumes — deliberately matches
 * the slice of the undici `fetch` response it reads (status, statusText,
 * iterable headers, and a `text()` resolver), so the NTLM branch slots in
 * alongside the normal/digest branches without special-casing downstream.
 */
export interface NtlmResponseAdapter {
  status: number
  statusText: string
  headers: { forEach(cb: (value: string, key: string) => void): void }
  text(): Promise<string>
}

export interface NtlmRequestOptions {
  url: string
  method: string
  auth: NtlmAuth
  vars: Record<string, string>
  /** Already-resolved request headers (user headers + content-type). No Authorization. */
  baseHeaders: Record<string, string>
  body?: string
  tls?: TlsSettings
  proxy?: { url?: string }
}

/** Pull the base64 NTLM token out of a (possibly multi-valued) WWW-Authenticate header. */
function extractNtlmChallenge(value: string | string[] | undefined): string | null {
  if (!value) return null;
  const values = Array.isArray(value) ? value : [value];
  for (const v of values) {
    for (const part of v.split(',')) {
      const m = /^\s*NTLM\s+(.+)\s*$/i.exec(part);
      if (m) return m[1].trim();
    }
  }
  return null;
}

async function buildNtlmConnectOpts(tls?: TlsSettings): Promise<Record<string, unknown> | undefined> {
  if (!tls) return undefined;
  const connect: Record<string, unknown> = {};
  if (tls.rejectUnauthorized !== undefined) connect['rejectUnauthorized'] = tls.rejectUnauthorized;
  if (tls.caCertPath)     { try { connect['ca']   = await readFile(tls.caCertPath); }     catch { /* ignore */ } }
  if (tls.clientCertPath) { try { connect['cert'] = await readFile(tls.clientCertPath); } catch { /* ignore */ } }
  if (tls.clientKeyPath)  { try { connect['key']  = await readFile(tls.clientKeyPath); }  catch { /* ignore */ } }
  return Object.keys(connect).length ? connect : undefined;
}

/**
 * Perform an NTLM (NTLMv2) authenticated request.
 *
 * NTLM authenticates the *connection*, not the request, so the three messages
 * (negotiate → challenge → authenticate) must travel over one keep-alive
 * socket. We use a dedicated single-connection undici `Client` to guarantee
 * that — the global fetch pool gives no such guarantee.
 *
 *   1. send Type 1 (negotiate), expect 401 + `WWW-Authenticate: NTLM <type2>`
 *   2. parse the Type 2 challenge
 *   3. resend on the SAME connection with Type 3 (authenticate) + the real body
 */
export async function performNtlmRequest(opts: NtlmRequestOptions): Promise<NtlmResponseAdapter> {
  if (opts.proxy?.url) {
    throw new Error('NTLM authentication through a proxy is not supported. Disable the proxy for this request, or target the server directly.');
  }

  const { Client } = await import('undici');

  // Resolve credentials
  let password = opts.auth.password ?? '';
  if (!password && opts.auth.passwordSecretRef) password = (await getSecret(opts.auth.passwordSecretRef)) ?? '';
  password = interpolate(password, opts.vars);
  const username    = interpolate(opts.auth.username ?? '', opts.vars);
  const domain      = interpolate(opts.auth.ntlmDomain ?? '', opts.vars);
  const workstation = interpolate(opts.auth.ntlmWorkstation ?? '', opts.vars);

  const parsed = new URL(opts.url);
  const origin = `${parsed.protocol}//${parsed.host}`;
  const path   = parsed.pathname + parsed.search;

  const connect = await buildNtlmConnectOpts(opts.tls);
  const client  = new Client(origin, { pipelining: 1, ...(connect ? { connect } : {}) });

  const toAdapter = (statusCode: number, headers: Record<string, string | string[] | undefined>, bodyText: string): NtlmResponseAdapter => {
    const entries: [string, string][] = [];
    for (const [k, v] of Object.entries(headers)) {
      if (v === undefined) continue;
      entries.push([k, Array.isArray(v) ? v.join(', ') : String(v)]);
    }
    return {
      status: statusCode,
      statusText: STATUS_CODES[statusCode] ?? '',
      headers: { forEach: (cb) => entries.forEach(([k, v]) => cb(v, k)) },
      text: () => Promise.resolve(bodyText),
    };
  };

  try {
    // ── Message 1: negotiate ────────────────────────────────────────────────
    const negotiate = await client.request({
      path,
      method: opts.method,
      headers: { authorization: `NTLM ${createType1Message()}` },
    });
    // Must drain the body before reusing the connection for message 3.
    await negotiate.body.text();

    const challengeToken = extractNtlmChallenge(negotiate.headers['www-authenticate']);

    // Server didn't offer an NTLM challenge — surface whatever it returned.
    if (negotiate.statusCode !== 401 || !challengeToken) {
      const second = await client.request({ path, method: opts.method, headers: opts.baseHeaders, body: opts.body });
      const bodyText = await second.body.text();
      return toAdapter(second.statusCode, second.headers, bodyText);
    }

    // ── Message 3: authenticate (same connection) ────────────────────────────
    const challenge = decodeType2Message(challengeToken);
    const type3 = createType3Message({ user: username, password, domain, workstation, challenge });

    const authed = await client.request({
      path,
      method: opts.method,
      headers: { ...opts.baseHeaders, authorization: `NTLM ${type3}` },
      body: opts.body,
    });
    const bodyText = await authed.body.text();
    return toAdapter(authed.statusCode, authed.headers, bodyText);
  } finally {
    await client.close().catch(() => { /* best effort */ });
  }
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
