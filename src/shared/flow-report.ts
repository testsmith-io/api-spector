// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Standalone HTML report for a flow run — same visual language as the
// collection runner's report (buildHtmlReport), adapted to the flow's typed
// block records. Self-contained (inline CSS, no assets), dark/light aware.

import type { FlowRunSummary, FlowBlockRunRecord } from './flow-engine';

export interface FlowReportMeta {
  flow?: string
  environment?: string | null
  timestamp?: string
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function pretty(v: unknown): string {
  if (typeof v === 'string') {
    try { return esc(JSON.stringify(JSON.parse(v), null, 2)); } catch { return esc(v); }
  }
  try { return esc(JSON.stringify(v, null, 2)); } catch { return esc(String(v)); }
}

const STATUS_CLS: Record<string, string> = {
  passed: 'badge-pass', failed: 'badge-fail', error: 'badge-err', done: 'badge-done', skipped: 'badge-skip', running: 'badge-done',
};

function blockDetail(b: FlowBlockRunRecord): string {
  const parts: string[] = [];
  if (b.error) parts.push(`<div class="err-row">&#x26a0; ${esc(b.error)}</div>`);
  if (b.testResults?.length) {
    const rows = b.testResults.map(tr =>
      `<div class="test-row ${tr.passed ? 'test-pass' : 'test-fail'}"><span class="dot">${tr.passed ? '✓' : '✗'}</span> ${esc(tr.name)}${!tr.passed && tr.error ? `<div class="test-err">${esc(tr.error)}</div>` : ''}</div>`,
    ).join('');
    parts.push(`<div class="section-label">Tests</div><div class="tests-wrap">${rows}</div>`);
  }
  if (b.type === 'request' && b.resolvedUrl) {
    parts.push(`<div class="section-label">Request</div><div class="mono url">${esc(b.method ?? '')} ${esc(b.resolvedUrl)}</div>`);
  }
  if (b.type === 'log' && b.message) {
    parts.push(`<div class="section-label">Message</div><pre class="code-block">${esc(b.message)}</pre>`);
  }
  if (b.type === 'display' && b.display !== undefined) {
    parts.push(`<div class="section-label">Value</div><pre class="code-block">${pretty(b.display)}</pre>`);
  }
  return parts.join('');
}

export function buildFlowHtmlReport(summary: FlowRunSummary, meta: FlowReportMeta = {}): string {
  const ts = meta.timestamp ?? new Date().toISOString();
  const flow = meta.flow ?? 'Flow';
  const env = meta.environment ?? '—';
  const passRate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;

  const cards = summary.blocks.map((b, idx) => {
    const statusCls = STATUS_CLS[b.status] ?? 'badge-done';
    const httpCls = b.httpStatus == null ? '' : b.httpStatus < 400 ? 'http-ok' : 'http-err';
    const dur = b.durationMs != null ? `${b.durationMs} ms` : '';
    const at = b.atMs != null ? `+${b.atMs} ms` : '';
    const detail = blockDetail(b);
    return `
    <div class="card" id="r${idx}">
      <div class="card-header" ${detail ? `onclick="toggle(${idx})"` : ''}>
        <span class="chevron" id="ch${idx}">${detail ? '▶' : ''}</span>
        <span class="at mono muted">${esc(at)}</span>
        <span class="badge ${statusCls}">${esc(b.status)}</span>
        <span class="type mono">${esc(b.type)}</span>
        <span class="card-name">${esc(b.label)}${b.iteration != null ? ` <span class="muted">#${b.iteration}</span>` : ''}</span>
        <span class="card-url muted">${esc(b.resolvedUrl ?? '')}</span>
        <span class="dur muted">${esc(dur)}</span>
        ${b.httpStatus != null ? `<span class="http-badge ${httpCls}">${b.httpStatus}</span>` : ''}
      </div>
      ${detail ? `<div class="card-body" id="cb${idx}" style="display:none">${detail}</div>` : ''}
    </div>`;
  }).join('\n');

  const vars = summary.variables;
  const varRows = vars
    ? [
        ...Object.entries(vars.localVars).map(([k, v]) => [k, v, 'local']),
        ...Object.entries(vars.collectionVars).map(([k, v]) => [k, v, 'collection']),
        ...Object.entries(vars.globals).map(([k, v]) => [k, v, 'global']),
      ].map(([k, v, scope]) => `<tr><td class="hk mono">${esc(k)}</td><td class="muted">${esc(scope)}</td><td class="hv mono">${esc(v)}</td></tr>`).join('')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(flow)} — Flow Report</title>
<style>
  :root { --bg:#0f1117; --surface:#161b22; --border:#21262d; --text:#c9d1d9; --bright:#e6edf3; --muted:#8b949e;
    --green:#3fb950; --red:#f85149; --amber:#d29922; --blue:#79c0ff;
    --pass-bg:#0d3a1e; --fail-bg:#3d1014; --err-bg:#3d2a00; --skip-bg:#21262d; }
  html.light { --bg:#fff; --surface:#f6f8fa; --border:#d0d7de; --text:#1f2328; --bright:#1f2328; --muted:#656d76;
    --green:#1a7f37; --red:#cf222e; --amber:#9a6700; --blue:#0969da;
    --pass-bg:#dafbe1; --fail-bg:#ffebe9; --err-bg:#fff8c5; --skip-bg:#f6f8fa; }
  *,*::before,*::after { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:system-ui,sans-serif; background:var(--bg); color:var(--text); font-size:13px; line-height:1.5; }
  .wrap { max-width:1100px; margin:0 auto; padding:32px 24px; }
  h1 { font-size:20px; font-weight:600; color:var(--bright); margin-bottom:4px; }
  .meta-line { color:var(--muted); font-size:11px; margin-bottom:24px; }
  .mono { font-family:ui-monospace,Menlo,Consolas,monospace; }
  .muted { color:var(--muted); }
  .theme-toggle { position:fixed; top:16px; right:16px; background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:4px 10px; font-size:16px; cursor:pointer; line-height:1; }
  .summary { display:flex; gap:12px; margin-bottom:24px; flex-wrap:wrap; }
  .stat { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:12px 20px; min-width:90px; }
  .stat-val { font-size:22px; font-weight:700; color:var(--bright); }
  .stat-lbl { font-size:11px; color:var(--muted); margin-top:2px; }
  .stat-pass .stat-val { color:var(--green); } .stat-fail .stat-val { color:var(--red); } .stat-err .stat-val { color:var(--amber); }
  .section-title { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:600; margin:24px 0 8px; }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:8px; margin-bottom:6px; overflow:hidden; }
  .card-header { display:flex; align-items:center; gap:10px; padding:10px 14px; cursor:default; }
  .card-header[onclick] { cursor:pointer; }
  .chevron { width:10px; color:var(--muted); font-size:9px; transition:transform .15s; }
  .chevron.open { transform:rotate(90deg); }
  .at { width:74px; font-size:11px; text-align:right; flex-shrink:0; }
  .badge { font-size:10px; font-weight:700; text-transform:uppercase; padding:2px 7px; border-radius:4px; letter-spacing:.04em; }
  .badge-pass { background:var(--pass-bg); color:var(--green); } .badge-fail { background:var(--fail-bg); color:var(--red); }
  .badge-err { background:var(--err-bg); color:var(--amber); } .badge-done,.badge-skip { background:var(--skip-bg); color:var(--muted); }
  .type { font-size:11px; color:var(--blue); min-width:64px; }
  .card-name { font-weight:500; color:var(--bright); }
  .card-url { font-family:ui-monospace,monospace; font-size:11px; margin-left:auto; max-width:40%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .dur { font-size:11px; }
  .http-badge { font-family:ui-monospace,monospace; font-size:11px; font-weight:600; padding:1px 6px; border-radius:4px; background:var(--skip-bg); }
  .http-ok { color:var(--green); } .http-err { color:var(--red); }
  .card-body { padding:12px 16px 14px 34px; border-top:1px solid var(--border); }
  .section-label { font-size:10px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); font-weight:600; margin:10px 0 4px; }
  .code-block { background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:8px 10px; font-family:ui-monospace,monospace; font-size:11px; white-space:pre-wrap; word-break:break-all; max-height:360px; overflow:auto; }
  .url { font-size:11px; }
  .err-row { color:var(--red); font-size:12px; margin:4px 0; }
  .test-row { font-size:12px; padding:2px 0; } .test-pass .dot { color:var(--green); } .test-fail { color:var(--red); } .test-fail .dot { color:var(--red); }
  .test-err { color:var(--red); font-family:ui-monospace,monospace; font-size:11px; margin-left:16px; }
  table.vars { width:100%; border-collapse:collapse; background:var(--surface); border:1px solid var(--border); border-radius:8px; overflow:hidden; }
  table.vars td { padding:5px 10px; border-bottom:1px solid var(--border); font-size:12px; }
  .hk { color:var(--bright); } .hv { color:var(--text); word-break:break-all; }
</style>
</head>
<body>
<button class="theme-toggle" onclick="document.documentElement.classList.toggle('light')" title="Toggle theme">◐</button>
<div class="wrap">
  <h1>${esc(flow)}</h1>
  <div class="meta-line">Flow report · ${esc(env)} · ${esc(ts)}</div>
  <div class="summary">
    <div class="stat stat-pass"><div class="stat-val">${summary.passed}</div><div class="stat-lbl">Passed</div></div>
    <div class="stat stat-fail"><div class="stat-val">${summary.failed}</div><div class="stat-lbl">Failed</div></div>
    <div class="stat stat-err"><div class="stat-val">${summary.errors}</div><div class="stat-lbl">Errors</div></div>
    <div class="stat"><div class="stat-val">${summary.total}</div><div class="stat-lbl">Blocks</div></div>
    <div class="stat"><div class="stat-val">${passRate}%</div><div class="stat-lbl">Pass rate</div></div>
    <div class="stat"><div class="stat-val">${summary.durationMs}<span style="font-size:13px">ms</span></div><div class="stat-lbl">Duration</div></div>
  </div>
  <div class="section-title">Run log</div>
  ${cards}
  ${varRows ? `<div class="section-title">Variables</div><table class="vars"><tbody>${varRows}</tbody></table>` : ''}
</div>
<script>
  function toggle(i){ var b=document.getElementById('cb'+i), c=document.getElementById('ch'+i);
    if(!b)return; var open=b.style.display!=='none'; b.style.display=open?'none':'block'; if(c)c.classList.toggle('open',!open); }
</script>
</body>
</html>`;
}
