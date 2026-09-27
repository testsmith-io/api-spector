// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { RunRequestResult, RunSummary } from './types';
import { escapeHtml } from './escape';

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
      // Tree position: which collection and folder path this request sits under.
      collection:      r.collection ?? meta.collection ?? null,
      folderPath:      r.scopePath ?? [],
      isHook:          r.isHook ?? false,
      hookType:        r.hookType ?? null,
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
  const esc = escapeHtml;

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
  // Pass rate counts skipped requests against the denominator. A green
  // "100%" next to "1 no tests" is misleading — an unverified request is
  // a gap in your coverage, and the pass rate should make that visible.
  const passRate   = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;

  const HOOK_LABELS: Record<string, string> = {
    beforeAll: 'BEFORE ALL',
    before:    'BEFORE',
    after:     'AFTER',
    afterAll:  'AFTER ALL',
  };

    // Emit nested collection / folder headings that mirror the tree in the UI:
    // a collection heading (level 0) when the collection changes, then a folder
    // heading for each new level of scopePath, indented by depth. The request
    // card itself is indented under its deepest folder.
  let lastCollection: string | null = null;
  let lastPath: string[] = [];
  const cards = results.map((r, idx) => {
    let groupHeading = '';
    const coll = r.collection ?? meta.collection ?? '';
    if (coll && coll !== lastCollection) {
      groupHeading += `    <div class="scope-heading lvl-0">${esc(coll)}</div>\n`;
      lastCollection = coll;
      lastPath = [];
    }
    const path = r.scopePath ?? [];
    let diverge = 0;
    while (diverge < path.length && diverge < lastPath.length && path[diverge] === lastPath[diverge]) diverge++;
    for (let d = diverge; d < path.length; d++) {
      groupHeading += `    <div class="scope-heading lvl-${Math.min(d + 1, 6)}">${esc(path[d])}</div>\n`;
    }
    lastPath = path;
    const cardIndent = `lvl-${Math.min(path.length + 1, 6)}`;
    const statusCls = r.status === 'passed'  ? 'badge-pass'
                    : r.status === 'failed'  ? 'badge-fail'
                    : r.status === 'skipped' ? 'badge-skip'
                    : 'badge-err';
    const httpCls   = r.httpStatus && r.httpStatus < 300 ? 'http-ok' : r.httpStatus && r.httpStatus < 400 ? 'http-redir' : 'http-err';
    const dur       = r.durationMs != null ? `${r.durationMs} ms` : '—';
    const label     = r.iterationLabel ? ` <span class="muted">#${esc(r.iterationLabel)}</span>` : '';
    const hookLabel = r.isHook && r.hookType ? HOOK_LABELS[r.hookType] ?? r.hookType.toUpperCase() : null;

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

    const hookCls  = hookLabel ? (r.hookType?.startsWith('before') ? 'card-hook-before' : 'card-hook-after') : '';

    return `${groupHeading}
    <div class="card ${hookCls} ${cardIndent}" id="r${idx}">
      <div class="card-header" onclick="toggle(${idx})">
        <span class="chevron" id="ch${idx}">▶</span>
        <span class="badge ${statusCls}">${r.status}</span>
        ${hookLabel ? `<span class="hook-badge ${r.hookType?.startsWith('before') ? 'hook-before' : 'hook-after'}">${hookLabel}</span>` : `<span class="method mono">${esc(r.method)}</span>`}
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
  /* ─── CSS custom properties for theming ──────────────────────────────── */
  :root {
    --bg:         #0f1117; --bg-surface:  #161b22; --bg-panel:    #0d1117;
    --border:     #21262d; --border-hover:#30363d;
    --text:       #c9d1d9; --text-bright: #e6edf3; --text-muted:  #8b949e; --text-dim: #484f58;
    --green:      #3fb950; --red:         #f85149; --amber:       #d29922; --blue: #79c0ff;
    --badge-pass-bg: #0d3a1e; --badge-fail-bg: #3d1014; --badge-err-bg: #3d2a00; --badge-skip-bg: #21262d;
    --hook-before-border: #7c3aed; --hook-after-border: #0e7490;
    --hook-before-bg: #4c1d95; --hook-before-fg: #c4b5fd;
    --hook-after-bg:  #164e63; --hook-after-fg:  #67e8f9;
    --link: #3d7fb2;
  }
  html.light {
    --bg:         #ffffff; --bg-surface:  #f6f8fa; --bg-panel:    #ffffff;
    --border:     #d0d7de; --border-hover:#c4c9cf;
    --text:       #1f2328; --text-bright: #1f2328; --text-muted:  #656d76; --text-dim: #8b949e;
    --green:      #1a7f37; --red:         #cf222e; --amber:       #9a6700; --blue: #0969da;
    --badge-pass-bg: #dafbe1; --badge-fail-bg: #ffebe9; --badge-err-bg: #fff8c5; --badge-skip-bg: #f6f8fa;
    --hook-before-border: #8b5cf6; --hook-after-border: #06b6d4;
    --hook-before-bg: #ede9fe; --hook-before-fg: #6d28d9;
    --hook-after-bg:  #ecfeff; --hook-after-fg:  #0e7490;
    --link: #0969da;
  }
  /* ─── Base ───────────────────────────────────────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); font-size: 13px; line-height: 1.5; }
  .wrap { max-width: 1200px; margin: 0 auto; padding: 32px 24px; }
  h1 { font-size: 20px; font-weight: 600; color: var(--text-bright); margin-bottom: 4px; }
  .meta-line { color: var(--text-muted); font-size: 11px; margin-bottom: 24px; }
  /* Theme toggle */
  .theme-toggle { position: fixed; top: 16px; right: 16px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; font-size: 16px; cursor: pointer; z-index: 100; line-height: 1; }
  .theme-toggle:hover { border-color: var(--blue); }
  /* Summary */
  .summary { display: flex; gap: 12px; margin-bottom: 28px; flex-wrap: wrap; }
  .stat { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px 20px; min-width: 90px; }
  .stat-val { font-size: 22px; font-weight: 700; color: var(--text-bright); }
  .stat-lbl { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
  .stat-pass .stat-val { color: var(--green); }
  .stat-fail .stat-val { color: var(--red); }
  .stat-err  .stat-val { color: var(--amber); }
  .stat-skip .stat-val { color: var(--text-muted); }
  /* Cards */
  .card { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
  .scope-heading { margin: 14px 0 6px; padding: 4px 2px; font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); }
  .scope-heading::before { content: "\\25B8 "; color: var(--text-dim); }
  /* Nested tree indentation: collection (lvl-0) → folders (lvl-1..) → request card. */
  .lvl-0 { margin-left: 0; }
  .lvl-1 { margin-left: 16px; }
  .lvl-2 { margin-left: 32px; }
  .lvl-3 { margin-left: 48px; }
  .lvl-4 { margin-left: 64px; }
  .lvl-5 { margin-left: 80px; }
  .lvl-6 { margin-left: 96px; }
  .scope-heading.lvl-0 { font-size: 13px; color: var(--text); text-transform: none; letter-spacing: 0; margin-top: 22px; }
  .scope-heading.lvl-0::before { content: "\\1F5C0 "; }
  .card-header { display: flex; align-items: baseline; gap: 8px; padding: 10px 14px; cursor: pointer; user-select: none; }
  .card-header:hover { background: var(--bg-surface); }
  .chevron { font-size: 10px; color: var(--text-muted); min-width: 10px; transition: transform .15s; }
  .card-name { font-weight: 500; color: var(--text-bright); white-space: nowrap; }
  .card-url { font-family: monospace; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .card-body { padding: 12px 14px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px; }
  /* Badges */
  .badge { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap; }
  .badge-pass { background: var(--badge-pass-bg); color: var(--green); }
  .badge-fail { background: var(--badge-fail-bg); color: var(--red); }
  .badge-err  { background: var(--badge-err-bg);  color: var(--amber); }
  .badge-skip { background: var(--badge-skip-bg); color: var(--text-muted); }
  .method { font-family: monospace; font-size: 11px; font-weight: 700; color: var(--blue); white-space: nowrap; }
  .method-badge { display: inline-block; font-family: monospace; font-size: 11px; font-weight: 700; color: var(--blue); min-width: 52px; }
  .http-badge { font-family: monospace; font-size: 11px; font-weight: 600; white-space: nowrap; }
  .http-ok    { color: var(--green); }
  .http-redir { color: var(--blue); }
  .http-err   { color: var(--red); }
  .dur { font-family: monospace; font-size: 11px; white-space: nowrap; }
  .muted { color: var(--text-muted); }
  .mono { font-family: monospace; font-size: 12px; }
  /* Request / Response */
  .req-resp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 700px) { .req-resp-grid { grid-template-columns: 1fr; } }
  .panel-label { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
  .panel { background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  .req-line { font-family: monospace; font-size: 12px; color: var(--text); word-break: break-all; }
  .resp-status { font-family: monospace; font-size: 13px; font-weight: 700; }
  .section-label { font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; margin-top: 2px; }
  .htable { width: 100%; border-collapse: collapse; }
  .htable td { font-family: monospace; font-size: 11px; padding: 1px 0; vertical-align: top; }
  .hk { color: var(--blue); padding-right: 12px; white-space: nowrap; }
  .hv { color: var(--text); word-break: break-all; }
  .code-block { font-family: monospace; font-size: 11px; color: var(--text); background: var(--bg-panel); border: 1px solid var(--border); border-radius: 4px; padding: 8px; white-space: pre-wrap; word-break: break-all; max-height: 300px; overflow-y: auto; }
  /* Tests */
  .section-label { font-size: 11px; font-weight: 600; color: var(--text-muted); }
  .tests-wrap { display: flex; flex-direction: column; gap: 2px; }
  .test-row { font-size: 12px; display: flex; flex-wrap: wrap; gap: 4px; }
  .test-pass { color: var(--green); }
  .test-fail { color: var(--red); }
  .test-err { color: var(--text-muted); padding-left: 16px; width: 100%; font-family: monospace; font-size: 11px; }
  .dot { font-weight: 700; }
  /* Console */
  .err-row { color: var(--red); font-size: 12px; }
  /* Footer */
  .report-footer { margin-top: 32px; text-align: center; font-size: 11px; color: var(--text-dim); }
  .footer-link { color: var(--link); text-decoration: none; }
  .footer-link:hover { text-decoration: underline; }
  /* Hook cards */
  .card-hook-before { border-left: 3px solid var(--hook-before-border); }
  .card-hook-after  { border-left: 3px solid var(--hook-after-border); }
  .hook-badge { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 10px; font-weight: 700; white-space: nowrap; letter-spacing: .04em; }
  .hook-before { background: var(--hook-before-bg); color: var(--hook-before-fg); }
  .hook-after  { background: var(--hook-after-bg);  color: var(--hook-after-fg); }
</style>
</head>
<body>
<button class="theme-toggle" onclick="toggleTheme()" title="Toggle dark/light mode" id="themeBtn">☀️</button>
<div class="wrap">
  <h1>${esc(collection)}</h1>
  <div class="meta-line">Environment: ${esc(env)} &nbsp;·&nbsp; ${esc(ts)}</div>
  <div class="summary">
    <div class="stat"><div class="stat-val">${summary.total}</div><div class="stat-lbl">Total</div></div>
    <div class="stat stat-pass"><div class="stat-val">${summary.passed}</div><div class="stat-lbl">Passed</div></div>
    <div class="stat stat-fail"><div class="stat-val">${summary.failed}</div><div class="stat-lbl">Failed</div></div>
    <div class="stat stat-err"><div class="stat-val">${summary.errors}</div><div class="stat-lbl">Errors</div></div>
    <div class="stat stat-skip"><div class="stat-val">${summary.skipped ?? 0}</div><div class="stat-lbl">No tests</div></div>
    <div class="stat"><div class="stat-val">${passRate}%</div><div class="stat-lbl">Pass rate</div></div>
    <div class="stat"><div class="stat-val">${summary.durationMs} ms</div><div class="stat-lbl">Duration</div></div>
  </div>
  <div class="cards">${cards}</div>
  <div class="report-footer">Generated by <a href="https://testsmith.io" target="_blank" rel="noopener" class="footer-link">Testsmith</a> · API Spector</div>
</div>
<script>
  function toggle(i) {
    const body = document.getElementById('cb' + i)
    const ch   = document.getElementById('ch' + i)
    const open = body.style.display !== 'none'
    body.style.display = open ? 'none' : 'block'
    ch.style.transform = open ? '' : 'rotate(90deg)'
  }
  function toggleTheme() {
    const html = document.documentElement
    const isLight = html.classList.toggle('light')
    document.getElementById('themeBtn').textContent = isLight ? '🌙' : '☀️'
    try { localStorage.setItem('theme', isLight ? 'light' : 'dark') } catch {} /* private mode / quota — non-fatal */
  }
  // Restore saved preference or respect OS preference
  (function() {
    try {
      const saved = localStorage.getItem('theme')
      if (saved === 'light' || (!saved && window.matchMedia('(prefers-color-scheme: light)').matches)) {
        document.documentElement.classList.add('light')
        document.getElementById('themeBtn').textContent = '🌙'
      }
    } catch {} /* private mode / quota — non-fatal */
  })()
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
  const esc = escapeHtml;

  const suiteName = esc(meta.collection ?? 'API Tests');
  const totalSec  = (summary.durationMs / 1000).toFixed(3);
  const ts        = meta.timestamp ?? new Date().toISOString();

  const HOOK_JUNIT_LABELS: Record<string, string> = {
    beforeAll: 'Hook: Before All',
    before:    'Hook: Before',
    after:     'Hook: After',
    afterAll:  'Hook: After All',
  };

  const cases = results.map(r => {
    const label     = r.iterationLabel ? ` #${r.iterationLabel}` : '';
    const hookPrefix = r.isHook && r.hookType ? `[${HOOK_JUNIT_LABELS[r.hookType] ?? 'Hook'}] ` : '';
    const name      = esc(hookPrefix + r.name + label);
    // classname carries the tree position (collection.folder.subfolder) so CI
    // dashboards nest results the same way the app does. Dots in names are
    // replaced so they don't read as extra nesting levels.
    const classname = esc([r.collection ?? meta.collection, ...(r.scopePath ?? [])]
      .filter(Boolean).map(s => String(s).replace(/\./g, '_')).join('.') || 'API Tests');
    const timeSec   = ((r.durationMs ?? 0) / 1000).toFixed(3);

    const failures: string[] = [];

    if (r.status === 'error') {
      failures.push(`      <error message="${esc(r.error ?? 'Network error')}" type="NetworkError" />`);
    } else if (r.preScriptError) {
      failures.push(`      <error message="${esc(r.preScriptError)}" type="PreScriptError" />`);
    } else if (r.postScriptError) {
      failures.push(`      <error message="${esc(r.postScriptError)}" type="PostScriptError" />`);
    } else if (r.status === 'skipped') {
      // No assertions defined — emit a JUnit <skipped/> so CI dashboards
      // surface coverage gaps without flagging the run as failed.
      failures.push('      <skipped message="No assertions defined for this request" />');
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

  const skipped = summary.skipped ?? 0;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${suiteName}" tests="${summary.total}" failures="${summary.failed}" errors="${summary.errors}" skipped="${skipped}" time="${totalSec}">`,
    `  <testsuite name="${suiteName}" tests="${summary.total}" failures="${summary.failed}" errors="${summary.errors}" skipped="${skipped}" time="${totalSec}" timestamp="${ts}">`,
    ...cases,
    '  </testsuite>',
    '</testsuites>',
  ];

  return lines.join('\n') + '\n';
}

// ─── OWASP API Top 10 (2023) classification + SARIF ───────────────────────────

export interface OwaspRule { id: string; name: string; ref: string }

/** Test-name prefix (e.g. "[BOLA]") → OWASP API Top 10 rule. Zero-config and
 *  optional: names without a known prefix simply carry no OWASP tag. This is
 *  the same tagging convention used by the security-testing guide/skill. */
const OWASP_BY_TAG: Record<string, OwaspRule> = {
  BOLA:          { id: 'API1:2023',  name: 'Broken Object Level Authorization',                 ref: 'https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/' },
  AUTH:          { id: 'API2:2023',  name: 'Broken Authentication',                             ref: 'https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/' },
  'MASS-ASSIGN': { id: 'API3:2023',  name: 'Broken Object Property Level Authorization',        ref: 'https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/' },
  RESOURCE:      { id: 'API4:2023',  name: 'Unrestricted Resource Consumption',                 ref: 'https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/' },
  'FUNC-AUTH':   { id: 'API5:2023',  name: 'Broken Function Level Authorization',               ref: 'https://owasp.org/API-Security/editions/2023/en/0xa5-broken-function-level-authorization/' },
  'BIZ-FLOW':    { id: 'API6:2023',  name: 'Unrestricted Access to Sensitive Business Flows',   ref: 'https://owasp.org/API-Security/editions/2023/en/0xa6-unrestricted-access-to-sensitive-business-flows/' },
  SSRF:          { id: 'API7:2023',  name: 'Server Side Request Forgery',                       ref: 'https://owasp.org/API-Security/editions/2023/en/0xa7-server-side-request-forgery/' },
  CONFIG:        { id: 'API8:2023',  name: 'Security Misconfiguration',                         ref: 'https://owasp.org/API-Security/editions/2023/en/0xa8-security-misconfiguration/' },
  INVENTORY:     { id: 'API9:2023',  name: 'Improper Inventory Management',                     ref: 'https://owasp.org/API-Security/editions/2023/en/0xa9-improper-inventory-management/' },
  INJECTION:     { id: 'API10:2023', name: 'Unsafe Consumption of APIs',                        ref: 'https://owasp.org/API-Security/editions/2023/en/0xaa-unsafe-consumption-of-apis/' },
};

/** Resolve the OWASP rule from a `[TAG] …` name prefix, or null if untagged. */
export function owaspRuleForName(name: string): OwaspRule | null {
  const m = /^\s*\[([A-Za-z-]+)\]/.exec(name ?? '');
  return m ? OWASP_BY_TAG[m[1].toUpperCase()] ?? null : null;
}

/** SARIF 2.1.0 report of failing checks, tagged with OWASP rules where the test
 *  name carries a known prefix. Lets security findings flow into GitHub
 *  code-scanning / the Security tab. Opt-in: only produced when SARIF is chosen. */
export function buildSarifReport(
  results: RunRequestResult[],
  _summary: RunSummary,
  meta: ReportMeta = {},
): string {
  const rules = new Map<string, { id: string; name: string; helpUri?: string }>();
  const addRule = (id: string, name: string, helpUri?: string) => {
    if (!rules.has(id)) rules.set(id, { id, name, ...(helpUri ? { helpUri } : {}) });
  };

  const sarifResults: unknown[] = [];
  const emit = (rule: OwaspRule | null, fallbackId: string, fallbackName: string, r: RunRequestResult, message: string) => {
    const id   = rule ? rule.id : fallbackId;
    const name = rule ? rule.name : fallbackName;
    addRule(id, name, rule?.ref);
    sarifResults.push({
      ruleId: id,
      level:  'error',
      message: { text: `${r.method} ${r.resolvedUrl}${r.iterationLabel ? ` #${r.iterationLabel}` : ''} — ${message}` },
      locations: [{ physicalLocation: { artifactLocation: { uri: r.resolvedUrl || r.name } } }],
    });
  };

  for (const r of results) {
    if (r.status === 'error' && r.error) emit(owaspRuleForName(r.name), 'request-error', 'Request error', r, r.error);
    if (r.preScriptError)  emit(null, 'pre-script-error',  'Pre-request script error',  r, r.preScriptError);
    if (r.postScriptError) emit(null, 'post-script-error', 'Post-request script error', r, r.postScriptError);
    for (const t of r.testResults ?? []) {
      if (t.passed) continue;
      const rule = owaspRuleForName(t.name) ?? owaspRuleForName(r.name);
      emit(rule, 'assertion-failed', 'Assertion failed', r, `${t.name}${t.error ? `: ${t.error}` : ''}`);
    }
  }

  return JSON.stringify({
    version: '2.1.0',
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    runs: [{
      tool: {
        driver: {
          name: 'API Spector',
          informationUri: 'https://github.com/testsmith-io/api-spector',
          rules: [...rules.values()].map(r => ({
            id: r.id,
            name: r.name,
            shortDescription: { text: r.name },
            ...(r.helpUri ? { helpUri: r.helpUri } : {}),
          })),
        },
      },
      ...(meta.timestamp ? { invocations: [{ executionSuccessful: sarifResults.length === 0, endTimeUtc: meta.timestamp }] } : {}),
      results: sarifResults,
    }],
  }, null, 2);
}
