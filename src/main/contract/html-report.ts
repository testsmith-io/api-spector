// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { ContractReport, ContractResult, FuzzReport } from '../../shared/types';
import type { RecordedResult, EnvironmentState } from './results-store';

// ─── HTML contract reports ────────────────────────────────────────────────────
//
// Self-contained, single-file HTML reports (inline CSS, no external assets) so
// they can be opened straight from disk, attached as CI artifacts, or emailed.
// Two surfaces, mirroring how PactFlow presents results:
//   • reportToHtml    — one verification run, interaction-by-interaction
//   • dashboardToHtml — a matrix of recorded results across versions

export interface ReportMeta {
  title?: string
  provider?: string
  consumer?: string
  spec?: string
  generatedAt?: string
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function modeLabel(mode: string): string {
  if (mode === 'bidirectional') return 'Bi-directional';
  if (mode === 'provider-live') return 'Provider (live)';
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

// API Spector color scheme (mirrors src/renderer/src/index.css dark theme):
// surfaces #272630/#312f3b/#3d3b48, text #e4e3ea, muted #9d9aa8/#7a7785,
// Testsmith blue #205d96 (#6aa3c8 light), Testsmith green #9fc93c.
const STYLE = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background: #272630; color: #e4e3ea; }
.wrap { max-width: 960px; margin: 0 auto; padding: 32px 24px 64px; }
.brand { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; color: #9d9aa8; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.brand .dot { width: 10px; height: 10px; border-radius: 3px; background: #205d96; box-shadow: 0 0 0 2px rgba(32,93,150,.35); }
h1 { font-size: 20px; margin: 0 0 4px; }
.sub { color: #9d9aa8; font-size: 13px; margin: 0 0 24px; }
.meta { display: flex; flex-wrap: wrap; gap: 8px 20px; color: #9d9aa8; font-size: 12px; margin-bottom: 12px; }
.meta b { color: #c4c2cb; font-weight: 600; }
.headline { font-size: 24px; font-weight: 700; }
.headline.ok { color: #9fc93c; } .headline.bad { color: #f87171; }
.bar { display: flex; height: 10px; border-radius: 6px; overflow: hidden; background: #3d3b48; margin: 14px 0 6px; }
.bar > i { display: block; height: 100%; }
.bar .ok { background: #9fc93c; } .bar .bad { background: #f87171; }
.cards { display: flex; flex-direction: column; gap: 10px; margin-top: 24px; }
.card { border: 1px solid #3d3b48; border-radius: 10px; overflow: hidden; background: #312f3b; }
.card.fail { border-color: #7f1d1d; }
.row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
.card.fail summary .row { background: rgba(127,29,29,.18); }
.pill { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 5px; flex-shrink: 0; letter-spacing: .03em; }
.pill.ok { background: #2d3a12; color: #9fc93c; }
.pill.bad { background: rgba(127,29,29,.55); color: #f87171; }
.pill.pend { background: rgba(180,83,9,.35); color: #fbbf24; }
.card.pend { border-color: #92600a; }
.method { font: 700 12px ui-monospace,SFMono-Regular,Menlo,monospace; width: 56px; flex-shrink: 0; color: #6aa3c8; }
.name { flex: 1; color: #e4e3ea; font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.url { color: #7a7785; font: 11px ui-monospace,monospace; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dur { color: #7a7785; font-size: 11px; }
.code { font: 700 12px ui-monospace,monospace; }
.code.s2 { color: #9fc93c; } .code.s3 { color: #fbbf24; } .code.s4, .code.s5 { color: #f87171; }
.viol { padding: 14px 16px; border-top: 1px solid #3d3b48; display: flex; flex-direction: column; gap: 10px; }
.v { border-left: 2px solid #dc2626; background: rgba(127,29,29,.12); border-radius: 0 6px 6px 0; padding: 8px 12px; }
.v .t { font: 700 10px ui-monospace,monospace; color: #f87171; text-transform: uppercase; letter-spacing: .04em; }
.v .path { font: 10px ui-monospace,monospace; color: #9d9aa8; background: #272630; padding: 1px 6px; border-radius: 4px; margin-left: 8px; }
.v .m { color: #fecaca; font-size: 13px; margin: 4px 0 0; }
.v .ea { font: 11px ui-monospace,monospace; margin-top: 4px; display: flex; gap: 18px; }
.v .ea .lab { color: #7a7785; }
.v .ea .exp { color: #9fc93c; } .v .ea .act { color: #f87171; }
.pass-note { color: #9fc93c; font-size: 13px; padding: 12px 16px; border-top: 1px solid #3d3b48; }
table { border-collapse: collapse; width: 100%; margin-top: 16px; font-size: 13px; }
th, td { border: 1px solid #3d3b48; padding: 8px 12px; text-align: left; }
th { background: #312f3b; color: #c4c2cb; font-weight: 600; }
td.cell { text-align: center; }
.b { display: inline-block; min-width: 56px; padding: 2px 8px; border-radius: 5px; font-size: 11px; font-weight: 700; }
.b.ok { background: #2d3a12; color: #9fc93c; }
.b.bad { background: rgba(127,29,29,.55); color: #f87171; }
.b.na { background: #272630; color: #7a7785; }
a.b { text-decoration: none; }
a.b.ok:hover { background: #4a5e1d; } a.b.bad:hover { background: rgba(127,29,29,.8); }
.foot { color: #7a7785; font-size: 11px; margin-top: 40px; text-align: center; }
summary { cursor: pointer; list-style: none; }
summary::-webkit-details-marker { display: none; }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head><body><div class="wrap">
<div class="brand"><span class="dot"></span>API Spector</div>${body}
<p class="foot">Generated by API Spector · contract reporting</p>
</div></body></html>`;
}

// ─── Single-run report ────────────────────────────────────────────────────────

function statusClass(code?: number): string {
  if (code === undefined) return '';
  return 's' + String(code)[0];
}

function violationHtml(r: ContractResult): string {
  if (r.violations.length === 0) return `<div class="pass-note">All expectations met.</div>`;
  const items = r.violations.map(v => {
    const path = v.path ? `<span class="path">${esc(v.path)}</span>` : '';
    const ea = (v.expected || v.actual)
      ? `<div class="ea">${v.expected ? `<span><span class="lab">expected </span><span class="exp">${esc(v.expected)}</span></span>` : ''}${v.actual ? `<span><span class="lab">actual </span><span class="act">${esc(v.actual)}</span></span>` : ''}</div>`
      : '';
    return `<div class="v"><div><span class="t">${esc(v.type.replace(/_/g, ' '))}</span>${path}</div><p class="m">${esc(v.message)}</p>${ea}</div>`;
  }).join('');
  return `<div class="viol">${items}</div>`;
}

function cardHtml(r: ContractResult): string {
  const pill = r.passed
    ? `<span class="pill ok">PASS</span>`
    : r.pending
      ? `<span class="pill pend">PENDING</span>`
      : `<span class="pill bad">FAIL</span>`;
  const status = r.actualStatus !== undefined ? `<span class="code ${statusClass(r.actualStatus)}">${r.actualStatus}</span>` : '';
  const dur = r.durationMs !== undefined ? `<span class="dur">${r.durationMs}ms</span>` : '';
  return `<details class="card ${r.passed ? '' : r.pending ? 'pend' : 'fail'}" ${r.passed ? '' : 'open'}>
  <summary><div class="row">${pill}<span class="method">${esc(r.method)}</span><span class="name">${esc(r.requestName)}</span><span class="url">${esc(r.url)}</span>${status}${dur}</div></summary>
  ${violationHtml(r)}
</details>`;
}

/** Render a single verification run as a standalone HTML page. */
export function reportToHtml(report: ContractReport, meta: ReportMeta = {}): string {
  const okPct  = report.total ? Math.round((report.passed / report.total) * 100) : 100;
  const badPct = 100 - okPct;
  const headlineCls = report.failed === 0 ? 'ok' : 'bad';
  const headline = report.failed === 0 ? '✓ All passed' : `✗ ${report.failed} failed`;

  const metaRows = [
    `<span><b>Mode</b> ${esc(modeLabel(report.mode))}</span>`,
    meta.provider ? `<span><b>Provider</b> ${esc(meta.provider)}</span>` : '',
    meta.consumer ? `<span><b>Consumer</b> ${esc(meta.consumer)}</span>` : '',
    meta.spec ? `<span><b>Spec</b> ${esc(meta.spec)}</span>` : '',
    `<span><b>Duration</b> ${report.durationMs}ms</span>`,
    meta.generatedAt ? `<span><b>Generated</b> ${esc(meta.generatedAt)}</span>` : '',
  ].filter(Boolean).join('');

  const failed = report.results.filter(r => !r.passed);
  const passed = report.results.filter(r => r.passed);
  const cards = [...failed, ...passed].map(cardHtml).join('');

  const body = `
<h1>${esc(meta.title ?? 'Contract Verification Report')}</h1>
<p class="sub"><span class="headline ${headlineCls}">${esc(headline)}</span> &nbsp; ${report.passed} / ${report.total} interactions passed</p>
<div class="meta">${metaRows}</div>
<div class="bar"><i class="ok" style="width:${okPct}%"></i><i class="bad" style="width:${badPct}%"></i></div>
<div class="cards">${cards || '<p class="sub">No interactions ran.</p>'}</div>`;
  return page(meta.title ?? 'Contract Verification Report', body);
}

// ─── Matrix dashboard ─────────────────────────────────────────────────────────

/** Render recorded results as a pacticipant × version matrix (can-i-deploy view).
 *  When `opts.runLinkBase` is set (the serve mode), each cell links to the full
 *  run report at `<runLinkBase>/<pacticipant>/<version>`; file exports stay
 *  link-free so they remain fully self-contained. */
export function dashboardToHtml(
  records: RecordedResult[],
  generatedAt?: string,
  opts: { runLinkBase?: string; environments?: EnvironmentState[] } = {},
): string {
  const pacticipants = [...new Set(records.map(r => r.pacticipant))].sort();
  const versions     = [...new Set(records.map(r => r.version))].sort();
  const byKey = new Map(records.map(r => [`${r.pacticipant}@@${r.version}`, r]));

  const header = `<tr><th>Pacticipant \\ Version</th>${versions.map(v => `<th>${esc(v)}</th>`).join('')}</tr>`;
  const rows = pacticipants.map(p => {
    const cells = versions.map(v => {
      const rec = byKey.get(`${p}@@${v}`);
      if (!rec) return `<td class="cell"><span class="b na">-</span></td>`;
      const cls = rec.passed ? 'ok' : 'bad';
      const label = rec.passed ? `${rec.report.total}/${rec.report.total}` : `${rec.report.passed}/${rec.report.total}`;
      const badge = opts.runLinkBase
        ? `<a class="b ${cls}" href="${esc(opts.runLinkBase)}/${encodeURIComponent(p)}/${encodeURIComponent(v)}">${esc(label)}</a>`
        : `<span class="b ${cls}">${esc(label)}</span>`;
      return `<td class="cell" title="${esc(rec.recordedAt)}">${badge}</td>`;
    }).join('');
    return `<tr><td><b>${esc(p)}</b></td>${cells}</tr>`;
  }).join('');

  const totalPass = records.filter(r => r.passed).length;

  // Environments block: what version each pacticipant runs, per environment,
  // with a pass/fail badge when that version has a recorded verification.
  const envs = opts.environments ?? [];
  const envSection = envs.length ? `
<h2 style="font-size:16px;margin:36px 0 4px;">Environments</h2>
<p class="sub">Recorded with <code>contract record-deployment</code></p>
<table>
<tr><th>Environment</th><th>Pacticipant</th><th>Deployed version</th><th>Verification</th><th>Since</th></tr>
${envs.flatMap(e => Object.entries(e.deployed)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([p, d]) => {
      const rec = byKey.get(`${p}@@${d.version}`);
      const badge = !rec
        ? `<span class="b na">not verified</span>`
        : opts.runLinkBase
          ? `<a class="b ${rec.passed ? 'ok' : 'bad'}" href="${esc(opts.runLinkBase)}/${encodeURIComponent(p)}/${encodeURIComponent(d.version)}">${rec.passed ? 'passed' : 'failed'}</a>`
          : `<span class="b ${rec.passed ? 'ok' : 'bad'}">${rec.passed ? 'passed' : 'failed'}</span>`;
      return `<tr><td><b>${esc(e.name)}</b></td><td>${esc(p)}</td><td>${esc(d.version)}</td><td class="cell">${badge}</td><td>${esc(d.recordedAt.slice(0, 19).replace('T', ' '))}</td></tr>`;
    })).join('')}
</table>` : '';

  const body = `
<h1>Contract Dashboard</h1>
<p class="sub">${records.length} recorded verification${records.length === 1 ? '' : 's'} · ${totalPass} passing</p>
<div class="meta">${generatedAt ? `<span><b>Generated</b> ${esc(generatedAt)}</span>` : ''}</div>
${records.length ? `<table>${header}${rows}</table>` : '<p class="sub">No recorded results yet. Run a verification with <code>--record --app-version &lt;ver&gt;</code>.</p>'}
${envSection}`;
  return page('Contract Dashboard', body);
}

// ─── Fuzz report ──────────────────────────────────────────────────────────────

const ORACLE_LABEL: Record<string, string> = {
  'never-5xx':           'server error',
  'accepted-invalid':    'accepted invalid',
  'undocumented-status': 'undocumented status',
  'response-schema':     'bad response body',
};

/** Render a fuzz run as a standalone HTML page, styled like the other reports. */
export function fuzzReportToHtml(report: FuzzReport, generatedAt?: string): string {
  const clean = report.totalFindings === 0;
  const headlineCls = clean ? 'ok' : 'bad';
  const headline = clean ? '✓ No findings' : `✗ ${report.totalFindings} finding${report.totalFindings === 1 ? '' : 's'}`;

  const metaRows = [
    `<span><b>Input</b> ${report.inputSource === 'spec' ? 'OpenAPI spec' : 'request bodies'}</span>`,
    `<span><b>Cases</b> ${report.totalCases}</span>`,
    `<span><b>Seed</b> ${report.seed}</span>`,
    `<span><b>Duration</b> ${report.durationMs}ms</span>`,
    report.skippedWrites ? `<span><b>Skipped writes</b> ${report.skippedWrites}</span>` : '',
    report.skippedNoBody ? `<span><b>No body</b> ${report.skippedNoBody}</span>` : '',
    generatedAt ? `<span><b>Generated</b> ${esc(generatedAt)}</span>` : '',
  ].filter(Boolean).join('');

  const withFindings = report.results.filter(r => r.findings.length > 0);
  const cleanOps = report.results.length - withFindings.length;
  const hasTrace = report.results.some(r => r.trace && r.trace.length > 0);

  // Trace mode: a table of every case sent, per operation.
  const traceSection = hasTrace ? `
<h2 style="font-size:16px;margin:36px 0 8px;">All cases sent</h2>
${report.results.filter(r => r.trace?.length).map(op => `
<details class="card"><summary><div class="row"><span class="method">${esc(op.method)}</span><span class="name">${esc(op.requestName)}</span><span class="dur">${op.trace!.length} cases</span></div></summary>
<table><tr><th>Status</th><th>Field</th><th>Mutation</th><th>Request body</th><th>Response</th></tr>
${op.trace!.map(t => `<tr><td class="cell"><span class="b ${t.finding ? 'bad' : 'ok'}">${t.status}</span></td><td>${esc(t.mutation.target)}</td><td>${esc(t.mutation.kind)}</td><td class="url" style="max-width:260px">${esc((t.request.body ?? '').slice(0, 200))}</td><td class="url" style="max-width:260px">${esc((t.responseSample ?? '').slice(0, 200))}</td></tr>`).join('')}
</table></details>`).join('')}` : '';

  const cards = withFindings.map(op => {
    const items = op.findings.map(f => {
      const oracle = ORACLE_LABEL[f.oracle] ?? f.oracle;
      const reqBody = f.request.body ? `<div class="ea"><span class="lab">body </span><span class="path">${esc(f.request.body.slice(0, 300))}</span></div>` : '';
      const respSample = f.responseSample ? `<div class="ea"><span class="lab">response </span><span class="path">${esc(f.responseSample.slice(0, 300))}</span></div>` : '';
      return `<div class="v">
        <div><span class="t">${esc(oracle)}</span><span class="path">${esc(f.mutation.target)} · ${esc(f.mutation.kind)}</span></div>
        <p class="m">HTTP ${f.status}: ${esc(f.message)}</p>
        <div class="ea"><span class="lab">mutation </span><span>${esc(f.mutation.description)}</span></div>
        <div class="ea"><span class="lab">request </span><span class="path">${esc(f.request.method)} ${esc(f.request.url)}</span></div>
        ${reqBody}${respSample}
      </div>`;
    }).join('');
    return `<details class="card fail" open>
      <summary><div class="row"><span class="pill bad">${op.findings.length}</span><span class="method">${esc(op.method)}</span><span class="name">${esc(op.requestName)}</span><span class="url">${esc(op.url)}</span><span class="dur">${op.cases} cases</span></div></summary>
      <div class="viol">${items}</div>
    </details>`;
  }).join('');

  const body = `
<h1>Fuzz Report</h1>
<p class="sub"><span class="headline ${headlineCls}">${esc(headline)}</span> &nbsp; ${report.totalCases} malformed cases across ${report.results.length} operation${report.results.length === 1 ? '' : 's'}</p>
<div class="meta">${metaRows}</div>
<div class="cards">${cards || '<p class="pass-note">All operations handled every malformed input safely.</p>'}</div>
${traceSection}
${cleanOps ? `<p class="foot">${cleanOps} operation${cleanOps === 1 ? '' : 's'} had no findings.</p>` : ''}`;
  return page('Fuzz Report', body);
}
