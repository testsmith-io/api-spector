// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toJUnitXml } from '../main/contract/report-formats';
import { reportToHtml, dashboardToHtml } from '../main/contract/html-report';
import { recordResult, canIDeploy, listResults } from '../main/contract/results-store';
import type { ContractReport } from '../shared/types';

function makeReport(failed: number): ContractReport {
  return {
    mode: 'provider-live',
    total: failed + 1,
    passed: 1,
    failed,
    durationMs: 1234,
    results: [
      { requestId: 'a', requestName: 'ok', method: 'GET', url: 'http://x/ok', passed: true, violations: [], durationMs: 10 },
      ...(failed
        ? [{ requestId: 'b', requestName: 'bad', method: 'POST', url: 'http://x/bad', passed: false, durationMs: 20,
            violations: [{ type: 'status_mismatch' as const, message: 'Expected 200, got 500' }] }]
        : []),
    ],
  };
}

describe('toJUnitXml', () => {
  it('renders testcases with failures and escapes XML', () => {
    const xml = toJUnitXml(makeReport(1));
    expect(xml).toContain('<testsuites');
    expect(xml).toContain('tests="2"');
    expect(xml).toContain('failures="1"');
    expect(xml).toContain('<testcase name="GET ok"');
    expect(xml).toContain('<failure message="status_mismatch: Expected 200, got 500"');
  });

  it('escapes special characters', () => {
    const report = makeReport(0);
    report.results[0].requestName = 'a & b <c>';
    expect(toJUnitXml(report)).toContain('a &amp; b &lt;c&gt;');
  });
});

describe('reportToHtml', () => {
  it('produces a self-contained HTML page with summary and interactions', () => {
    const html = reportToHtml(makeReport(1), { provider: 'http://localhost:3000', spec: 'snapshot v1' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<style>');              // inline CSS, no external assets
    expect(html).not.toContain('http://localhost/'); // no external resource fetches
    expect(html).toContain('✗ 1 failed');
    expect(html).toContain('GET');
    expect(html).toContain('Expected 200, got 500');
    expect(html).toContain('Provider (live)');
  });

  it('escapes user content', () => {
    const report = makeReport(0);
    report.results[0].requestName = '<script>alert(1)</script>';
    const html = reportToHtml(report);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('dashboardToHtml', () => {
  it('renders a pacticipant × version matrix', () => {
    const records = [
      { pacticipant: 'web', version: '1.0.0', recordedAt: 'x', passed: true, report: makeReport(0) },
      { pacticipant: 'web', version: '2.0.0', recordedAt: 'y', passed: false, report: makeReport(1) },
    ];
    const html = dashboardToHtml(records);
    expect(html).toContain('Contract Dashboard');
    expect(html).toContain('1.0.0');
    expect(html).toContain('2.0.0');
    expect(html).toContain('web');
  });

  it('handles an empty result set gracefully', () => {
    expect(dashboardToHtml([])).toContain('No recorded results yet');
  });
});

describe('listResults', () => {
  it('round-trips recorded results from disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spector-list-'));
    try {
      await recordResult(dir, 'web', '1.0.0', makeReport(0), '2026-06-26T00:00:00Z');
      await recordResult(dir, 'mobile', '3.1.0', makeReport(1), '2026-06-26T00:00:00Z');
      const all = await listResults(dir);
      expect(all).toHaveLength(2);
      expect(all.map(r => r.pacticipant).sort()).toEqual(['mobile', 'web']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns empty when no results dir exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spector-empty-'));
    try {
      expect(await listResults(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('can-i-deploy results store', () => {
  it('records a result and reports deployable on pass', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spector-cid-'));
    try {
      await recordResult(dir, 'web', '1.0.0', makeReport(0), '2026-06-26T00:00:00Z');
      const verdict = await canIDeploy(dir, 'web', '1.0.0');
      expect(verdict.deployable).toBe(true);
      expect(verdict.reason).toContain('passed');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports NOT deployable on a failing record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spector-cid-'));
    try {
      await recordResult(dir, 'web', '2.0.0', makeReport(1), '2026-06-26T00:00:00Z');
      const verdict = await canIDeploy(dir, 'web', '2.0.0');
      expect(verdict.deployable).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fails closed for an unknown version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spector-cid-'));
    try {
      const verdict = await canIDeploy(dir, 'web', '9.9.9');
      expect(verdict.deployable).toBe(false);
      expect(verdict.reason).toContain('No verification result');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ─── Environment / deployment tracking ────────────────────────────────────────

import { mkdtemp } from 'node:fs/promises';
import { tmpdir as osTmpdir } from 'node:os';
import { join as pjoin } from 'node:path';
import { recordDeployment, listEnvironments, canIDeploy as canIDeployEnv } from '../main/contract/results-store';

describe('deployment tracking', () => {
  it('records, replaces, and lists deployments per environment', async () => {
    const dir = await mkdtemp(pjoin(osTmpdir(), 'spector-env-'));
    const r1 = await recordDeployment(dir, 'prod', 'web-app', '1.0.0', '2026-07-01T10:00:00Z');
    expect(r1.previous).toBeUndefined();

    const r2 = await recordDeployment(dir, 'prod', 'web-app', '1.1.0', '2026-07-02T10:00:00Z');
    expect(r2.previous?.version).toBe('1.0.0');

    await recordDeployment(dir, 'staging', 'mobile-app', '2.0.0', '2026-07-03T10:00:00Z');

    const envs = await listEnvironments(dir);
    expect(envs.map(e => e.name)).toEqual(['prod', 'staging']);
    expect(envs[0].deployed['web-app'].version).toBe('1.1.0');
    expect(envs[1].deployed['mobile-app'].version).toBe('2.0.0');
  });

  it('can-i-deploy reports the currently deployed version for the target env', async () => {
    const dir = await mkdtemp(pjoin(osTmpdir(), 'spector-env-'));
    await recordDeployment(dir, 'prod', 'web-app', '1.0.0', '2026-07-01T10:00:00Z');
    const verdict = await canIDeployEnv(dir, 'web-app', '1.1.0', 'prod');
    expect(verdict.deployable).toBe(false); // no recorded verification: fail closed
    expect(verdict.currentlyDeployed?.version).toBe('1.0.0');
  });
});
