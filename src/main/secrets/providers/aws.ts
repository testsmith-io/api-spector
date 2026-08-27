// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { getSecretsConfig } from '../config';
import type { SecretProvider } from '../types';
import { signSigV4 } from './sigv4';

// AWS Secrets Manager provider. References look like `aws:<secretId>#<key>` when
// the secret stores JSON, or `aws:<secretId>` when it is a plain string.
//
// Credentials come from the standard AWS environment (AWS_ACCESS_KEY_ID,
// AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN) — so in CI you assume a role via
// OIDC in a prior step and API Spector just uses the exported credentials, and
// locally your existing `aws configure` / SSO env works. Region from AWS_REGION.

interface AwsConn {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

function env(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

function resolveConn(): AwsConn {
  const cfg = getSecretsConfig()?.aws ?? {};
  const region = env('AWS_REGION', 'AWS_DEFAULT_REGION', 'API_SPECTOR_AWS_REGION') ?? cfg.region;
  const accessKeyId = env('AWS_ACCESS_KEY_ID');
  const secretAccessKey = env('AWS_SECRET_ACCESS_KEY');
  if (!region) throw new Error('AWS Secrets Manager: no region (set AWS_REGION or settings.secrets.aws.region)');
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS Secrets Manager: no credentials (set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY)');
  }
  return { region, accessKeyId, secretAccessKey, sessionToken: env('AWS_SESSION_TOKEN') };
}

// Cached per secret id (the whole SecretString), reused for multiple keys.
const cache = new Map<string, { raw: string; expiresAt: number }>();

export function _resetAwsCache(): void {
  cache.clear();
}

async function getSecretString(conn: AwsConn, secretId: string): Promise<string> {
  const cacheKey = `${conn.region}|${secretId}`;
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > now) return hit.raw;

  const host = `secretsmanager.${conn.region}.amazonaws.com`;
  const body = JSON.stringify({ SecretId: secretId });
  const headers = signSigV4({
    method: 'POST',
    host,
    path: '/',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': 'secretsmanager.GetSecretValue',
    },
    body,
    service: 'secretsmanager',
    region: conn.region,
    accessKeyId: conn.accessKeyId,
    secretAccessKey: conn.secretAccessKey,
    sessionToken: conn.sessionToken,
    now: new Date(now),
  });

  const res = await fetch(`https://${host}/`, { method: 'POST', headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AWS Secrets Manager ${res.status} for '${secretId}': ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const raw: string | undefined = json?.SecretString;
  if (raw === undefined) throw new Error(`AWS secret '${secretId}' has no SecretString (binary secrets are not supported)`);

  cache.set(cacheKey, { raw, expiresAt: now + 5 * 60_000 });
  return raw;
}

async function resolve(refBody: string): Promise<string> {
  const hash = refBody.lastIndexOf('#');
  const secretId = hash < 0 ? refBody : refBody.slice(0, hash);
  const key = hash < 0 ? null : refBody.slice(hash + 1);
  if (!secretId) throw new Error(`AWS reference must be 'aws:<secretId>[#<key>]' (got 'aws:${refBody}')`);

  const raw = await getSecretString(resolveConn(), secretId);
  if (key === null) return raw; // plain-string secret

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`AWS secret '${secretId}' is not JSON, so key '${key}' cannot be read (drop the '#${key}')`);
  }
  if (!(key in parsed)) throw new Error(`AWS secret '${secretId}' has no key '${key}'`);
  return String(parsed[key]);
}

export const awsSecretsProvider: SecretProvider = {
  scheme: 'aws',
  resolve: (refBody) => resolve(refBody),
};
