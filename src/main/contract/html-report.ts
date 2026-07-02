// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { ContractReport, ContractResult } from '../../shared/types';
import type { RecordedResult } from './results-store';

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

const STYLE = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background: #0f1115; color: #e5e7eb; }
.wrap { max-width: 960px; margin: 0 auto; padding: 32px 24px 64px; }
h1 { font-size: 20px; margin: 0 0 4px; }
.sub { color: #8b929e; font-size: 13px; margin: 0 0 24px; }
.meta { display: flex; flex-wrap: wrap; gap: 8px 20px; color: #9aa1ad; font-size: 12px; margin-bottom: 12px; }
.meta b { color: #cbd2dc; font-weight: 600; }
.headline { font-size: 24px; font-weight: 700; }
.headline.ok { color: #34d399; } .headline.bad { color: #f87171; }
.bar { display: flex; height: 10px; border-radius: 6px; overflow: hidden; background: #1b1f27; margin: 14px 0 6px; }
.bar > i { display: block; height: 100%; }
.bar .ok { background: #34d399; } .bar .bad { background: #f87171; }
.cards { display: flex; flex-direction: column; gap: 10px; margin-top: 24px; }
.card { border: 1px solid #232834; border-radius: 10px; overflow: hidden; background: #141821; }
.card.fail { border-color: #7f1d1d; }
.row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
.card.fail summary .row { background: rgba(127,29,29,.18); }
.pill { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 5px; flex-shrink: 0; letter-spacing: .03em; }
.pill.ok { background: rgba(16,84,55,.55); color: #34d399; }
.pill.bad { background: rgba(127,29,29,.55); color: #f87171; }
.method { font: 700 12px ui-monospace,SFMono-Regular,Menlo,monospace; width: 56px; flex-shrink: 0; color: #93c5fd; }
.name { flex: 1; color: #f3f4f6; font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.url { color: #6b7280; font: 11px ui-monospace,monospace; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dur { color: #6b7280; font-size: 11px; }
.code { font: 700 12px ui-monospace,monospace; }
.code.s2 { color: #34d399; } .code.s3 { color: #fbbf24; } .code.s4, .code.s5 { color: #f87171; }
.viol { padding: 14px 16px; border-top: 1px solid #1f2530; display: flex; flex-direction: column; gap: 10px; }
.v { border-left: 2px solid #dc2626; background: rgba(127,29,29,.12); border-radius: 0 6px 6px 0; padding: 8px 12px; }
.v .t { font: 700 10px ui-monospace,monospace; color: #f87171; text-transform: uppercase; letter-spacing: .04em; }
.v .path { font: 10px ui-monospace,monospace; color: #8b929e; background: #1b1f27; padding: 1px 6px; border-radius: 4px; margin-left: 8px; }
.v .m { color: #fecaca; font-size: 13px; margin: 4px 0 0; }
.v .ea { font: 11px ui-monospace,monospace; margin-top: 4px; display: flex; gap: 18px; }
.v .ea .lab { color: #6b7280; }
.v .ea .exp { color: #34d399; } .v .ea .act { color: #f87171; }
.pass-note { color: #34d399; font-size: 13px; padding: 12px 16px; border-top: 1px solid #1f2530; }
table { border-collapse: collapse; width: 100%; margin-top: 16px; font-size: 13px; }
th, td { border: 1px solid #232834; padding: 8px 12px; text-align: left; }
th { background: #141821; color: #cbd2dc; font-weight: 600; }
td.cell { text-align: center; }
.b { display: inline-block; min-width: 56px; padding: 2px 8px; border-radius: 5px; font-size: 11px; font-weight: 700; }
.b.ok { background: rgba(16,84,55,.55); color: #34d399; }
.b.bad { background: rgba(127,29,29,.55); color: #f87171; }
.b.na { background: #1b1f27; color: #6b7280; }
.foot { color: #6b7280; font-size: 11px; margin-top: 40px; text-align: center; }
summary { cursor: pointer; list-style: none; }
summary::-webkit-details-marker { display: none; }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head><body><div class="wrap">${body}
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
  const pill = r.passed ? `<span class="pill ok">PASS</span>` : `<span class="pill bad">FAIL</span>`;
  const status = r.actualStatus !== undefined ? `<span class="code ${statusClass(r.actualStatus)}">${r.actualStatus}</span>` : '';
  const dur = r.durationMs !== undefined ? `<span class="dur">${r.durationMs}ms</span>` : '';
  return `<details class="card ${r.passed ? '' : 'fail'}" ${r.passed ? '' : 'open'}>
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

/** Render recorded results as a pacticipant × version matrix (can-i-deploy view). */
export function dashboardToHtml(records: RecordedResult[], generatedAt?: string): string {
  const pacticipants = [...new Set(records.map(r => r.pacticipant))].sort();
  const versions     = [...new Set(records.map(r => r.version))].sort();
  const byKey = new Map(records.map(r => [`${r.pacticipant}@@${r.version}`, r]));

  const header = `<tr><th>Pacticipant \\ Version</th>${versions.map(v => `<th>${esc(v)}</th>`).join('')}</tr>`;
  const rows = pacticipants.map(p => {
    const cells = versions.map(v => {
      const rec = byKey.get(`${p}@@${v}`);
      if (!rec) return `<td class="cell"><span class="b na">—</span></td>`;
      const cls = rec.passed ? 'ok' : 'bad';
      const label = rec.passed ? `${rec.report.total}/${rec.report.total}` : `${rec.report.passed}/${rec.report.total}`;
      return `<td class="cell" title="${esc(rec.recordedAt)}"><span class="b ${cls}">${esc(label)}</span></td>`;
    }).join('');
    return `<tr><td><b>${esc(p)}</b></td>${cells}</tr>`;
  }).join('');

  const totalPass = records.filter(r => r.passed).length;
  const body = `
<h1>Contract Dashboard</h1>
<p class="sub">${records.length} recorded verification${records.length === 1 ? '' : 's'} · ${totalPass} passing</p>
<div class="meta">${generatedAt ? `<span><b>Generated</b> ${esc(generatedAt)}</span>` : ''}</div>
${records.length ? `<table>${header}${rows}</table>` : '<p class="sub">No recorded results yet. Run a verification with <code>--record --app-version &lt;ver&gt;</code>.</p>'}`;
  return page('Contract Dashboard', body);
}
