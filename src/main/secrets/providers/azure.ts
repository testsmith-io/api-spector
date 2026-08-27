// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { getSecretsConfig } from '../config';
import type { SecretProvider } from '../types';

// Azure Key Vault provider. References look like:
//   azure:<vault>/<secret>              e.g. azure:acme-kv/db-password
//   azure:<vault>/<secret>/<version>
//   azure:https://acme-kv.vault.azure.net/secrets/db-password
//
// Authenticates to Entra ID with client credentials (AZURE_TENANT_ID,
// AZURE_CLIENT_ID, AZURE_CLIENT_SECRET) and reads over the Key Vault REST API.
// In CI you can supply a federated-credential client secret, or export those
// three from your OIDC step.

interface AzureConn {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  defaultVault?: string;
}

function env(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

function resolveConn(): AzureConn {
  const cfg = getSecretsConfig()?.azure ?? {};
  const tenantId = env('AZURE_TENANT_ID', 'API_SPECTOR_AZURE_TENANT_ID') ?? cfg.tenantId;
  const clientId = env('AZURE_CLIENT_ID', 'API_SPECTOR_AZURE_CLIENT_ID') ?? cfg.clientId;
  const clientSecret = env('AZURE_CLIENT_SECRET', 'API_SPECTOR_AZURE_CLIENT_SECRET');
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Azure Key Vault: set AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET');
  }
  return { tenantId, clientId, clientSecret, defaultVault: cfg.vault };
}

let cachedToken: { value: string; expiresAt: number } | null = null;
const secretCache = new Map<string, { value: string; expiresAt: number }>();

export function _resetAzureCache(): void {
  cachedToken = null;
  secretCache.clear();
}

async function accessToken(conn: AzureConn): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) return cachedToken.value;

  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: conn.clientId,
    client_secret: conn.clientSecret,
    scope: 'https://vault.azure.net/.default',
  });
  const res = await fetch(`https://login.microsoftonline.com/${conn.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Azure AD token ${res.status}: ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const token: string | undefined = json?.access_token;
  if (!token) throw new Error('Azure AD did not return an access token');
  const ttl = Number(json?.expires_in ?? 0);
  cachedToken = { value: token, expiresAt: ttl > 0 ? now + ttl * 1000 : now + 5 * 60_000 };
  return token;
}

// Resolve a reference into a Key Vault secret URL.
function secretUrl(refBody: string, defaultVault?: string): string {
  if (/^https?:\/\//i.test(refBody)) {
    return refBody.split('#')[0];
  }
  const parts = refBody.replace(/^\/+/, '').split('/');
  let vault: string;
  let name: string;
  let version = '';
  if (parts.length >= 2) {
    [vault, name, version = ''] = parts;
  } else if (parts.length === 1 && defaultVault) {
    vault = defaultVault;
    name = parts[0];
  } else {
    throw new Error(`Azure reference must be 'azure:<vault>/<secret>[/<version>]' (got 'azure:${refBody}')`);
  }
  const base = /^https?:\/\//i.test(vault) ? vault.replace(/\/+$/, '') : `https://${vault}.vault.azure.net`;
  const path = version ? `secrets/${name}/${version}` : `secrets/${name}`;
  return `${base}/${path}?api-version=7.4`;
}

async function resolve(refBody: string): Promise<string> {
  const conn = resolveConn();
  const url = secretUrl(refBody, conn.defaultVault);
  const now = Date.now();
  const hit = secretCache.get(url);
  if (hit && hit.expiresAt > now) return hit.value;

  const res = await fetch(url, { headers: { authorization: `Bearer ${await accessToken(conn)}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Azure Key Vault ${res.status} for '${refBody}': ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const value: string | undefined = json?.value;
  if (value === undefined) throw new Error(`Azure Key Vault secret '${refBody}' has no value`);

  secretCache.set(url, { value, expiresAt: now + 5 * 60_000 });
  return value;
}

export const azureKeyVaultProvider: SecretProvider = {
  scheme: 'azure',
  resolve: (refBody) => resolve(refBody),
};
