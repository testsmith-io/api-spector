// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Renders a finished performance run as a self-contained HTML report: no
// external assets, inline CSS, inline SVG charts. Mirrors the contract report
// exporter. The result is written to a file the user chooses (perf:exportHtml).

import type { PerfResult } from '../shared/types';

export interface PerfReportMeta {
  planName?: string
  target?: string
  generatedAt?: string
}

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const ms = (v: number): string => v < 1 ? '&lt;1 ms' : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(2)} s`;
const bytes = (v: number): string => v < 1024 ? `${v} B` : v < 1024 * 1024 ? `${(v / 1024).toFixed(1)} KB` : `${(v / (1024 * 1024)).toFixed(2)} MB`;
const pct = (v: number): string => `${v.toFixed(1)}%`;

const OP: Record<string, string> = { lt: '<', lte: '≤', gt: '>', gte: '≥' };
const METRIC: Record<string, string> = { iteration_p95: 'Iteration p95', iteration_p99: 'Iteration p99', req_p95: 'Request p95', error_rate: 'Error rate', throughput: 'Throughput' };

function seriesSvg(series: PerfResult['series']): string {
  if (series.length === 0) return '';
  const W = 1000, H = 200, pad = 28;
  const maxRps = Math.max(1, ...series.map(s => s.rps));
  const maxP95 = Math.max(1, ...series.map(s => s.p95));
  const bw = (W - pad * 2) / series.length;
  const bars = series.map((s, i) => {
    const h = (s.rps / maxRps) * (H - pad * 2);
    return `<rect x="${(pad + i * bw + bw * 0.1).toFixed(1)}" y="${(H - pad - h).toFixed(1)}" width="${(bw * 0.8).toFixed(1)}" height="${h.toFixed(1)}" fill="#f59e0b" opacity="0.55"/>`;
  }).join('');
  const line = series.map((s, i) => `${(pad + i * bw + bw * 0.5).toFixed(1)},${(H - pad - (s.p95 / maxP95) * (H - pad * 2)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" style="height:220px">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#334" stroke-width="1"/>
    ${bars}
    <polyline points="${line}" fill="none" stroke="#e879f9" stroke-width="2"/>
  </svg>
  <div class="muted small">bars: iterations/sec (peak ${Math.round(maxRps)})  ·  line: p95 latency (peak ${ms(maxP95)})  ·  ${series.length}s</div>`;
}

export function perfReportToHtml(result: PerfResult, meta: PerfReportMeta = {}): string {
  const errorRate = result.iterations > 0 ? (result.iterationsFailed / result.iterations) * 100 : 0;
  const pass = result.passed;
  const kpi = (label: string, value: string, sub = ''): string =>
    `<div class="kpi"><div class="kpi-l">${esc(label)}</div><div class="kpi-v">${value}</div>${sub ? `<div class="kpi-s">${sub}</div>` : ''}</div>`;

  const thresholdsHtml = result.thresholds.length ? `
    <h2>Thresholds</h2>
    <table><thead><tr><th>Metric</th><th>Condition</th><th>Actual</th><th>Result</th></tr></thead><tbody>
    ${result.thresholds.map(t => `<tr>
      <td>${esc(METRIC[t.metric] ?? t.metric)}</td>
      <td>${OP[t.op] ?? t.op} ${t.value}</td>
      <td class="num">${t.metric === 'error_rate' ? pct(t.actual) : t.metric === 'throughput' ? t.actual.toFixed(1) : ms(t.actual)}</td>
      <td><span class="badge ${t.passed ? 'ok' : 'bad'}">${t.passed ? 'PASS' : 'FAIL'}</span></td>
    </tr>`).join('')}
    </tbody></table>` : '';

  const stepsHtml = `
    <h2>${result.mode === 'flow' ? 'Steps (per request in the flow)' : result.mode === 'sequence' ? 'Steps (per request in the sequence)' : 'Request'}</h2>
    <table><thead><tr><th>Step</th><th class="num">Count</th><th class="num">p95</th><th class="num">Mean</th><th class="num">Max</th><th class="num">Fail</th></tr></thead><tbody>
    ${result.steps.map((s, i) => `<tr>
      <td>${result.mode !== 'request' ? `${i + 1}. ` : ''}${esc(s.name)}</td>
      <td class="num">${s.count}</td><td class="num">${ms(s.latency.p95)}</td><td class="num">${ms(s.latency.mean)}</td><td class="num">${ms(s.latency.max)}</td>
      <td class="num ${s.failed > 0 ? 'red' : ''}">${s.failed}</td>
    </tr>`).join('')}
    </tbody></table>`;

  const latRows = ([['min', result.requestLatency.min], ['mean', result.requestLatency.mean], ['p50', result.requestLatency.p50], ['p90', result.requestLatency.p90], ['p95', result.requestLatency.p95], ['p99', result.requestLatency.p99], ['max', result.requestLatency.max]] as const)
    .map(([k, v]) => `<tr><td>${k}</td><td class="num">${ms(v)}</td></tr>`).join('');

  const statusHtml = Object.entries(result.statusCounts).sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `<span class="chip">${c === 'error' ? 'error' : esc(c)} &times;${n}</span>`).join(' ');

  const errorsHtml = Object.keys(result.errors).length ? `
    <h2>Errors</h2><ul class="errs">${Object.entries(result.errors).sort((a, b) => b[1] - a[1]).map(([m, n]) => `<li><code>${esc(m)}</code> &times;${n}</li>`).join('')}</ul>` : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Performance report — ${esc(meta.planName ?? 'API Spector')}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b1622; color: #dfe7ef; font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 32px 20px 64px; }
  header { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; border-bottom: 1px solid #1e2d3e; padding-bottom: 16px; margin-bottom: 24px; }
  h1 { font-size: 20px; margin: 0; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #7f93ab; margin: 28px 0 10px; }
  .sub { color: #7f93ab; font-size: 12px; }
  .badge { font-weight: 700; font-size: 12px; padding: 3px 10px; border-radius: 6px; }
  .badge.ok { background: #0f3d2a; color: #34d399; } .badge.bad { background: #44181b; color: #f87171; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .kpi { background: #111f2e; border: 1px solid #1e2d3e; border-radius: 8px; padding: 12px; }
  .kpi-l { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #7f93ab; }
  .kpi-v { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .kpi-s { font-size: 11px; color: #7f93ab; }
  .accent .kpi-v { color: #fbbf24; }
  table { width: 100%; border-collapse: collapse; background: #111f2e; border: 1px solid #1e2d3e; border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 7px 12px; border-bottom: 1px solid #1a2838; font-variant-numeric: tabular-nums; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #7f93ab; }
  td.num, th.num { text-align: right; } td.red { color: #f87171; }
  .chart { background: #0d1a28; border: 1px solid #1e2d3e; border-radius: 8px; padding: 12px; }
  .chip { display: inline-block; border: 1px solid #2a3b4f; border-radius: 6px; padding: 2px 8px; font-size: 12px; margin: 0 4px 4px 0; font-variant-numeric: tabular-nums; }
  .muted { color: #7f93ab; } .small { font-size: 11px; margin-top: 8px; }
  code { background: #0d1a28; padding: 1px 5px; border-radius: 4px; color: #f9a8a8; font-size: 12px; }
  .errs { margin: 0; padding-left: 18px; } .errs li { margin: 3px 0; }
  footer { margin-top: 40px; color: #7f93ab; font-size: 11px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
  @media (max-width: 720px) { .kpis { grid-template-columns: repeat(2, 1fr); } .cols { grid-template-columns: 1fr; } }
</style></head>
<body><div class="wrap">
  <header>
    <h1>Performance report</h1>
    ${result.thresholds.length ? `<span class="badge ${pass ? 'ok' : 'bad'}">${pass ? 'PASSED' : 'FAILED'}</span>` : ''}
    <span class="sub">${esc(meta.planName ?? '')}${meta.target ? ` &middot; ${esc(meta.target)}` : ''} &middot; ${esc(result.pattern)} / ${esc(result.executor)}${meta.generatedAt ? ` &middot; ${esc(meta.generatedAt)}` : ''}${result.stopped ? ' &middot; stopped early' : ''}</span>
  </header>

  <div class="kpis">
    ${kpi('Throughput', `${result.iterationsPerSec.toFixed(1)}`, `iter/s · ${result.requestsPerSec.toFixed(1)} req/s`)}
    ${kpi('Iteration p95', ms(result.iterationLatency.p95), `p99 ${ms(result.iterationLatency.p99)}`)}
    ${kpi('Error rate', pct(errorRate), `${result.iterationsFailed} / ${result.iterations} iterations`)}
    ${kpi('Peak users', String(result.peakVus), result.droppedArrivals > 0 ? `${result.droppedArrivals} dropped` : ms(result.durationMs))}
  </div>

  ${thresholdsHtml}

  <h2>Over time (per second)</h2>
  <div class="chart">${seriesSvg(result.series)}</div>

  ${stepsHtml}

  <div class="cols">
    <div>
      <h2>Request latency (all steps)</h2>
      <table><tbody>${latRows}
        <tr><td>data read</td><td class="num">${bytes(result.bytes)} (${bytes(result.bytesPerSec)}/s)</td></tr>
      </tbody></table>
    </div>
    <div>
      <h2>Status codes</h2>
      <div>${statusHtml || '<span class="muted">none</span>'}</div>
      ${errorsHtml}
    </div>
  </div>

  <footer>Generated by API Spector &middot; ${result.iterations} iterations over ${ms(result.durationMs)}</footer>
</div></body></html>`;
}
