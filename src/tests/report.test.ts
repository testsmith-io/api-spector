import { describe, it, expect } from 'vitest';
import { buildJsonReport, buildJUnitReport } from '../shared/report';
import type { RunRequestResult, RunSummary } from '../shared/types';

function makeResult(overrides: Partial<RunRequestResult> = {}): RunRequestResult {
  return {
    requestId:   'req-1',
    name:        'Get users',
    method:      'GET',
    resolvedUrl: 'https://api.example.com/users',
    status:      'passed',
    httpStatus:  200,
    durationMs:  42,
    testResults: [],
    ...overrides,
  };
}

const summary: RunSummary = {
  total: 1,
  passed: 1,
  failed: 0,
  errors: 0,
  durationMs: 42,
};

const meta = {
  workspace:   './project.spector',
  environment: 'staging',
  collection:  'User API',
  timestamp:   '2025-01-01T00:00:00.000Z',
};

// ─── buildJsonReport ─────────────────────────────────────────────────────────

describe('buildJsonReport', () => {
  it('returns valid JSON', () => {
    expect(() => JSON.parse(buildJsonReport([], summary, meta))).not.toThrow();
  });

  it('includes meta fields', () => {
    const report = JSON.parse(buildJsonReport([], summary, meta));
    expect(report.workspace).toBe('./project.spector');
    expect(report.environment).toBe('staging');
    expect(report.timestamp).toBe('2025-01-01T00:00:00.000Z');
  });

  it('includes summary', () => {
    const report = JSON.parse(buildJsonReport([], summary, meta));
    expect(report.summary.total).toBe(1);
    expect(report.summary.passed).toBe(1);
  });

  it('maps a result to the expected shape', () => {
    const report = JSON.parse(buildJsonReport([makeResult()], summary, meta));
    const r = report.results[0];
    expect(r.name).toBe('Get users');
    expect(r.method).toBe('GET');
    expect(r.url).toBe('https://api.example.com/users');
    expect(r.status).toBe('passed');
    expect(r.httpStatus).toBe(200);
  });

  it('uses null for optional missing fields', () => {
    const report = JSON.parse(buildJsonReport([makeResult()], summary, meta));
    expect(report.results[0].error).toBeNull();
    expect(report.results[0].iterationLabel).toBeNull();
  });
});

// ─── buildJUnitReport ────────────────────────────────────────────────────────

describe('buildJUnitReport', () => {
  it('returns a string starting with XML declaration', () => {
    const xml = buildJUnitReport([], summary, meta);
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
  });

  it('includes testsuites element with counts', () => {
    const xml = buildJUnitReport([makeResult()], summary, meta);
    expect(xml).toContain('tests="1"');
    expect(xml).toContain('failures="0"');
  });

  it('creates a testcase element per result', () => {
    const xml = buildJUnitReport([makeResult()], summary, meta);
    expect(xml).toContain('<testcase');
    expect(xml).toContain('Get users');
  });

  it('adds a failure element for a failed test', () => {
    const result = makeResult({
      status: 'failed',
      testResults: [{ name: 'status is 200', passed: false, error: 'Expected 200 to equal 404' }],
    });
    const xml = buildJUnitReport([result], { ...summary, passed: 0, failed: 1 }, meta);
    expect(xml).toContain('<failure');
    expect(xml).toContain('status is 200');
  });

  it('adds an error element for a network error', () => {
    const result = makeResult({ status: 'error', error: 'ECONNREFUSED' });
    const xml = buildJUnitReport([result], { ...summary, errors: 1, passed: 0 }, meta);
    expect(xml).toContain('<error');
    expect(xml).toContain('ECONNREFUSED');
  });

  it('escapes special characters in names', () => {
    const result = makeResult({ name: 'Test <special> & "chars"' });
    const xml = buildJUnitReport([result], summary, meta);
    expect(xml).toContain('&lt;special&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;');
  });
});
