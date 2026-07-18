// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { GitRemote, CiPlatform } from '../../../shared/types';

export function detectPlatform(remotes: GitRemote[]): CiPlatform {
  const urls = remotes.map(r => r.url.toLowerCase()).join(' ');
  if (urls.includes('github.com'))                                         return 'github';
  if (urls.includes('gitlab.com') || urls.includes('gitlab.'))            return 'gitlab';
  if (urls.includes('dev.azure.com') || urls.includes('visualstudio.com')) return 'azure';
  return 'unknown';
}

const NODE_LTS = 'lts/*';

export function generateCiContent(
  platform: CiPlatform,
  envName: string,
  tags: string,
  secretVars: string[],
): string {
  const runCmd = [
    'api-spector run --workspace .',
    envName ? `--environment "${envName}"` : '',
    tags    ? `--tags "${tags}"` : '',
    '--output results.html',
  ].filter(Boolean).join(' ');

  // Always include API_SPECTOR_MASTER_KEY when there are encrypted secrets
  const allSecretVars = secretVars.length ? ['API_SPECTOR_MASTER_KEY', ...secretVars] : [];

  if (platform === 'github') {
    const secretHint = allSecretVars.length
      ? `      # ⚠ Add these secrets in: Settings → Secrets and variables → Actions\n` +
        allSecretVars.map(v => `      #   ${v}`).join('\n') + '\n'
      : '';
    const envBlock = allSecretVars.length
      ? '\n        env:\n' + allSecretVars.map(v => `          ${v}: \${{ secrets.${v} }}`).join('\n')
      : '';
    return `name: API Tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  api-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '${NODE_LTS}'
      - run: npm install -g @testsmith/api-spector
${secretHint}      - name: Run API tests
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
