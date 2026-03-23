export function buildCliArgs(wsPath: string, envName: string | null, tags: string[]): string {
  const parts = [`node out/main/runner.js --workspace ${wsPath}`];
  if (envName) parts.push(`--env "${envName}"`);
  if (tags.length) parts.push(`--tags "${tags.join(',')}"`);
  return parts.join(' ');
}

export function generateGitHub(envName: string | null, tags: string[]): string {
  const cmd = buildCliArgs('./workspace.json', envName, tags);
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
          node-version: '20'
      - run: npm ci
      - run: npm run build
      - name: Run API tests
        run: ${cmd}
        env:
          API_SPECTOR_MASTER_KEY: \${{ secrets.API_SPECTOR_MASTER_KEY }}
`;
}

export function generateAzure(envName: string | null, tags: string[]): string {
  const cmd = buildCliArgs('./workspace.json', envName, tags);
  return `trigger:
  - main

pool:
  vmImage: ubuntu-latest

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'
    displayName: 'Use Node 20'

  - script: npm ci
    displayName: 'Install dependencies'

  - script: npm run build
    displayName: 'Build'

  - script: ${cmd}
    displayName: 'Run API tests'
    env:
      API_SPECTOR_MASTER_KEY: $(API_SPECTOR_MASTER_KEY)
`;
}

export function generateGitLab(envName: string | null, tags: string[]): string {
  const cmd = buildCliArgs('./workspace.json', envName, tags);
  return `stages:
  - test

api-tests:
  stage: test
  image: node:20
  script:
    - npm ci
    - npm run build
    - ${cmd}
  variables:
    API_SPECTOR_MASTER_KEY: $API_SPECTOR_MASTER_KEY
`;
}
