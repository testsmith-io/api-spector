// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { generateCiContent, secretManagerOf, ciFilePath, inlineSecretManagers, requestSecretManagers } from '../renderer/src/lib/ci-templates';
import type { ApiRequest } from '../shared/types';

function req(over: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: 'r1', name: 'r', method: 'GET', url: 'https://api.example.com',
    headers: [], params: [], auth: { type: 'none' } as ApiRequest['auth'],
    body: { mode: 'none' } as ApiRequest['body'], ...over,
  };
}

// ─── secretManagerOf ──────────────────────────────────────────────────────────

describe('secretManagerOf', () => {
  it('maps each reference scheme to its provider', () => {
    expect(secretManagerOf('vault:secret/data/app#token')).toBe('vault');
    expect(secretManagerOf('aws:prod/db#password')).toBe('aws');
    expect(secretManagerOf('azure:acme-kv/db-password')).toBe('azure');
    expect(secretManagerOf('op://Prod/Database/password')).toBe('op');
  });

  it('returns null for a plain value', () => {
    expect(secretManagerOf('just-a-value')).toBeNull();
  });
});

// ─── generateCiContent: encrypted secrets vs references ───────────────────────

describe('generateCiContent (GitHub)', () => {
  it('omits the master key when there are no encrypted secrets or references', () => {
    const yaml = generateCiContent('github', 'prod', '', [], []);
    expect(yaml).not.toContain('API_SPECTOR_MASTER_KEY');
    expect(yaml).not.toContain('VAULT_ADDR');
  });

  it('includes the master key only for at-rest encrypted secrets', () => {
    const yaml = generateCiContent('github', 'prod', '', ['DB_PASSWORD'], []);
    expect(yaml).toContain('API_SPECTOR_MASTER_KEY');
    expect(yaml).toContain('DB_PASSWORD');
  });

  it('does NOT require the master key for a Vault-only workspace', () => {
    const yaml = generateCiContent('github', 'prod', '', [], ['vault']);
    // A reference has no stored value to decrypt.
    expect(yaml).not.toContain('API_SPECTOR_MASTER_KEY');
  });

  it('wires the Vault OIDC step, id-token permission, and VAULT_ADDR', () => {
    const yaml = generateCiContent('github', 'prod', '', [], ['vault']);
    expect(yaml).toContain('hashicorp/vault-action@v3');
    expect(yaml).toContain('id-token: write');
    expect(yaml).toContain('VAULT_ADDR: ${{ vars.VAULT_ADDR }}');
    // OIDC means no long-lived role id / secret id in the env.
    expect(yaml).not.toContain('VAULT_ROLE_ID');
    expect(yaml).not.toContain('VAULT_SECRET_ID');
  });

  it('passes non-Vault provider credentials through as secrets', () => {
    const yaml = generateCiContent('github', 'prod', '', [], ['aws', 'op']);
    expect(yaml).toContain('AWS_REGION: ${{ secrets.AWS_REGION }}');
    expect(yaml).toContain('OP_CONNECT_TOKEN: ${{ secrets.OP_CONNECT_TOKEN }}');
    expect(yaml).not.toContain('id-token: write'); // no Vault, no OIDC
  });
});

describe('generateCiContent (GitLab / Azure use AppRole)', () => {
  it('GitLab wires Vault AppRole variables', () => {
    const yaml = generateCiContent('gitlab', 'prod', '', [], ['vault']);
    expect(yaml).toContain('VAULT_ADDR: $VAULT_ADDR');
    expect(yaml).toContain('VAULT_ROLE_ID: $VAULT_ROLE_ID');
    expect(yaml).toContain('VAULT_SECRET_ID: $VAULT_SECRET_ID');
  });

  it('Azure wires Vault AppRole variables', () => {
    const yaml = generateCiContent('azure', 'prod', '', [], ['vault']);
    expect(yaml).toContain('VAULT_ADDR: $(VAULT_ADDR)');
    expect(yaml).toContain('VAULT_ROLE_ID: $(VAULT_ROLE_ID)');
  });
});

// ─── inline reference detection ───────────────────────────────────────────────

describe('inlineSecretManagers', () => {
  it('detects each scheme wrapped in {{ }}', () => {
    expect(inlineSecretManagers('{{vault:secret/data/app#token}}')).toEqual(['vault']);
    expect(inlineSecretManagers('{{ aws:prod/db#password }}')).toEqual(['aws']); // tolerant of spaces
    expect(inlineSecretManagers('{{op://Prod/Db/password}}')).toEqual(['op']);
  });

  it('returns nothing for plain text or ordinary variables', () => {
    expect(inlineSecretManagers('{{BASE_URL}}/users')).toEqual([]);
    expect(inlineSecretManagers('')).toEqual([]);
    expect(inlineSecretManagers(undefined)).toEqual([]);
  });
});

describe('requestSecretManagers (scans body + scripts + more)', () => {
  it('finds a reference in the request body', () => {
    expect(requestSecretManagers(req({ body: { mode: 'raw', raw: '{"key":"{{vault:secret/data/app#k}}"}' } as ApiRequest['body'] })))
      .toEqual(['vault']);
  });

  it('finds a reference in a pre-request script', () => {
    expect(requestSecretManagers(req({ preRequestScript: 'const t = "{{aws:prod/api#token}}"' })))
      .toEqual(['aws']);
  });

  it('finds a reference in a post-request script', () => {
    expect(requestSecretManagers(req({ postRequestScript: 'sp.expect("{{op://V/I/f}}")' })))
      .toEqual(['op']);
  });

  it('finds references in a header value', () => {
    expect(requestSecretManagers(req({ headers: [{ key: 'X-Key', value: '{{azure:kv/secret}}', enabled: true }] as ApiRequest['headers'] })))
      .toEqual(['azure']);
  });

  it('returns nothing when a request uses no references', () => {
    expect(requestSecretManagers(req({ preRequestScript: 'console.log(1)' }))).toEqual([]);
  });
});

describe('ciFilePath', () => {
  it('maps platforms to their conventional file', () => {
    expect(ciFilePath('github')).toBe('.github/workflows/api-tests.yml');
    expect(ciFilePath('gitlab')).toBe('.gitlab-ci.yml');
    expect(ciFilePath('azure')).toBe('azure-pipelines.yml');
  });
});
