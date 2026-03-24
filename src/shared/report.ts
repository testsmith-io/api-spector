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

import type { RunRequestResult, RunSummary } from './types';

export interface ReportMeta {
  workspace?: string
  environment?: string | null
  collection?: string
  timestamp?: string
}

// ─── JSON report ─────────────────────────────────────────────────────────────

export function buildJsonReport(
  results: RunRequestResult[],
  summary: RunSummary,
  meta: ReportMeta = {},
): string {
  return JSON.stringify({
    timestamp:   meta.timestamp ?? new Date().toISOString(),
    workspace:   meta.workspace ?? null,
    environment: meta.environment ?? null,
    collection:  meta.collection ?? null,
    summary,
    results: results.map(r => ({
      name:            r.name,
      method:          r.method,
      url:             r.resolvedUrl,
      status:          r.status,
      httpStatus:      r.httpStatus ?? null,
      durationMs:      r.durationMs ?? null,
      iterationLabel:  r.iterationLabel ?? null,
      error:           r.error ?? null,
      preScriptError:  r.preScriptError ?? null,
      postScriptError: r.postScriptError ?? null,
      tests:           r.testResults ?? [],
      consoleOutput:   r.consoleOutput ?? [],
      request:         r.sentRequest ?? null,
      response:        r.receivedResponse ?? null,
    })),
  }, null, 2);
}

// ─── HTML report ─────────────────────────────────────────────────────────────

export function buildHtmlReport(
  results: RunRequestResult[],
  summary: RunSummary,
  meta: ReportMeta = {},
): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function prettyJson(s: string): string {
    try { return esc(JSON.stringify(JSON.parse(s), null, 2)); } catch { return esc(s); }
  }

  function headersTable(h: Record<string, string>): string {
    const rows = Object.entries(h).map(([k, v]) =>
      `<tr><td class="hk">${esc(k)}</td><td class="hv">${esc(v)}</td></tr>`
    ).join('');
    return rows ? `<table class="htable"><tbody>${rows}</tbody></table>` : '<span class="muted">none</span>';
  }

  const ts         = meta.timestamp ?? new Date().toISOString();
  const collection = meta.collection ?? 'API Tests';
  const env        = meta.environment ?? '—';
  const passRate   = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;

  const cards = results.map((r, idx) => {
    const statusCls = r.status === 'passed' ? 'badge-pass' : r.status === 'failed' ? 'badge-fail' : 'badge-err';
    const httpCls   = r.httpStatus && r.httpStatus < 300 ? 'http-ok' : r.httpStatus && r.httpStatus < 400 ? 'http-redir' : 'http-err';
    const dur       = r.durationMs != null ? `${r.durationMs} ms` : '—';
    const label     = r.iterationLabel ? ` <span class="muted">#${esc(r.iterationLabel)}</span>` : '';

    // Tests
    const testRows = (r.testResults ?? []).map(t =>
      `<div class="test-row ${t.passed ? 'test-pass' : 'test-fail'}">
        <span class="dot">${t.passed ? '✓' : '✗'}</span> ${esc(t.name)}
        ${!t.passed ? `<div class="test-err">${esc(t.error ?? '')}</div>` : ''}
      </div>`
    ).join('');

    // Errors
    const errRows = [
      r.error           ? `<div class="err-row">&#x26a0; ${esc(r.error)}</div>` : '',
      r.preScriptError  ? `<div class="err-row">&#x26a0; Pre-script: ${esc(r.preScriptError)}</div>` : '',
      r.postScriptError ? `<div class="err-row">&#x26a0; Post-script: ${esc(r.postScriptError)}</div>` : '',
    ].filter(Boolean).join('');

    // Console
    const consoleHtml = (r.consoleOutput ?? []).length
      ? `<div class="section-label">Console</div>
         <div class="code-block">${(r.consoleOutput ?? []).map(l => `<div>${esc(l)}</div>`).join('')}</div>`
      : '';

    // Request panel
    const reqHeaders = r.sentRequest?.headers ?? {};
    const reqBody    = r.sentRequest?.body;
    const reqHtml = `
      <div class="panel-label">Request</div>
      <div class="panel req-panel">
        <div class="req-line"><span class="method-badge">${esc(r.method)}</span> <span class="mono">${esc(r.resolvedUrl ?? '')}</span></div>
        <div class="section-label">Headers</div>
        ${headersTable(reqHeaders)}
        ${reqBody ? `<div class="section-label">Body</div><pre class="code-block">${prettyJson(reqBody)}</pre>` : ''}
      </div>`;

    // Response panel
    const resp    = r.receivedResponse;
    const respHtml = resp ? `
      <div class="panel-label">Response</div>
      <div class="panel resp-panel">
        <div class="resp-status ${httpCls}">${resp.status} ${esc(resp.statusText)}</div>
        <div class="section-label">Headers</div>
        ${headersTable(resp.headers)}
        ${resp.body ? `<div class="section-label">Body</div><pre class="code-block">${prettyJson(resp.body)}</pre>` : ''}
      </div>` : '';

    return `
    <div class="card" id="r${idx}">
      <div class="card-header" onclick="toggle(${idx})">
        <span class="chevron" id="ch${idx}">▶</span>
        <span class="badge ${statusCls}">${r.status}</span>
        <span class="method mono">${esc(r.method)}</span>
        <span class="card-name">${esc(r.name)}${label}</span>
        <span class="card-url muted">${esc(r.resolvedUrl ?? '')}</span>
        <span class="dur muted">${dur}</span>
        ${r.httpStatus ? `<span class="http-badge ${httpCls}">${r.httpStatus}</span>` : ''}
      </div>
      <div class="card-body" id="cb${idx}" style="display:none">
        ${errRows}
        ${testRows ? `<div class="section-label">Tests</div><div class="tests-wrap">${testRows}</div>` : ''}
        ${consoleHtml}
        <div class="req-resp-grid">
          ${reqHtml}
          ${respHtml}
        </div>
      </div>
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(collection)} — Test Results</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0f1117; color: #c9d1d9; font-size: 13px; line-height: 1.5; }
  .wrap { max-width: 1200px; margin: 0 auto; padding: 32px 24px; }
  h1 { font-size: 20px; font-weight: 600; color: #e6edf3; margin-bottom: 4px; }
  .meta-line { color: #8b949e; font-size: 11px; margin-bottom: 24px; }
  .summary { display: flex; gap: 12px; margin-bottom: 28px; flex-wrap: wrap; }
  .stat { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 20px; min-width: 90px; }
  .stat-val { font-size: 22px; font-weight: 700; color: #e6edf3; }
  .stat-lbl { font-size: 11px; color: #8b949e; margin-top: 2px; }
  .stat-pass .stat-val { color: #3fb950; }
  .stat-fail .stat-val { color: #f85149; }
  .stat-err  .stat-val { color: #d29922; }
  /* Cards */
  .card { border: 1px solid #21262d; border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
  .card-header { display: flex; align-items: baseline; gap: 8px; padding: 10px 14px; cursor: pointer; user-select: none; }
  .card-header:hover { background: #161b22; }
  .chevron { font-size: 10px; color: #8b949e; min-width: 10px; transition: transform .15s; }
  .card-name { font-weight: 500; color: #e6edf3; white-space: nowrap; }
  .card-url { font-family: monospace; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .card-body { padding: 12px 14px; border-top: 1px solid #21262d; display: flex; flex-direction: column; gap: 10px; }
  /* Badges */
  .badge { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap; }
  .badge-pass { background: #0d3a1e; color: #3fb950; }
  .badge-fail { background: #3d1014; color: #f85149; }
  .badge-err  { background: #3d2a00; color: #d29922; }
  .method { font-family: monospace; font-size: 11px; font-weight: 700; color: #79c0ff; white-space: nowrap; }
  .method-badge { display: inline-block; font-family: monospace; font-size: 11px; font-weight: 700; color: #79c0ff; min-width: 52px; }
  .http-badge { font-family: monospace; font-size: 11px; font-weight: 600; white-space: nowrap; }
  .http-ok    { color: #3fb950; }
  .http-redir { color: #79c0ff; }
  .http-err   { color: #f85149; }
  .dur { font-family: monospace; font-size: 11px; white-space: nowrap; }
  .muted { color: #8b949e; }
  .mono { font-family: monospace; font-size: 12px; }
  /* Request / Response */
  .req-resp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 700px) { .req-resp-grid { grid-template-columns: 1fr; } }
  .panel-label { font-size: 11px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
  .panel { background: #0d1117; border: 1px solid #21262d; border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  .req-line { font-family: monospace; font-size: 12px; color: #c9d1d9; word-break: break-all; }
  .resp-status { font-family: monospace; font-size: 13px; font-weight: 700; }
  .section-label { font-size: 10px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: .04em; margin-top: 2px; }
  .htable { width: 100%; border-collapse: collapse; }
  .htable td { font-family: monospace; font-size: 11px; padding: 1px 0; vertical-align: top; }
  .hk { color: #79c0ff; padding-right: 12px; white-space: nowrap; }
  .hv { color: #c9d1d9; word-break: break-all; }
  .code-block { font-family: monospace; font-size: 11px; color: #c9d1d9; background: #0d1117; border: 1px solid #21262d; border-radius: 4px; padding: 8px; white-space: pre-wrap; word-break: break-all; max-height: 300px; overflow-y: auto; }
  /* Tests */
  .section-label { font-size: 11px; font-weight: 600; color: #8b949e; }
  .tests-wrap { display: flex; flex-direction: column; gap: 2px; }
  .test-row { font-size: 12px; display: flex; flex-wrap: wrap; gap: 4px; }
  .test-pass { color: #3fb950; }
  .test-fail { color: #f85149; }
  .test-err { color: #8b949e; padding-left: 16px; width: 100%; font-family: monospace; font-size: 11px; }
  .dot { font-weight: 700; }
  /* Console */
  .err-row { color: #f85149; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(collection)}</h1>
  <div class="meta-line">Environment: ${esc(env)} &nbsp;·&nbsp; ${esc(ts)}</div>
  <div class="summary">
    <div class="stat"><div class="stat-val">${summary.total}</div><div class="stat-lbl">Total</div></div>
    <div class="stat stat-pass"><div class="stat-val">${summary.passed}</div><div class="stat-lbl">Passed</div></div>
    <div class="stat stat-fail"><div class="stat-val">${summary.failed}</div><div class="stat-lbl">Failed</div></div>
    <div class="stat stat-err"><div class="stat-val">${summary.errors}</div><div class="stat-lbl">Errors</div></div>
    <div class="stat"><div class="stat-val">${passRate}%</div><div class="stat-lbl">Pass rate</div></div>
    <div class="stat"><div class="stat-val">${summary.durationMs} ms</div><div class="stat-lbl">Duration</div></div>
  </div>
  <div class="cards">${cards}</div>
</div>
<script>
  function toggle(i) {
    const body = document.getElementById('cb' + i)
    const ch   = document.getElementById('ch' + i)
    const open = body.style.display !== 'none'
    body.style.display = open ? 'none' : 'block'
    ch.style.transform = open ? '' : 'rotate(90deg)'
  }
</script>
</body>
</html>
`;
}

// ─── JUnit XML report ─────────────────────────────────────────────────────────
// One <testcase> per request; failed test assertions become <failure> elements.
// Follows the Jenkins/GitHub Actions JUnit schema so results appear natively.

export function buildJUnitReport(
  results: RunRequestResult[],
  summary: RunSummary,
  meta: ReportMeta = {},
): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;')
     .replace(/</g, '&lt;')
     .replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;');

  const suiteName = esc(meta.collection ?? 'API Tests');
  const totalSec  = (summary.durationMs / 1000).toFixed(3);
  const ts        = meta.timestamp ?? new Date().toISOString();

  const cases = results.map(r => {
    const label     = r.iterationLabel ? ` #${r.iterationLabel}` : '';
    const name      = esc(r.name + label);
    const classname = esc(`${r.method} ${r.resolvedUrl}`);
    const timeSec   = ((r.durationMs ?? 0) / 1000).toFixed(3);

    const failures: string[] = [];

    if (r.status === 'error') {
      failures.push(`      <error message="${esc(r.error ?? 'Network error')}" type="NetworkError" />`);
    } else if (r.preScriptError) {
      failures.push(`      <error message="${esc(r.preScriptError)}" type="PreScriptError" />`);
    } else if (r.postScriptError) {
      failures.push(`      <error message="${esc(r.postScriptError)}" type="PostScriptError" />`);
    } else if (r.testResults?.length) {
      for (const t of r.testResults) {
        if (!t.passed) {
          failures.push(
            `      <failure message="${esc(t.name)}" type="AssertionError">${esc(t.error ?? 'Assertion failed')}</failure>`
          );
        }
      }
    }

    const inner = failures.length ? `\n${failures.join('\n')}\n    ` : '';
    return `    <testcase name="${name}" classname="${classname}" time="${timeSec}">${inner}</testcase>`;
  });

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${suiteName}" tests="${summary.total}" failures="${summary.failed}" errors="${summary.errors}" time="${totalSec}">`,
    `  <testsuite name="${suiteName}" tests="${summary.total}" failures="${summary.failed}" errors="${summary.errors}" time="${totalSec}" timestamp="${ts}">`,
    ...cases,
    '  </testsuite>',
    '</testsuites>',
  ];

  return lines.join('\n') + '\n';
}
