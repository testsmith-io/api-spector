// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hasSecretScheme, resolveExternalSecret, setSecretsConfig } from '../main/secrets';
import { _resetGcpCache } from '../main/secrets/providers/gcp';

// ─── Fake Secret Manager over a mocked fetch ──────────────────────────────────
// Each route sees (url, init) and returns a body (match) or undefined (skip).

type Route = (url: string, init: any) => unknown | undefined;

function mockFetch(...routes: Route[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string, init: any = {}) => {
    for (const r of routes) {
      const body = r(String(url), init);
      if (body !== undefined) {
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'no route' };
  });
  // @ts-expect-error override global fetch for the test
  globalThis.fetch = fn;
  return fn;
}

// A Secret Manager :access response carries the payload base64-encoded.
const access = (plain: string) => ({ payload: { data: Buffer.from(plain, 'utf8').toString('base64') } });

const ENV_KEYS = [
  'GCP_ACCESS_TOKEN', 'GOOGLE_OAUTH_ACCESS_TOKEN', 'GCP_PROJECT', 'GOOGLE_CLOUD_PROJECT',
  'CLOUDSDK_CORE_PROJECT', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  'GCP_SERVICE_ACCOUNT_KEY',
];
let savedEnv: Record<string, string | undefined>;
let savedFetch: typeof fetch;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  savedFetch = globalThis.fetch;
  for (const k of ENV_KEYS) delete process.env[k];
  _resetGcpCache();
  setSecretsConfig(undefined);
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  globalThis.fetch = savedFetch;
  _resetGcpCache();
  setSecretsConfig(undefined);
});

describe('gcp scheme detection', () => {
  it('is a registered scheme', () => {
    expect(hasSecretScheme('gcp:my-project/db#password')).toBe(true);
    expect(hasSecretScheme('gcp:just-a-secret')).toBe(true);
  });
});

describe('gcp provider (access-token auth)', () => {
  it('reads the latest version of a secret with project in the ref', async () => {
    process.env.GCP_ACCESS_TOKEN = 'ya29.token';
    const fetchMock = mockFetch((url, init) =>
      url === 'https://secretmanager.googleapis.com/v1/projects/proj/secrets/api-key/versions/latest:access'
        && init.headers.authorization === 'Bearer ya29.token'
        ? access('s3cr3t') : undefined,
    );

    await expect(resolveExternalSecret('gcp:proj/api-key')).resolves.toBe('s3cr3t');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('honours an explicit version', async () => {
    process.env.GCP_ACCESS_TOKEN = 't';
    mockFetch((url) =>
      url.endsWith('/projects/proj/secrets/api-key/versions/3:access') ? access('v3-value') : undefined);

    await expect(resolveExternalSecret('gcp:proj/api-key/3')).resolves.toBe('v3-value');
  });

  it('uses the default project (settings) when the ref omits it', async () => {
    process.env.GCP_ACCESS_TOKEN = 't';
    setSecretsConfig({ gcp: { project: 'default-proj' } });
    mockFetch((url) =>
      url.endsWith('/projects/default-proj/secrets/token/versions/latest:access') ? access('abc') : undefined);

    await expect(resolveExternalSecret('gcp:token')).resolves.toBe('abc');
  });

  it('extracts a key from a JSON secret and caches the payload', async () => {
    process.env.GCP_ACCESS_TOKEN = 't';
    const fetchMock = mockFetch((url) =>
      url.endsWith('/projects/proj/secrets/db-creds/versions/latest:access')
        ? access(JSON.stringify({ user: 'u', password: 'pw' })) : undefined);

    await expect(resolveExternalSecret('gcp:proj/db-creds#password')).resolves.toBe('pw');
    await expect(resolveExternalSecret('gcp:proj/db-creds#user')).resolves.toBe('u');
    // second read is served from the payload cache — no extra fetch
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('throws a clear error when the JSON key is missing', async () => {
    process.env.GCP_ACCESS_TOKEN = 't';
    mockFetch((url) =>
      url.endsWith('/projects/proj/secrets/db-creds/versions/latest:access')
        ? access(JSON.stringify({ user: 'u' })) : undefined);

    await expect(resolveExternalSecret('gcp:proj/db-creds#password')).rejects.toThrow(/has no key 'password'/);
  });

  it('errors when a ref omits the project and no default is set', async () => {
    process.env.GCP_ACCESS_TOKEN = 't';
    await expect(resolveExternalSecret('gcp:lonely-secret')).rejects.toThrow(/has no project/);
  });

  it('errors when no credentials are configured', async () => {
    await expect(resolveExternalSecret('gcp:proj/secret')).rejects.toThrow(/no credentials/);
  });

  it('surfaces a non-200 from Secret Manager', async () => {
    process.env.GCP_ACCESS_TOKEN = 't';
    // no route matches -> mocked fetch returns 404
    mockFetch();
    await expect(resolveExternalSecret('gcp:proj/missing')).rejects.toThrow(/GCP Secret Manager 404/);
  });
});

describe('gcp provider (service-account JWT auth)', () => {
  // A throwaway RSA key so createSign() has a real PEM to sign with.
  function rsaPem(): string {
    // Generated at test time to avoid committing a key; small for speed.
    const { generateKeyPairSync } = require('node:crypto');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  }

  it('mints a token via the JWT bearer flow, then reads the secret', async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify({
      client_email: 'sa@proj.iam.gserviceaccount.com',
      private_key: rsaPem(),
      project_id: 'proj',
      token_uri: 'https://oauth2.googleapis.com/token',
    });

    const fetchMock = mockFetch(
      (url, init) =>
        url === 'https://oauth2.googleapis.com/token' && init.method === 'POST'
          && String(init.body).includes('grant-type%3Ajwt-bearer')
          ? { access_token: 'minted-token', expires_in: 3600 } : undefined,
      (url, init) =>
        url.endsWith('/projects/proj/secrets/api-key/versions/latest:access')
          && init.headers.authorization === 'Bearer minted-token'
          ? access('from-jwt') : undefined,
    );

    // project omitted in the ref -> falls back to the key's project_id
    await expect(resolveExternalSecret('gcp:api-key')).resolves.toBe('from-jwt');
    // 1 token exchange + 1 secret read
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
