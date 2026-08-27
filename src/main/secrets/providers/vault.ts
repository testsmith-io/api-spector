// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Dispatcher } from 'undici';
import { getSecretsConfig } from '../config';
import type { SecretProvider } from '../types';

// HashiCorp Vault provider. References look like `vault:<path>#<key>`, where
// <path> is the exact Vault API path (e.g. `secret/data/app` for KV v2, `kv/app`
// for KV v1) and <key> is the field within that secret.
//
// Authentication follows the ambient context (same across UI / CLI / CI, only
// the source differs):
//   1. explicit token          — VAULT_TOKEN
//   2. `vault login` token     — ~/.vault-token
//   3. AppRole                 — VAULT_ROLE_ID + VAULT_SECRET_ID
//   4. JWT / OIDC (CI)         — VAULT_JWT | VAULT_JWT_PATH  (+ role)
// Non-secret bits (address, namespace, role, mount) may also come from the
// workspace's settings.secrets.vault; environment variables always win.

interface VaultConn {
  address: string
  namespace?: string
  authMethod: 'token' | 'approle' | 'jwt'
  token?: string
  roleId?: string
  secretId?: string
  jwt?: string
  jwtRole?: string
  loginMount?: string
  kvVersion: 'auto' | '1' | '2'
  skipVerify: boolean
  caPath?: string
}

// First non-empty of the given environment variables.
function env(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

function readFileTrim(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

function resolveConn(): VaultConn {
  const cfg = getSecretsConfig()?.vault ?? {};

  const address = env('VAULT_ADDR', 'API_SPECTOR_VAULT_ADDR') ?? cfg.address;
  if (!address) {
    throw new Error('Vault is not configured: set VAULT_ADDR (or settings.secrets.vault.address)');
  }

  const token = env('VAULT_TOKEN', 'API_SPECTOR_VAULT_TOKEN')
    ?? readFileTrim(join(homedir(), '.vault-token'));
  const roleId = env('VAULT_ROLE_ID', 'API_SPECTOR_VAULT_ROLE_ID') ?? cfg.roleId;
  const secretId = env('VAULT_SECRET_ID', 'API_SPECTOR_VAULT_SECRET_ID');
  const jwt = env('VAULT_JWT', 'API_SPECTOR_VAULT_JWT')
    ?? (env('VAULT_JWT_PATH', 'API_SPECTOR_VAULT_JWT_PATH') ? readFileTrim(env('VAULT_JWT_PATH', 'API_SPECTOR_VAULT_JWT_PATH')!) : undefined);
  const jwtRole = env('VAULT_JWT_ROLE', 'API_SPECTOR_VAULT_JWT_ROLE') ?? cfg.jwtRole;

  const explicit = (env('VAULT_AUTH_METHOD', 'API_SPECTOR_VAULT_AUTH_METHOD') ?? cfg.authMethod) as VaultConn['authMethod'] | undefined;
  const authMethod: VaultConn['authMethod'] = explicit
    ?? (token ? 'token' : roleId ? 'approle' : jwt ? 'jwt' : 'token');

  return {
    address: address.replace(/\/+$/, ''),
    namespace: env('VAULT_NAMESPACE', 'API_SPECTOR_VAULT_NAMESPACE') ?? cfg.namespace,
    authMethod,
    token,
    roleId,
    secretId,
    jwt,
    jwtRole,
    loginMount: cfg.loginMount,
    kvVersion: (env('VAULT_KV_VERSION', 'API_SPECTOR_VAULT_KV_VERSION') ?? cfg.kvVersion ?? 'auto') as VaultConn['kvVersion'],
    skipVerify: (env('VAULT_SKIP_VERIFY', 'API_SPECTOR_VAULT_SKIP_VERIFY') ?? '').toLowerCase() === 'true' || cfg.skipVerify === true,
    caPath: env('VAULT_CACERT', 'API_SPECTOR_VAULT_CACERT'),
  };
}

// A short-lived Vault client token (from token auth or a login), cached until
// shortly before its lease expires, and secret values, cached for their lease.
let cachedToken: { value: string; expiresAt: number } | null = null;
// Cached per secret PATH (not per key), so reading several fields from one
// secret is a single Vault round-trip.
const secretCache = new Map<string, { bag: Record<string, unknown>; expiresAt: number }>();

let _dispatcher: Dispatcher | undefined;
let _dispatcherKey = '';
async function dispatcherFor(conn: VaultConn): Promise<Dispatcher | undefined> {
  if (!conn.skipVerify && !conn.caPath) return undefined;
  const key = `${conn.skipVerify}|${conn.caPath ?? ''}`;
  if (_dispatcher && _dispatcherKey === key) return _dispatcher;
  const { Agent } = await import('undici');
  const connect: Record<string, unknown> = {};
  if (conn.skipVerify) connect.rejectUnauthorized = false;
  if (conn.caPath) {
    const ca = readFileTrim(conn.caPath);
    if (ca) connect.ca = ca;
  }
  _dispatcher = new Agent({ connect });
  _dispatcherKey = key;
  return _dispatcher;
}

async function vaultFetch(conn: VaultConn, path: string, init: RequestInit & { token?: string } = {}): Promise<any> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (conn.namespace) headers['X-Vault-Namespace'] = conn.namespace;
  if (init.token) headers['X-Vault-Token'] = init.token;

  const dispatcher = await dispatcherFor(conn);
  const res = await fetch(`${conn.address}/v1/${path}`, {
    ...init,
    headers,
    // undici honours `dispatcher`; the field is not in the DOM RequestInit type.
    ...(dispatcher ? { dispatcher } : {}),
  } as RequestInit);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Vault ${res.status} on /v1/${path}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function clientToken(conn: VaultConn): Promise<string> {
  if (conn.authMethod === 'token') {
    if (!conn.token) {
      throw new Error('Vault token auth selected but no token found (set VAULT_TOKEN or run `vault login`)');
    }
    return conn.token;
  }

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 5_000) return cachedToken.value;

  let mount: string;
  let body: Record<string, unknown>;
  if (conn.authMethod === 'approle') {
    if (!conn.roleId || !conn.secretId) {
      throw new Error('Vault AppRole auth needs VAULT_ROLE_ID and VAULT_SECRET_ID');
    }
    mount = conn.loginMount ?? 'approle';
    body = { role_id: conn.roleId, secret_id: conn.secretId };
  } else {
    if (!conn.jwt || !conn.jwtRole) {
      throw new Error('Vault JWT/OIDC auth needs a JWT (VAULT_JWT or VAULT_JWT_PATH) and a role (VAULT_JWT_ROLE)');
    }
    mount = conn.loginMount ?? 'jwt';
    body = { role: conn.jwtRole, jwt: conn.jwt };
  }

  const json = await vaultFetch(conn, `auth/${mount}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const token = json?.auth?.client_token;
  if (!token) throw new Error('Vault login did not return a client token');
  const ttl = Number(json?.auth?.lease_duration ?? 0);
  cachedToken = { value: token, expiresAt: ttl > 0 ? now + ttl * 1000 : now + 5 * 60_000 };
  return token;
}

async function readSecret(refBody: string): Promise<string> {
  const hash = refBody.lastIndexOf('#');
  if (hash < 0) {
    throw new Error(`Vault reference must be 'vault:<path>#<key>' (got 'vault:${refBody}')`);
  }
  const path = refBody.slice(0, hash).replace(/^\/+/, '');
  const key = refBody.slice(hash + 1);
  if (!path || !key) {
    throw new Error(`Vault reference must be 'vault:<path>#<key>' (got 'vault:${refBody}')`);
  }

  const conn = resolveConn();
  const cacheKey = `${conn.address}|${conn.namespace ?? ''}|${path}`;
  const now = Date.now();

  let bag: Record<string, unknown> | undefined;
  const hit = secretCache.get(cacheKey);
  if (hit && hit.expiresAt > now) {
    bag = hit.bag;
  } else {
    const json = await vaultFetch(conn, path, { token: await clientToken(conn) });
    // KV v2 nests the fields under data.data (with data.metadata alongside); KV
    // v1 puts them directly under data.
    const isV2 = conn.kvVersion === '2'
      || (conn.kvVersion === 'auto' && json?.data?.data !== undefined && json?.data?.metadata !== undefined);
    bag = (isV2 ? json?.data?.data : json?.data) as Record<string, unknown> | undefined;
    const lease = Number(json?.lease_duration ?? 0);
    if (bag) {
      secretCache.set(cacheKey, { bag, expiresAt: lease > 0 ? now + lease * 1000 : now + 5 * 60_000 });
    }
  }

  if (!bag || !(key in bag)) {
    throw new Error(`Vault secret at '${path}' has no key '${key}'`);
  }
  return String(bag[key]);
}

// Test-only: clear the in-memory token/secret caches.
export function _resetVaultCache(): void {
  cachedToken = null;
  secretCache.clear();
  _dispatcher = undefined;
  _dispatcherKey = '';
}

export const vaultProvider: SecretProvider = {
  scheme: 'vault',
  resolve: (refBody) => readSecret(refBody),
};
