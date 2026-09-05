#!/usr/bin/env node
// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

/**
 * API Spector coverage CLI
 *
 * Measures how much of an OpenAPI contract the workspace actually tests.
 *
 * Usage:
 *   api-spector coverage --workspace <path> --spec <file|url> [options]
 *
 * Options:
 *   --workspace <path>     Workspace file or directory (required).
 *   --spec <file|url>      OpenAPI 3.x document (JSON or YAML) to measure against.
 *                          Defaults to settings.coverageSpec if set.
 *   --collection <name>    Only count requests from this collection.
 *   --json                 Print the report as JSON.
 *   --output <path>        Write the report to a file (.json or .html by extension).
 *   --fail-under <pct>     Exit 1 if operation coverage is below this percentage
 *                          (for CI gating).
 *   --runs <report.json>   An `api-spector run --output` report; credits response
 *                          codes and response-schema properties actually seen.
 *   --help                 Show this help.
 */

import { readFile, writeFile } from 'fs/promises';
import { load as yamlLoad } from 'js-yaml';
import { fetch } from 'undici';
import type { Workspace, Collection, ApiRequest } from '../shared/types';
import { computeCoverage, flattenValuePaths, type CoverageReport, type CoverageRequestInput, type CoverageObservation } from '../shared/coverage';
import { parseArgs, loadWorkspace, loadCollections, C, color } from './cli-common';

// Turn an `api-spector run --output report.json` file into coverage
// observations: what status each call returned and which response fields it saw.
async function loadObservations(path: string): Promise<CoverageObservation[]> {
  const report = JSON.parse(await readFile(path, 'utf8')) as { results?: Array<{ method?: string; url?: string; status?: number; httpStatus?: number; response?: { body?: string } }> };
  const out: CoverageObservation[] = [];
  for (const r of report.results ?? []) {
    if (!r.method || !r.url) continue;
    const status = r.httpStatus ?? r.status;
    if (typeof status !== 'number') continue;
    let responsePaths: string[] | undefined;
    try { if (r.response?.body) responsePaths = flattenValuePaths(JSON.parse(r.response.body)); } catch { /* non-JSON body */ }
    out.push({ method: r.method, url: r.url, status, responsePaths });
  }
  return out;
}

async function loadSpec(source: string): Promise<unknown> {
  const isUrl = /^https?:\/\//i.test(source);
  const raw = isUrl
    ? await (async () => { const r = await fetch(source); if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${source}`); return r.text(); })()
    : await readFile(source, 'utf8');
  const isYaml = /\.ya?ml$/i.test(source) || (!source.trim().startsWith('{') && !isUrl);
  return isYaml ? yamlLoad(raw) : JSON.parse(raw);
}

// Every non-example request across the loaded collections, reduced to what the
// coverage engine needs. Expected status comes from a request's contract.
function collectRequests(collections: Collection[]): CoverageRequestInput[] {
  const out: CoverageRequestInput[] = [];
  for (const col of collections) {
    for (const req of Object.values(col.requests ?? {}) as ApiRequest[]) {
      if (req.disabled) continue;
      out.push({
        name: `${col.name} / ${req.name}`,
        method: req.method,
        url: req.url,
        expectedStatus: req.contract?.statusCode,
      });
    }
  }
  return out;
}

function bar(pct: number): string {
  const filled = Math.round(pct / 5);
  return '█'.repeat(filled) + '░'.repeat(20 - filled);
}

function pctColor(pct: number): string {
  return pct >= 80 ? C.green : pct >= 50 ? C.yellow : C.red;
}

function printReport(report: CoverageReport): void {
  const t = report.totals;
  const title = report.spec.title ? `${report.spec.title}${report.spec.version ? ` v${report.spec.version}` : ''}` : 'API';
  console.log('');
  console.log(color(`  ${title} - test coverage`, C.bold, C.white));
  console.log('');
  console.log(`  ${color(bar(t.operationPct), pctColor(t.operationPct))}  ${color(`${t.operationPct}%`, C.bold)} operations tested  (${t.tested}/${t.operations})`);
  console.log(`  ${color(`${t.coveredStatuses}/${t.declaredStatuses}`, C.white)} declared response codes covered  (${t.statusPct}%)`);
  if (t.declaredProperties > 0) {
    console.log(`  ${color(`${t.coveredProperties}/${t.declaredProperties}`, C.white)} response-schema properties seen in runs  (${t.propertyPct}%)`);
  }
  console.log(`  ${color(String(t.untested), t.untested ? C.yellow : C.green)} operations never tested, ${color(String(t.withoutNegativeTest), t.withoutNegativeTest ? C.yellow : C.green)} without a negative test`);
  console.log('');

  // Group by path for a readable list.
  for (const op of report.operations) {
    const mark = op.tested ? color('✓', C.green) : color('✗', C.red);
    const label = `${op.method.padEnd(6)} ${op.path}`;
    const statuses = op.declaredStatuses.length
      ? color(`  [${op.coveredStatuses.length}/${op.declaredStatuses.length} codes]`, C.gray)
      : '';
    const neg = op.tested && !op.hasNegativeTest ? color('  no negative test', C.yellow) : '';
    console.log(`  ${mark} ${op.tested ? color(label, C.white) : color(label, C.dim)}${statuses}${neg}`);
  }
  console.log('');
}

function toHtml(report: CoverageReport): string {
  const t = report.totals;
  const rows = report.operations.map(op => `
    <tr class="${op.tested ? 'ok' : 'miss'}">
      <td>${op.tested ? '✓' : '✗'}</td>
      <td><code>${op.method}</code></td>
      <td><code>${op.path}</code></td>
      <td>${op.declaredStatuses.length ? `${op.coveredStatuses.length}/${op.declaredStatuses.length}` : '-'}</td>
      <td>${op.tested ? (op.hasNegativeTest ? 'yes' : '<span class="warn">missing</span>') : '-'}</td>
      <td>${op.requests.map(r => r.replace(/</g, '&lt;')).join('<br>') || '-'}</td>
    </tr>`).join('');
  const title = (report.spec.title ?? 'API') + (report.spec.version ? ` v${report.spec.version}` : '');
  return `<!doctype html><meta charset="utf-8"><title>${title} coverage</title>
<style>
  body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:2rem;color:#1c1b24}
  h1{font-size:1.4rem} .big{font-size:2rem;font-weight:700}
  .summary{display:flex;gap:2rem;margin:1rem 0 1.5rem}
  table{border-collapse:collapse;width:100%} th,td{text-align:left;padding:.4rem .6rem;border-bottom:1px solid #eee;vertical-align:top}
  code{background:#f4f4f5;padding:.1rem .3rem;border-radius:4px} tr.miss td{color:#b91c1c} .warn{color:#b45309}
  th{color:#666;font-weight:600;font-size:.8rem;text-transform:uppercase;letter-spacing:.03em}
</style>
<h1>${title} - test coverage</h1>
<div class="summary">
  <div><div class="big">${t.operationPct}%</div>operations tested (${t.tested}/${t.operations})</div>
  <div><div class="big">${t.statusPct}%</div>response codes (${t.coveredStatuses}/${t.declaredStatuses})</div>
  <div><div class="big">${t.untested}</div>never tested</div>
  <div><div class="big">${t.withoutNegativeTest}</div>without negative test</div>
</div>
<table><thead><tr><th></th><th>Method</th><th>Operation</th><th>Codes</th><th>Negative</th><th>Tests</th></tr></thead>
<tbody>${rows}</tbody></table>`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log('\nUsage:\n  api-spector coverage --workspace <path> --spec <file|url> [--json] [--output <file>] [--fail-under <pct>] [--collection <name>]\n');
    process.exit(0);
  }

  const wsPath = args.workspace as string;
  if (!wsPath) { console.error('Error: --workspace is required.'); process.exit(2); }

  const { workspace, dir } = await loadWorkspace(wsPath);
  const specSource = (args.spec as string) || (workspace as Workspace).settings?.coverageSpec;
  if (!specSource) { console.error('Error: --spec <file|url> is required (or set settings.coverageSpec in the workspace).'); process.exit(2); }

  let spec: unknown;
  try {
    spec = await loadSpec(specSource);
  } catch (err) {
    console.error(`Error loading spec: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  const collections = await loadCollections(workspace, dir, { filterName: args.collection as string | undefined });
  const requests = collectRequests(collections);
  const observations = args.runs ? await loadObservations(args.runs as string) : [];
  const report = computeCoverage(spec, requests, observations);

  if (args.output) {
    const path = args.output as string;
    const content = /\.html?$/i.test(path) ? toHtml(report) : JSON.stringify(report, null, 2);
    await writeFile(path, content, 'utf8');
    console.error(`Wrote ${path}`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (!args.output) {
    printReport(report);
  }

  // CI gate: fail the build when coverage is below the threshold.
  if (args['fail-under'] !== undefined) {
    const threshold = Number(args['fail-under']);
    if (!Number.isNaN(threshold) && report.totals.operationPct < threshold) {
      console.error(`Coverage ${report.totals.operationPct}% is below --fail-under ${threshold}%.`);
      process.exit(1);
    }
  }
}

main().catch(err => { console.error(err instanceof Error ? err.message : String(err)); process.exit(2); });
