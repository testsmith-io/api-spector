// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { GitRemote, CiPlatform, ApiRequest } from '../../../shared/types';

export function detectPlatform(remotes: GitRemote[]): CiPlatform {
  const urls = remotes.map(r => r.url.toLowerCase()).join(' ');
  if (urls.includes('github.com'))                                         return 'github';
  if (urls.includes('gitlab.com') || urls.includes('gitlab.'))            return 'gitlab';
  if (urls.includes('dev.azure.com') || urls.includes('visualstudio.com')) return 'azure';
  return 'unknown';
}

const NODE_LTS = 'lts/*';

// External secret managers a workspace can reference (vault:, aws:, azure:, op://).
export type SecretManagerKind = 'vault' | 'aws' | 'azure' | 'op';

// The environment each provider reads to authenticate. Kept in sync with
// docs/reference/secrets-vault.md. On GitHub, Vault is authenticated with the
// OIDC action instead (VAULT_TOKEN is exported by the step), so only VAULT_ADDR
// is passed through there — see githubVaultStep / the github branch below.
const PROVIDER_ENV: Record<SecretManagerKind, string[]> = {
  vault: ['VAULT_ADDR', 'VAULT_ROLE_ID', 'VAULT_SECRET_ID'],
  aws:   ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
  azure: ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'],
  op:    ['OP_CONNECT_HOST', 'OP_CONNECT_TOKEN'],
};

// Map a secret-manager reference (from an env var's secretRef) to its provider.
export function secretManagerOf(ref: string): SecretManagerKind | null {
  if (ref.startsWith('op://')) return 'op';
  const scheme = ref.split(':', 1)[0];
  if (scheme === 'vault' || scheme === 'aws' || scheme === 'azure') return scheme;
  return null;
}

// Inline references are written as {{vault:...}} / {{aws:...}} / {{azure:...}} /
// {{op://...}} and can appear anywhere a variable can: URL, headers, params,
// body, auth fields, and pre/post-request scripts.
const INLINE_REF_RE = /\{\{\s*(vault:|aws:|azure:|op:\/\/)/g;

export function inlineSecretManagers(text: string | null | undefined): SecretManagerKind[] {
  if (!text) return [];
  const kinds = new Set<SecretManagerKind>();
  for (const m of text.matchAll(INLINE_REF_RE)) {
    kinds.add(m[1] === 'op://' ? 'op' : (m[1].slice(0, -1) as SecretManagerKind));
  }
  return [...kinds];
}

// Every secret manager a request references inline. Serializing the whole request
// covers URL, headers, params, body, auth, and the pre/post/introspection
// scripts in one pass, and stays correct as new text fields are added.
export function requestSecretManagers(req: ApiRequest): SecretManagerKind[] {
  return inlineSecretManagers(JSON.stringify(req));
}

// De-duped provider env var names for the given managers.
function providerEnvVars(managers: SecretManagerKind[]): string[] {
  return [...new Set(managers.flatMap(k => PROVIDER_ENV[k]))];
}

export function generateCiContent(
  platform: CiPlatform,
  envName: string,
  tags: string,
  secretVars: string[],
  secretManagers: SecretManagerKind[] = [],
): string {
  const runCmd = [
    'api-spector run --workspace .',
    envName ? `--environment "${envName}"` : '',
    tags    ? `--tags "${tags}"` : '',
    '--output results.html',
  ].filter(Boolean).join(' ');

  const managers = [...new Set(secretManagers)];
  const usesVault = managers.includes('vault');

  // API_SPECTOR_MASTER_KEY is only needed to decrypt at-rest secrets; a
  // secret-manager reference has no stored value to decrypt.
  const encryptedVars = secretVars.length ? ['API_SPECTOR_MASTER_KEY', ...secretVars] : [];

  if (platform === 'github') {
    // On GitHub, Vault uses OIDC (the vault-action step exports VAULT_TOKEN), so
    // only VAULT_ADDR is passed through; the other providers pass their creds.
    const ghProviderEnv = providerEnvVars(managers).filter(v => v !== 'VAULT_ROLE_ID' && v !== 'VAULT_SECRET_ID');
    const allSecretVars = [...encryptedVars, ...ghProviderEnv.filter(v => v !== 'VAULT_ADDR')];
    const hintLines = [
      ...allSecretVars.map(v => `      #   ${v}`),
      ...(usesVault ? ['      #   VAULT_ADDR   (as a repository variable, not a secret)'] : []),
    ];
    const secretHint = hintLines.length
      ? `      # ⚠ Add these in: Settings → Secrets and variables → Actions\n${hintLines.join('\n')}\n`
      : '';

    // Vault via workload identity: exchange the job's OIDC token for a
    // short-lived Vault token (exported as VAULT_TOKEN). Nothing is stored.
    const vaultStep = usesVault
      ? `      - name: Authenticate to Vault (OIDC)
        uses: hashicorp/vault-action@v3
        with:
          url: \${{ vars.VAULT_ADDR }}
          method: jwt
          role: apispector-ci          # your Vault JWT/OIDC role
          exportToken: true            # sets VAULT_TOKEN for later steps
`
      : '';
    const permissions = usesVault
      ? `    permissions:
      contents: read
      id-token: write                  # required for Vault OIDC
`
      : '';

    const envEntries = [
      ...allSecretVars.map(v => `          ${v}: \${{ secrets.${v} }}`),
      ...(usesVault ? ['          VAULT_ADDR: ${{ vars.VAULT_ADDR }}'] : []),
    ];
    const envBlock = envEntries.length ? '\n        env:\n' + envEntries.join('\n') : '';
    return `name: API Tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  api-tests:
    runs-on: ubuntu-latest
${permissions}    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '${NODE_LTS}'
      - run: npm install -g @testsmith/api-spector
${vaultStep}${secretHint}      - name: Run API tests
        run: ${runCmd}${envBlock}
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: api-test-results
          path: results.html
`;
  }

  if (platform === 'gitlab') {
    // No turnkey OIDC action here — Vault authenticates with AppRole from CI
    // variables (VAULT_ADDR + VAULT_ROLE_ID + VAULT_SECRET_ID).
    const allSecretVars = [...encryptedVars, ...providerEnvVars(managers)];
    const secretHint = allSecretVars.length
      ? `  # ⚠ Add these in: Settings → CI/CD → Variables\n` +
        allSecretVars.map(v => `  #   ${v}`).join('\n') + '\n'
      : '';
    const envBlock = allSecretVars.length
      ? '\n  variables:\n' + allSecretVars.map(v => `    ${v}: $${v}`).join('\n')
      : '';
    return `api-tests:
  image: node:${NODE_LTS}
  stage: test
  before_script:
    - npm install -g @testsmith/api-spector
${secretHint}  script:
    - ${runCmd}${envBlock}
  artifacts:
    when: always
    paths:
      - results.html
    expire_in: 30 days
`;
  }

  if (platform === 'azure') {
    const allSecretVars = [...encryptedVars, ...providerEnvVars(managers)];
    const secretHint = allSecretVars.length
      ? `  # ⚠ Add these in: Pipelines → Library → Variable groups (mark as secret)\n` +
        allSecretVars.map(v => `  #   ${v}`).join('\n') + '\n'
      : '';
    const envBlock = allSecretVars.length
      ? '\n    env:\n' + allSecretVars.map(v => `      ${v}: $(${v})`).join('\n')
      : '';
    return `trigger:
  - main

pool:
  vmImage: ubuntu-latest

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '${NODE_LTS}.x'
    displayName: 'Use Node.js ${NODE_LTS}'
  - script: npm install -g @testsmith/api-spector
    displayName: 'Install API Spector'
${secretHint}  - script: ${runCmd}
    displayName: 'Run API tests'${envBlock}
  - publish: results.html
    artifact: api-test-results
    displayName: 'Upload test results'
    condition: always()
`;
  }

  return `# Unsupported platform - adapt as needed\n# ${runCmd}\n`;
}

export function ciFilePath(platform: CiPlatform): string {
  if (platform === 'github') return '.github/workflows/api-tests.yml';
  if (platform === 'gitlab') return '.gitlab-ci.yml';
  if (platform === 'azure')  return 'azure-pipelines.yml';
  return 'ci.yml';
}
