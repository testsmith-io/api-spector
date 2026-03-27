// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

import { describe, it, expect } from 'vitest';
import { buildJsonReport, buildJUnitReport, buildHtmlReport } from '../shared/report';
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

// ─── buildHtmlReport ─────────────────────────────────────────────────────────

describe('buildHtmlReport', () => {
  it('returns a valid HTML document', () => {
    const html = buildHtmlReport([], summary, meta);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes the collection name in the title and heading', () => {
    const html = buildHtmlReport([], summary, meta);
    expect(html).toContain('<title>User API');
    expect(html).toContain('<h1>User API</h1>');
  });

  it('shows the environment name', () => {
    expect(buildHtmlReport([], summary, meta)).toContain('staging');
  });

  it('shows all summary stat values', () => {
    const html = buildHtmlReport([], summary, meta);
    expect(html).toContain(`>${summary.total}<`);
    expect(html).toContain(`>${summary.passed}<`);
    expect(html).toContain(`>${summary.durationMs} ms<`);
  });

  it('calculates and shows pass rate percentage', () => {
    const s = { total: 4, passed: 3, failed: 1, errors: 0, durationMs: 100 };
    expect(buildHtmlReport([], s, meta)).toContain('>75%<');
  });

  it('shows 0% pass rate when total is 0', () => {
    const s = { total: 0, passed: 0, failed: 0, errors: 0, durationMs: 0 };
    expect(buildHtmlReport([], s, meta)).toContain('>0%<');
  });

  it('renders a card for each result', () => {
    const results = [makeResult(), makeResult({ name: 'Post order', method: 'POST' })];
    const html = buildHtmlReport(results, { ...summary, total: 2, passed: 2 }, meta);
    expect(html).toContain('Get users');
    expect(html).toContain('Post order');
  });

  it('marks a passed result with badge-pass class', () => {
    const html = buildHtmlReport([makeResult({ status: 'passed' })], summary, meta);
    expect(html).toContain('badge-pass');
  });

  it('marks a failed result with badge-fail class', () => {
    const html = buildHtmlReport([makeResult({ status: 'failed' })], { ...summary, passed: 0, failed: 1 }, meta);
    expect(html).toContain('badge-fail');
  });

  it('marks an error result with badge-err class', () => {
    const html = buildHtmlReport([makeResult({ status: 'error' })], { ...summary, passed: 0, errors: 1 }, meta);
    expect(html).toContain('badge-err');
  });

  it('renders test results with pass/fail indicators', () => {
    const result = makeResult({
      testResults: [
        { name: 'status is 200', passed: true },
        { name: 'body has id',   passed: false, error: 'Expected id to exist' },
      ],
    });
    const html = buildHtmlReport([result], summary, meta);
    expect(html).toContain('status is 200');
    expect(html).toContain('body has id');
    expect(html).toContain('Expected id to exist');
  });

  it('renders the resolved URL in the card', () => {
    const html = buildHtmlReport([makeResult()], summary, meta);
    expect(html).toContain('https://api.example.com/users');
  });

  it('renders the duration', () => {
    const html = buildHtmlReport([makeResult({ durationMs: 123 })], summary, meta);
    expect(html).toContain('123 ms');
  });

  it('renders the iteration label when present', () => {
    const html = buildHtmlReport([makeResult({ iterationLabel: '2/5' })], summary, meta);
    expect(html).toContain('2/5');
  });

  it('escapes HTML special characters in result names', () => {
    const html = buildHtmlReport([makeResult({ name: '<script>alert(1)</script>' })], summary, meta);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('escapes HTML special characters in error messages', () => {
    const html = buildHtmlReport([makeResult({ error: 'failed & <reason>' })], summary, meta);
    expect(html).toContain('failed &amp; &lt;reason&gt;');
  });

  it('renders request headers when sentRequest is present', () => {
    const result = makeResult({
      sentRequest: { headers: { 'authorization': 'Bearer tok', 'content-type': 'application/json' } },
    });
    const html = buildHtmlReport([result], summary, meta);
    expect(html).toContain('authorization');
    expect(html).toContain('Bearer tok');
  });

  it('renders response body when receivedResponse is present', () => {
    const result = makeResult({
      receivedResponse: {
        status: 200, statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{"hello":"world"}',
      },
    });
    const html = buildHtmlReport([result], summary, meta);
    // body is HTML-escaped, so " becomes &quot;
    expect(html).toContain('&quot;hello&quot;');
    expect(html).toContain('&quot;world&quot;');
  });

  it('includes the toggle script for collapsible cards', () => {
    const html = buildHtmlReport([], summary, meta);
    expect(html).toContain('function toggle(');
  });
});
