// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { getSecretsConfig } from '../config';
import type { SecretProvider } from '../types';

// GCP Secret Manager provider. References look like:
//   gcp:<project>/<secret>                     latest version
//   gcp:<project>/<secret>/<version>           a numeric version or "latest"
//   gcp:<secret>                               uses the default project
//   gcp:projects/<p>/secrets/<s>/versions/<v>  a full resource name
// and, when the secret payload is JSON, a trailing `#<key>` extracts one field:
//   gcp:prod/db-creds#password
//
// Authentication, in priority order, so the same workspace runs unchanged on a
// laptop and in CI:
//   1. GCP_ACCESS_TOKEN / GOOGLE_OAUTH_ACCESS_TOKEN — a pre-obtained OAuth token
//      (`gcloud auth print-access-token`, or exported by a Workload Identity
//      Federation step in CI). Used as-is.
//   2. A service-account key, as inline JSON in GCP_SERVICE_ACCOUNT_KEY /
//      GOOGLE_APPLICATION_CREDENTIALS_JSON, or a path in the standard
//      GOOGLE_APPLICATION_CREDENTIALS. API Spector mints a signed JWT and
//      exchanges it for an access token (no google-cloud SDK needed).
// The default project comes from GCP_PROJECT / GOOGLE_CLOUD_PROJECT, else
// settings.secrets.gcp.project, else the key's own project_id.

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
  project_id?: string;
}

interface GcpConn {
  /** Pre-obtained OAuth access token (option 1), if present. */
  accessToken?: string;
  /** Parsed service-account key (option 2), if present. */
  serviceAccount?: ServiceAccountKey;
  /** Default project for refs that omit it. */
  defaultProject?: string;
}

const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const API_BASE = 'https://secretmanager.googleapis.com/v1';

function env(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

function loadServiceAccount(): ServiceAccountKey | undefined {
  const inline = env('GCP_SERVICE_ACCOUNT_KEY', 'GOOGLE_APPLICATION_CREDENTIALS_JSON');
  const path = env('GOOGLE_APPLICATION_CREDENTIALS');
  let raw: string | undefined;
  if (inline) {
    raw = inline;
  } else if (path) {
    try {
      raw = readFileSync(path, 'utf8');
    } catch (e) {
      throw new Error(`GCP Secret Manager: cannot read GOOGLE_APPLICATION_CREDENTIALS '${path}': ${(e as Error).message}`);
    }
  }
  if (!raw) return undefined;

  let key: ServiceAccountKey;
  try {
    key = JSON.parse(raw);
  } catch {
    throw new Error('GCP Secret Manager: the service-account key is not valid JSON');
  }
  if (!key.client_email || !key.private_key) {
    throw new Error('GCP Secret Manager: the service-account key is missing client_email or private_key');
  }
  return key;
}

function resolveConn(): GcpConn {
  const cfg = getSecretsConfig()?.gcp ?? {};
  const accessToken = env('GCP_ACCESS_TOKEN', 'GOOGLE_OAUTH_ACCESS_TOKEN');
  const serviceAccount = loadServiceAccount();
  if (!accessToken && !serviceAccount) {
    throw new Error(
      'GCP Secret Manager: no credentials (set GCP_ACCESS_TOKEN, or GOOGLE_APPLICATION_CREDENTIALS / GOOGLE_APPLICATION_CREDENTIALS_JSON to a service-account key)',
    );
  }
  const defaultProject =
    env('GCP_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT') ?? cfg.project ?? serviceAccount?.project_id;
  return { accessToken, serviceAccount, defaultProject };
}

let cachedToken: { value: string; expiresAt: number } | null = null;
const secretCache = new Map<string, { value: string; expiresAt: number }>();

export function _resetGcpCache(): void {
  cachedToken = null;
  secretCache.clear();
}

const b64url = (b: Buffer | string): string =>
  (Buffer.isBuffer(b) ? b : Buffer.from(b)).toString('base64url');

// Mint a service-account JWT (RS256) and exchange it for an OAuth access token.
async function mintAccessToken(sa: ServiceAccountKey): Promise<{ token: string; ttl: number }> {
  const iat = Math.floor(Date.now() / 1000);
  const aud = sa.token_uri || TOKEN_URI;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud, iat, exp: iat + 3600 }));
  const signingInput = `${header}.${claims}`;
  const signature = b64url(createSign('RSA-SHA256').update(signingInput).sign(sa.private_key));
  const assertion = `${signingInput}.${signature}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const res = await fetch(aud, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GCP token exchange ${res.status}: ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const token: string | undefined = json?.access_token;
  if (!token) throw new Error('GCP token endpoint did not return an access_token');
  return { token, ttl: Number(json?.expires_in ?? 3600) };
}

async function accessToken(conn: GcpConn): Promise<string> {
  if (conn.accessToken) return conn.accessToken; // caller-supplied; its lifetime is their concern
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) return cachedToken.value;

  const { token, ttl } = await mintAccessToken(conn.serviceAccount!);
  cachedToken = { value: token, expiresAt: ttl > 0 ? now + ttl * 1000 : now + 5 * 60_000 };
  return token;
}

// Build the Secret Manager `:access` URL from a reference body (minus any #key).
function accessUrl(refPath: string, defaultProject?: string): string {
  // Full resource name: projects/<p>/secrets/<s>[/versions/<v>]
  if (refPath.startsWith('projects/')) {
    const hasVersion = /\/versions\/[^/]+$/.test(refPath);
    const full = hasVersion ? refPath : `${refPath.replace(/\/+$/, '')}/versions/latest`;
    return `${API_BASE}/${full}:access`;
  }
  const parts = refPath.replace(/^\/+/, '').split('/').filter(Boolean);
  let project: string | undefined;
  let secret: string;
  let version = 'latest';
  if (parts.length >= 2) {
    [project, secret, version = 'latest'] = parts;
  } else if (parts.length === 1) {
    project = defaultProject;
    secret = parts[0];
  } else {
    throw new Error(`GCP reference must be 'gcp:<project>/<secret>[/<version>]' (got 'gcp:${refPath}')`);
  }
  if (!project) {
    throw new Error(
      `GCP reference 'gcp:${refPath}' has no project and no default is set (set GCP_PROJECT or settings.secrets.gcp.project, or write 'gcp:<project>/<secret>')`,
    );
  }
  return `${API_BASE}/projects/${project}/secrets/${secret}/versions/${version}:access`;
}

async function resolve(refBody: string): Promise<string> {
  const hash = refBody.lastIndexOf('#');
  // A '#' inside "versions/.." is impossible, so lastIndexOf is safe here.
  const refPath = hash < 0 ? refBody : refBody.slice(0, hash);
  const key = hash < 0 ? null : refBody.slice(hash + 1);

  const conn = resolveConn();
  const url = accessUrl(refPath, conn.defaultProject);
  const now = Date.now();
  const hit = secretCache.get(url);
  const rawPayload = hit && hit.expiresAt > now ? hit.value : await fetchPayload(conn, url, refBody);

  if (key === null) return rawPayload; // plain secret
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    throw new Error(`GCP secret '${refPath}' is not JSON, so key '${key}' cannot be read (drop the '#${key}')`);
  }
  if (!(key in parsed)) throw new Error(`GCP secret '${refPath}' has no key '${key}'`);
  return String(parsed[key]);
}

async function fetchPayload(conn: GcpConn, url: string, refBody: string): Promise<string> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${await accessToken(conn)}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GCP Secret Manager ${res.status} for '${refBody}': ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const data: string | undefined = json?.payload?.data;
  if (data === undefined) throw new Error(`GCP secret '${refBody}' returned no payload data`);
  const value = Buffer.from(data, 'base64').toString('utf8');
  secretCache.set(url, { value, expiresAt: Date.now() + 5 * 60_000 });
  return value;
}

export const gcpSecretManagerProvider: SecretProvider = {
  scheme: 'gcp',
  resolve: (refBody) => resolve(refBody),
};
