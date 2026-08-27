// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCipheriv, pbkdf2Sync, randomBytes } from 'crypto';
import { resolveExternalSecret } from '../main/secrets';
import { signSigV4 } from '../main/secrets/providers/sigv4';
import { _resetAwsCache } from '../main/secrets/providers/aws';
import { _resetAzureCache } from '../main/secrets/providers/azure';
import { _resetOnePasswordCache } from '../main/secrets/providers/onepassword';
import { buildEnvVars } from '../main/interpolation';
import type { Environment } from '../shared/types';

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

const ENV_KEYS = [
  'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET',
  'OP_CONNECT_HOST', 'OP_CONNECT_TOKEN', 'API_SPECTOR_MASTER_KEY',
];
let savedEnv: Record<string, string | undefined>;
let savedFetch: typeof fetch;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  savedFetch = globalThis.fetch;
  for (const k of ENV_KEYS) delete process.env[k];
  _resetAwsCache();
  _resetAzureCache();
  _resetOnePasswordCache();
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  globalThis.fetch = savedFetch;
});

// ─── SigV4 (AWS published "get-vanilla" signing vector) ───────────────────────

describe('signSigV4', () => {
  it('matches the AWS SigV4 test-suite vector', () => {
    const headers = signSigV4({
      method: 'GET', host: 'example.amazonaws.com', path: '/', headers: {}, body: '',
      service: 'service', region: 'us-east-1',
      accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      now: new Date('2015-08-30T12:36:00Z'),
    });
    expect(headers.Authorization).toContain('SignedHeaders=host;x-amz-date');
    expect(headers.Authorization).toContain(
      'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });
});

// ─── AWS Secrets Manager ──────────────────────────────────────────────────────

describe('aws provider', () => {
  beforeEach(() => {
    process.env.AWS_REGION = 'eu-west-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIDEXAMPLE';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
  });

  it('reads a JSON secret field', async () => {
    mockFetch((url) => (url.includes('secretsmanager.eu-west-1.amazonaws.com')
      ? { SecretString: JSON.stringify({ password: 'pw', user: 'u' }) } : undefined));
    await expect(resolveExternalSecret('aws:prod/db#password')).resolves.toBe('pw');
  });

  it('reads a plain-string secret with no #key', async () => {
    mockFetch((url) => (url.includes('secretsmanager') ? { SecretString: 'plain-token' } : undefined));
    await expect(resolveExternalSecret('aws:prod/token')).resolves.toBe('plain-token');
  });

  it('throws when the JSON key is missing', async () => {
    mockFetch((url) => (url.includes('secretsmanager') ? { SecretString: JSON.stringify({ other: 1 }) } : undefined));
    await expect(resolveExternalSecret('aws:prod/db#password')).rejects.toThrow(/has no key 'password'/);
  });
});

// ─── Azure Key Vault ──────────────────────────────────────────────────────────

describe('azure provider', () => {
  beforeEach(() => {
    process.env.AZURE_TENANT_ID = 'tenant';
    process.env.AZURE_CLIENT_ID = 'client';
    process.env.AZURE_CLIENT_SECRET = 'secret';
  });

  it('gets a token then reads the secret value', async () => {
    const fetchMock = mockFetch(
      (url) => (url.includes('login.microsoftonline.com') ? { access_token: 'tok', expires_in: 3600 } : undefined),
      (url, init) => (url.includes('acme-kv.vault.azure.net/secrets/db-password')
        && init.headers.authorization === 'Bearer tok' ? { value: 'sekret' } : undefined),
    );
    await expect(resolveExternalSecret('azure:acme-kv/db-password')).resolves.toBe('sekret');
    expect(fetchMock).toHaveBeenCalledTimes(2); // token + read
  });

  it('accepts a full vault URL reference', async () => {
    mockFetch(
      (url) => (url.includes('login.microsoftonline.com') ? { access_token: 'tok', expires_in: 3600 } : undefined),
      (url) => (url.includes('acme-kv.vault.azure.net/secrets/api-key') ? { value: 'k' } : undefined),
    );
    await expect(resolveExternalSecret('azure:https://acme-kv.vault.azure.net/secrets/api-key')).resolves.toBe('k');
  });
});

// ─── 1Password (Connect) ──────────────────────────────────────────────────────

describe('1password provider', () => {
  beforeEach(() => {
    process.env.OP_CONNECT_HOST = 'https://op.acme.internal';
    process.env.OP_CONNECT_TOKEN = 'op-token';
  });

  it('resolves op://vault/item/field via Connect', async () => {
    const VID = 'a'.repeat(26);
    const IID = 'b'.repeat(26);
    mockFetch(
      (url) => (url.includes('/v1/vaults?filter=') ? [{ id: VID, name: 'Prod' }] : undefined),
      (url) => (url.includes(`/v1/vaults/${VID}/items?filter=`) ? [{ id: IID, title: 'Database' }] : undefined),
      (url) => (url.endsWith(`/v1/vaults/${VID}/items/${IID}`)
        ? { fields: [{ id: 'x', label: 'username', value: 'u' }, { id: 'y', label: 'password', value: 'pw' }] } : undefined),
    );
    await expect(resolveExternalSecret('op://Prod/Database/password')).resolves.toBe('pw');
  });

  it('throws when the field is absent', async () => {
    const VID = 'a'.repeat(26);
    const IID = 'b'.repeat(26);
    mockFetch(
      (url) => (url.includes('/v1/vaults?filter=') ? [{ id: VID }] : undefined),
      (url) => (url.includes(`/v1/vaults/${VID}/items?filter=`) ? [{ id: IID }] : undefined),
      (url) => (url.endsWith(`/items/${IID}`) ? { fields: [{ label: 'username', value: 'u' }] } : undefined),
    );
    await expect(resolveExternalSecret('op://Prod/Database/password')).rejects.toThrow(/field 'password' not found/);
  });
});

// ─── The built-in AES-256-GCM encryption still works (must stay) ──────────────

function encryptForTest(plaintext: string, password: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    secretEncrypted: Buffer.concat([enc, cipher.getAuthTag()]).toString('base64'),
    secretSalt: salt.toString('base64'),
    secretIv: iv.toString('base64'),
  };
}

describe('local AES-256-GCM secrets still resolve (unchanged by providers)', () => {
  it('decrypts an encrypted env variable with the master key', async () => {
    process.env.API_SPECTOR_MASTER_KEY = 'master-pw';
    const enc = encryptForTest('local-secret', 'master-pw');
    const env: Environment = {
      version: '1.0', id: 'e1', name: 'prod',
      variables: [{ key: 'LOCAL', value: '', enabled: true, secret: true, ...enc }],
    };
    const vars = await buildEnvVars(env);
    expect(vars.LOCAL).toBe('local-secret');
  });
});
