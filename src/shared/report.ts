// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

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

  let lastScopeKey: string | null = null;
  const cards = results.map((r, idx) => {
    // Folder-group heading: insert whenever the request's folder path changes
    // from the previous row. Produces the same "folder structure" shown in
    // the runner modal and the collection tree.
    const scopeKey = (r.scopePath ?? []).join(' / ');
    const groupHeading = (scopeKey && scopeKey !== lastScopeKey)
      ? `    <div class="scope-heading">${esc(scopeKey)}</div>\n`
      : '';
    lastScopeKey = scopeKey;
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
    <div class="card ${hookCls}" id="r${idx}">
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
  .scope-heading { margin: 18px 0 6px; padding: 4px 2px; font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); }
  .scope-heading::before { content: "\\25B8 "; color: var(--text-dim); }
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
    try { localStorage.setItem('theme', isLight ? 'light' : 'dark') } catch {}
  }
  // Restore saved preference or respect OS preference
  (function() {
    try {
      const saved = localStorage.getItem('theme')
      if (saved === 'light' || (!saved && window.matchMedia('(prefers-color-scheme: light)').matches)) {
        document.documentElement.classList.add('light')
        document.getElementById('themeBtn').textContent = '🌙'
      }
    } catch {}
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
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;')
     .replace(/</g, '&lt;')
     .replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;');

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
    const classname = esc(`${r.method} ${r.resolvedUrl}`);
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
