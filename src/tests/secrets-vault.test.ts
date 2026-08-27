// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hasSecretScheme, resolveExternalSecret, setSecretsConfig } from '../main/secrets';
import { _resetVaultCache } from '../main/secrets/providers/vault';
import { getSecret } from '../main/ipc/secret-handler';
import { buildEnvVars, interpolate } from '../main/interpolation';
import { resolveInlineSecrets } from '../main/request-exec';
import type { ApiRequest } from '../shared/types';
import type { Environment } from '../shared/types';

// ─── Fake Vault over a mocked fetch ───────────────────────────────────────────

type Route = (url: string, init: any) => unknown | undefined;

function mockVault(...routes: Route[]): ReturnType<typeof vi.fn> {
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
  'VAULT_ADDR', 'VAULT_TOKEN', 'VAULT_NAMESPACE', 'VAULT_ROLE_ID', 'VAULT_SECRET_ID',
  'VAULT_JWT', 'VAULT_JWT_ROLE', 'VAULT_AUTH_METHOD', 'VAULT_KV_VERSION',
];
// HOME/USERPROFILE are redirected to a bogus dir so the provider's ~/.vault-token
// fallback never picks up the developer's real Vault token during tests.
const HOME_KEYS = ['HOME', 'USERPROFILE'];
let savedEnv: Record<string, string | undefined>;
let savedFetch: typeof fetch;

beforeEach(() => {
  savedEnv = Object.fromEntries([...ENV_KEYS, ...HOME_KEYS].map(k => [k, process.env[k]]));
  savedFetch = globalThis.fetch;
  for (const k of ENV_KEYS) delete process.env[k];
  for (const k of HOME_KEYS) process.env[k] = '/nonexistent-api-spector-test-home';
  _resetVaultCache();
  setSecretsConfig(undefined);
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  globalThis.fetch = savedFetch;
  _resetVaultCache();
  setSecretsConfig(undefined);
});

// ─── scheme detection ─────────────────────────────────────────────────────────

describe('secret scheme detection', () => {
  it('recognises registered schemes only', () => {
    expect(hasSecretScheme('vault:secret/data/app#token')).toBe(true);
    expect(hasSecretScheme('aws:prod/db#password')).toBe(true);
    expect(hasSecretScheme('PLAIN_ENV_NAME')).toBe(false);
    expect(hasSecretScheme('gcp:foo')).toBe(false); // not registered
  });
});

// ─── Vault provider ───────────────────────────────────────────────────────────

describe('vault provider', () => {
  it('reads a KV v2 secret with token auth', async () => {
    process.env.VAULT_ADDR = 'https://vault.test';
    process.env.VAULT_TOKEN = 'root-token';
    const fetchMock = mockVault((url, init) =>
      url.endsWith('/v1/secret/data/app') && init.headers['X-Vault-Token'] === 'root-token'
        ? { data: { data: { token: 's3cr3t' }, metadata: { version: 1 } } }
        : undefined,
    );

    await expect(resolveExternalSecret('vault:secret/data/app#token')).resolves.toBe('s3cr3t');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('is reachable through getSecret() (auth *SecretRef path)', async () => {
    process.env.VAULT_ADDR = 'https://vault.test';
    process.env.VAULT_TOKEN = 'root-token';
    mockVault((url) =>
      url.endsWith('/v1/secret/data/app') ? { data: { data: { token: 'from-getSecret' }, metadata: {} } } : undefined,
    );

    await expect(getSecret('vault:secret/data/app#token')).resolves.toBe('from-getSecret');
    // A ref without a registered scheme still falls through to env.
    process.env.PLAIN = 'plain-value';
    await expect(getSecret('PLAIN')).resolves.toBe('plain-value');
    delete process.env.PLAIN;
  });

  it('reads a KV v1 secret when kvVersion=1', async () => {
    process.env.VAULT_ADDR = 'https://vault.test';
    process.env.VAULT_TOKEN = 't';
    process.env.VAULT_KV_VERSION = '1';
    mockVault((url) => (url.endsWith('/v1/kv/app') ? { data: { password: 'p1' } } : undefined));

    await expect(resolveExternalSecret('vault:kv/app#password')).resolves.toBe('p1');
  });

  it('logs in with AppRole, then reads (token cached across reads)', async () => {
    process.env.VAULT_ADDR = 'https://vault.test';
    process.env.VAULT_ROLE_ID = 'role-1';
    process.env.VAULT_SECRET_ID = 'secret-1';
    const fetchMock = mockVault(
      (url, init) =>
        url.endsWith('/v1/auth/approle/login') && init.method === 'POST'
          ? { auth: { client_token: 'derived-token', lease_duration: 600 } }
          : undefined,
      (url, init) =>
        url.endsWith('/v1/secret/data/app') && init.headers['X-Vault-Token'] === 'derived-token'
          ? { data: { data: { user: 'u', pass: 'pw' }, metadata: {} } }
          : undefined,
    );

    await expect(resolveExternalSecret('vault:secret/data/app#user')).resolves.toBe('u');
    await expect(resolveExternalSecret('vault:secret/data/app#pass')).resolves.toBe('pw');
    // 1 login + 1 read (second read is cache-hit; login token cached).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a clear error when the key is missing', async () => {
    process.env.VAULT_ADDR = 'https://vault.test';
    process.env.VAULT_TOKEN = 't';
    mockVault((url) => (url.endsWith('/v1/secret/data/app') ? { data: { data: { other: 'x' }, metadata: {} } } : undefined));

    await expect(resolveExternalSecret('vault:secret/data/app#token'))
      .rejects.toThrow(/has no key 'token'/);
  });

  it('throws when Vault is not configured', async () => {
    await expect(resolveExternalSecret('vault:secret/data/app#token'))
      .rejects.toThrow(/not configured/);
  });
});

// ─── environment-variable resolution (buildEnvVars) ───────────────────────────

describe('inline {{vault:...}} references in a request', () => {
  it('resolves refs found in body, url and scripts, then interpolate() substitutes them', async () => {
    process.env.VAULT_ADDR = 'https://vault.test';
    process.env.VAULT_TOKEN = 't';
    mockVault((url) => (url.endsWith('/v1/secret/data/app')
      ? { data: { data: { token: 's3cr3t', host: 'api.example.com' }, metadata: {} } } : undefined));

    const req = {
      url: 'https://{{vault:secret/data/app#host}}/v1/pay',
      params: [],
      headers: [],
      body: { mode: 'raw', raw: '{"apiKey":"{{vault:secret/data/app#token}}"}' },
      auth: { type: 'none' },
      preRequestScript: 'sp.environment.set("t", "{{vault:secret/data/app#token}}")',
    } as unknown as ApiRequest;

    const resolved = await resolveInlineSecrets(req);
    expect(resolved['vault:secret/data/app#token']).toBe('s3cr3t');
    expect(resolved['vault:secret/data/app#host']).toBe('api.example.com');

    // The synchronous interpolate() then substitutes them like any other var.
    expect(interpolate(req.body!.raw!, resolved)).toBe('{"apiKey":"s3cr3t"}');
    expect(interpolate(req.url, resolved)).toBe('https://api.example.com/v1/pay');
  });

  it('resolves nothing when there are no external refs', async () => {
    const req = {
      url: 'https://api.example.com', params: [], headers: [],
      body: { mode: 'raw', raw: '{"x":"{{PLAIN_VAR}}"}' }, auth: { type: 'none' },
    } as unknown as ApiRequest;
    await expect(resolveInlineSecrets(req)).resolves.toEqual({});
  });
});

describe('buildEnvVars with a vault secretRef', () => {
  it('resolves a secretRef env variable to its value', async () => {
    process.env.VAULT_ADDR = 'https://vault.test';
    process.env.VAULT_TOKEN = 't';
    mockVault((url) => (url.endsWith('/v1/secret/data/app') ? { data: { data: { apiToken: 'abc123' }, metadata: {} } } : undefined));

    const env: Environment = {
      version: '1.0', id: 'e1', name: 'prod',
      variables: [{ key: 'API_TOKEN', value: '', enabled: true, secretRef: 'vault:secret/data/app#apiToken' }],
    };

    const vars = await buildEnvVars(env);
    expect(vars.API_TOKEN).toBe('abc123');
  });

  it('leaves the var unset (does not throw) when resolution fails', async () => {
    // no VAULT_ADDR -> provider throws -> buildEnvVars warns and continues
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env: Environment = {
      version: '1.0', id: 'e1', name: 'prod',
      variables: [{ key: 'API_TOKEN', value: '', enabled: true, secretRef: 'vault:secret/data/app#apiToken' }],
    };

    const vars = await buildEnvVars(env);
    expect(vars.API_TOKEN).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
