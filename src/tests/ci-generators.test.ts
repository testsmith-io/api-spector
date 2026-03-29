// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { describe, it, expect } from 'vitest';
import { buildCliArgs, generateGitHub, generateAzure, generateGitLab } from '../shared/ci-generators';

// ─── buildCliArgs ─────────────────────────────────────────────────────────────

describe('buildCliArgs', () => {
  it('produces a minimal command with only workspace path', () => {
    expect(buildCliArgs('./ws.json', null, []))
      .toBe('node out/main/runner.js --workspace ./ws.json');
  });

  it('appends --env when envName is provided', () => {
    const result = buildCliArgs('./ws.json', 'production', []);
    expect(result).toContain('--env "production"');
  });

  it('does not append --env when envName is null', () => {
    expect(buildCliArgs('./ws.json', null, [])).not.toContain('--env');
  });

  it('appends --tags with comma-joined values', () => {
    const result = buildCliArgs('./ws.json', null, ['smoke', 'regression']);
    expect(result).toContain('--tags "smoke,regression"');
  });

  it('does not append --tags when list is empty', () => {
    expect(buildCliArgs('./ws.json', null, [])).not.toContain('--tags');
  });

  it('combines env and tags correctly', () => {
    const result = buildCliArgs('./ws.json', 'staging', ['smoke']);
    expect(result).toContain('--env "staging"');
    expect(result).toContain('--tags "smoke"');
  });

  it('preserves exact workspace path', () => {
    const result = buildCliArgs('/absolute/path/workspace.json', null, []);
    expect(result).toContain('--workspace /absolute/path/workspace.json');
  });
});

// ─── generateGitHub ───────────────────────────────────────────────────────────

describe('generateGitHub', () => {
  it('contains API_SPECTOR_MASTER_KEY secret reference', () => {
    expect(generateGitHub(null, [])).toContain('API_SPECTOR_MASTER_KEY');
  });

  it('injects environment flag when envName is provided', () => {
    expect(generateGitHub('test-env', [])).toContain('--env "test-env"');
  });

  it('injects tags flag when tags are provided', () => {
    expect(generateGitHub(null, ['smoke'])).toContain('--tags "smoke"');
  });

  it('starts with "name:" (valid GitHub Actions top-level key)', () => {
    expect(generateGitHub(null, [])).toMatch(/^name:/);
  });

  it('includes checkout and setup-node actions', () => {
    const yaml = generateGitHub(null, []);
    expect(yaml).toContain('actions/checkout');
    expect(yaml).toContain('actions/setup-node');
  });

  it('specifies Node 20', () => {
    expect(generateGitHub(null, [])).toContain("node-version: '20'");
  });

  it('includes push trigger on main branch', () => {
    const yaml = generateGitHub(null, []);
    expect(yaml).toContain('push:');
    expect(yaml).toContain('branches: [main]');
  });
});

// ─── generateAzure ────────────────────────────────────────────────────────────

describe('generateAzure', () => {
  it('contains API_SPECTOR_MASTER_KEY variable', () => {
    expect(generateAzure(null, [])).toContain('API_SPECTOR_MASTER_KEY');
  });

  it('injects environment flag when envName is provided', () => {
    expect(generateAzure('staging', [])).toContain('--env "staging"');
  });

  it('injects tags flag when tags are provided', () => {
    expect(generateAzure(null, ['smoke', 'api'])).toContain('--tags "smoke,api"');
  });

  it('uses Azure pipeline structure (trigger / pool / steps)', () => {
    const yaml = generateAzure(null, []);
    expect(yaml).toContain('trigger:');
    expect(yaml).toContain('pool:');
    expect(yaml).toContain('steps:');
  });

  it('uses ubuntu-latest pool image', () => {
    expect(generateAzure(null, [])).toContain('ubuntu-latest');
  });

  it('specifies Node version 20.x via NodeTool', () => {
    expect(generateAzure(null, [])).toContain('20.x');
  });
});

// ─── generateGitLab ───────────────────────────────────────────────────────────

describe('generateGitLab', () => {
  it('contains API_SPECTOR_MASTER_KEY variable', () => {
    expect(generateGitLab(null, [])).toContain('API_SPECTOR_MASTER_KEY');
  });

  it('injects environment flag when envName is provided', () => {
    expect(generateGitLab('production', [])).toContain('--env "production"');
  });

  it('injects tags flag when tags are provided', () => {
    expect(generateGitLab(null, ['fast'])).toContain('--tags "fast"');
  });

  it('uses GitLab CI structure (stages / script / variables)', () => {
    const yaml = generateGitLab(null, []);
    expect(yaml).toContain('stages:');
    expect(yaml).toContain('script:');
    expect(yaml).toContain('variables:');
  });

  it('uses node:20 Docker image', () => {
    expect(generateGitLab(null, [])).toContain('node:20');
  });

  it('includes npm ci and npm run build steps', () => {
    const yaml = generateGitLab(null, []);
    expect(yaml).toContain('npm ci');
    expect(yaml).toContain('npm run build');
  });
});
