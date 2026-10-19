#!/usr/bin/env node
// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

/**
 * API Spector CLI — performance (load) testing
 *
 * Usage:
 *   api-spector perf list --workspace <path>
 *   api-spector perf run <plan> --workspace <path> [overrides]
 *
 * Runs a saved performance plan headless. The plan's target (request, a
 * collection/folder sequence, or a flow), load pattern, think time and
 * thresholds come from the workspace; the flags below override the load
 * profile for this run (handy for a lighter smoke in CI, a heavier nightly).
 *
 * Options:
 *   --workspace   <path>    Workspace (.spector file or its folder) (required)
 *   --environment <name>    Environment to activate (also: --env)
 *   --out         <path>    Write a report (.html or .json)
 *   --json                  Print the full result as JSON to stdout
 *   --quiet                 Suppress the live progress line
 *   --help                  Show this message
 *
 * Load-profile overrides (optional):
 *   --pattern basic|stepping|arrivals|custom
 *   --vus <n>               Basic: virtual users
 *   --duration <dur>        Basic hold / arrivals duration (e.g. 30, 90s, 5m, 1h30m)
 *   --ramp-up <dur>  --ramp-down <dur>
 *   --rate <n>              Arrivals: iterations per second
 *   --max-vus <n>           Arrivals: concurrency cap
 *   --start-users <n> --step-users <n> --step-duration <dur> --max-users <n>
 *   --timeout <dur>         Per-request timeout (0 = none)
 *   --think <spec>          Think time, e.g. "2" or "1-3" (seconds)
 *   --threshold "<metric> <op> <value>"   Repeatable; replaces the plan's gates
 *                           metrics: iteration_p95 iteration_p99 req_p95 error_rate throughput
 *                           ops: lt lte gt gte (or < <= > >=)
 *
 * Exit code is non-zero when a threshold fails, or the run errors.
 */

import { writeFile } from 'node:fs/promises';
import { extname } from 'node:path';

declare const __APP_VERSION__: string;

import type { ApiRequest, Collection, PerfPlan, PerfThreshold, PerfThresholdMetric, PerfThresholdOp, Workspace } from '../shared/types';
import { buildEnvVars } from '../main/interpolation';
import { setSecretsConfig } from '../main/secrets';
import { loadGlobals, getGlobals } from '../main/globals-store';
import { selectEnvironment } from '../shared/environments';
import { normalizeFlow } from '../shared/flow-blocks';
import { deriveLoad } from '../shared/perf-stages';
import { runPerfPlan, type PerfRunPayload } from '../main/perf-run';
import { perfReportToHtml } from '../main/perf-report';
import { C, color, parseArgs, loadWorkspace, loadCollections, loadEnvironments, loadFlows } from './cli-common';

function parseDurationSec(s: string | undefined): number | undefined {
  if (s == null) return undefined;
  const str = String(s).trim();
  if (/^\d+(\.\d+)?$/.test(str)) return Number(str);          // bare number = seconds
  let total = 0; let matched = false;
  for (const m of str.matchAll(/(\d+)\s*(h|m|s)/gi)) { matched = true; total += Number(m[1]) * (m[2].toLowerCase() === 'h' ? 3600 : m[2].toLowerCase() === 'm' ? 60 : 1); }
  return matched ? total : undefined;
}

function parseThreshold(spec: string): PerfThreshold | null {
  const m = spec.trim().match(/^(\S+)\s*(lt|lte|gt|gte|<=|>=|<|>)\s*([\d.]+)$/i);
  if (!m) return null;
  const opMap: Record<string, PerfThresholdOp> = { '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte', lt: 'lt', lte: 'lte', gt: 'gt', gte: 'gte' };
  const metric = m[1] as PerfThresholdMetric;
  const op = opMap[m[2].toLowerCase()];
  const valid: PerfThresholdMetric[] = ['iteration_p95', 'iteration_p99', 'req_p95', 'error_rate', 'throughput'];
  if (!valid.includes(metric) || !op) return null;
  return { metric, op, value: Number(m[3]) };
}

function fmtMs(v: number): string { return v < 1 ? '<1 ms' : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(2)} s`; }

// Apply the CLI load-profile overrides onto a cloned plan.
function applyOverrides(plan: PerfPlan, args: Record<string, string | boolean | string[]>): PerfPlan {
  const p: PerfPlan = JSON.parse(JSON.stringify(plan));
  const num = (k: string): number | undefined => { const v = args[k]; return typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined; };
  const dur = (k: string): number | undefined => typeof args[k] === 'string' ? parseDurationSec(args[k] as string) : undefined;

  if (typeof args.pattern === 'string' && ['basic', 'stepping', 'arrivals', 'custom'].includes(args.pattern)) p.pattern = args.pattern as PerfPlan['pattern'];
  if (num('vus') !== undefined) p.basic.vus = num('vus')!;
  if (dur('duration') !== undefined) { p.basic.durationSec = dur('duration')!; p.arrivals.durationSec = dur('duration')!; }
  if (dur('ramp-up') !== undefined) p.basic.rampUpSec = dur('ramp-up')!;
  if (dur('ramp-down') !== undefined) p.basic.rampDownSec = dur('ramp-down')!;
  if (num('rate') !== undefined) p.arrivals.rate = num('rate')!;
  if (num('max-vus') !== undefined) p.arrivals.maxVus = num('max-vus')!;
  if (num('start-users') !== undefined) p.stepping.startUsers = num('start-users')!;
  if (num('step-users') !== undefined) p.stepping.stepUsers = num('step-users')!;
  if (dur('step-duration') !== undefined) p.stepping.stepDurationSec = dur('step-duration')!;
  if (num('max-users') !== undefined) p.stepping.maxUsers = num('max-users')!;
  if (dur('timeout') !== undefined) p.timeoutSec = dur('timeout')!;
  if (typeof args.think === 'string') {
    const t = args.think.trim();
    const range = t.match(/^([\d.]+)\s*-\s*([\d.]+)$/);
    if (range) p.thinkTime = { minSec: Number(range[1]), maxSec: Number(range[2]) };
    else if (Number.isFinite(Number(t))) p.thinkTime = { minSec: Number(t), maxSec: Number(t) };
  }
  const thr = args.threshold;
  if (thr !== undefined) {
    const specs = Array.isArray(thr) ? thr : [thr as string];
    const parsed = specs.map(parseThreshold).filter((x): x is PerfThreshold => !!x);
    p.thresholds = parsed;
  }
  return p;
}

async function main() {
  const argv = process.argv.slice(2);
  const positionals: string[] = [];
  for (const a of argv) { if (a.startsWith('--')) break; positionals.push(a); }
  const sub = positionals[0];
  const name = positionals[1];
  const args = parseArgs(argv, ['threshold']);

  if (args.help || !sub || (sub !== 'run' && sub !== 'list')) {
    console.log('\nUsage:\n  api-spector perf list --workspace <path>\n  api-spector perf run <plan> --workspace <path> [--vus N] [--duration 5m] [--rate N] [--threshold "iteration_p95 lt 500"] [--out report.html]\n');
    process.exit(args.help ? 0 : 1);
  }

  const wsPath = args.workspace as string;
  if (!wsPath) { console.error(color('Error: --workspace is required', C.red)); process.exit(1); }

  let workspace: Workspace, wsDir: string;
  try { ({ workspace, dir: wsDir } = await loadWorkspace(wsPath)); }
  catch { console.error(color(`Error: could not read workspace: ${wsPath}`, C.red)); process.exit(1); }

  await loadGlobals(wsDir);
  setSecretsConfig(workspace.settings?.secrets);

  const plans = workspace.perfPlans ?? [];

  if (sub === 'list') {
    if (plans.length === 0) { console.log(color('  No performance plans in this workspace.', C.gray)); process.exit(0); }
    console.log('');
    for (const pl of plans) {
      const load = deriveLoad(pl);
      const tgt = pl.target.kind === 'request' ? 'request' : pl.target.kind === 'sequence' ? 'sequence' : 'flow';
      console.log(`  ${color(pl.name, C.bold, C.white)}  ${color(`(${tgt}, ${pl.pattern}, ~${load.totalSec}s)`, C.gray)}`);
    }
    console.log('');
    process.exit(0);
  }

  if (!name) { console.error(color('Error: a plan name is required: api-spector perf run <plan>', C.red)); process.exit(1); }
  const basePlan = plans.find(pl => pl.name.toLowerCase() === name.toLowerCase());
  if (!basePlan) { console.error(color(`Error: plan "${name}" not found. Run \`api-spector perf list\` to see plans.`, C.red)); process.exit(1); }

  const plan = applyOverrides(basePlan, args);

  const collections = await loadCollections(workspace, wsDir, { onError: relPath => console.error(color(`  [warn] Could not load collection: ${relPath}`, C.yellow)) });
  const environments = await loadEnvironments(workspace, wsDir);
  const env = selectEnvironment(workspace, environments, (args.environment ?? args.env) as string | undefined);
  const flowsAll = (await loadFlows(workspace, wsDir, () => {})).map(normalizeFlow);
  const globals = getGlobals();

  // Resolve the plan's target into a run payload.
  const payload: PerfRunPayload = { plan, environment: env ?? null, globals, proxy: workspace.settings?.proxy, tls: workspace.settings?.tls };
  let targetLabel = '';
  if (plan.target.kind === 'request') {
    let found: ApiRequest | undefined; let foundCol: Collection | undefined;
    for (const c of collections) { const r = c.requests[plan.target.requestId]; if (r) { found = r; foundCol = c; break; } }
    if (!found) { console.error(color('Error: the plan\'s request was not found in this workspace.', C.red)); process.exit(1); }
    const envVars = await buildEnvVars(env);
    payload.request = found;
    payload.vars = { ...globals, ...(foundCol?.collectionVariables ?? {}), ...envVars };
    targetLabel = `${found.method} ${found.name}`;
  } else if (plan.target.kind === 'sequence') {
    const seqCol = collections.find(c => c.id === (plan.target as { collectionId: string }).collectionId);
    if (!seqCol) { console.error(color('Error: the plan\'s collection was not found in this workspace.', C.red)); process.exit(1); }
    payload.collection = seqCol;
    targetLabel = `sequence: ${seqCol.name}${plan.target.folderId ? ' / folder' : ''}`;
  } else {
    const flow = flowsAll.find(f => f.id === (plan.target as { flowId: string }).flowId);
    if (!flow) { console.error(color('Error: the plan\'s flow was not found in this workspace.', C.red)); process.exit(1); }
    payload.flow = flow; payload.flows = flowsAll; payload.collections = collections;
    targetLabel = `flow: ${flow.name}`;
  }

  const load = deriveLoad(plan);
  const version = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? `v${__APP_VERSION__}` : '';
  console.log('');
  console.log(color('  API Performance' + (version ? ` ${version}` : ''), C.bold, C.white));
  console.log(color(`  Plan:        ${plan.name}`, C.gray));
  console.log(color(`  Target:      ${targetLabel}`, C.gray));
  console.log(color(`  Pattern:     ${plan.pattern} (${load.executor}, ~${load.totalSec}s)`, C.gray));
  console.log(color(`  Environment: ${env?.name ?? '(none)'}`, C.gray));
  if (plan.thresholds.length) console.log(color(`  Thresholds:  ${plan.thresholds.map(t => `${t.metric} ${t.op} ${t.value}`).join(', ')}`, C.gray));
  console.log('');

  const quiet = Boolean(args.quiet);
  let lastPrint = 0;
  const result = await runPerfPlan(payload, (p) => {
    if (quiet) return;
    const now = Date.now();
    if (now - lastPrint < 1000) return;
    lastPrint = now;
    process.stdout.write(`\r  ${color('running', C.cyan)} ${Math.round(p.elapsedMs / 1000)}s  iters ${p.iterations}  active ${p.activeVus}  ${p.iterationsPerSec.toFixed(1)}/s  p95 ${fmtMs(p.p95)}  failed ${p.iterationsFailed}   `);
  }).catch(err => { console.error('\n' + color(`Error: ${err instanceof Error ? err.message : String(err)}`, C.red)); process.exit(1); });

  if (!quiet) process.stdout.write('\n\n');

  const errorRate = result.iterations > 0 ? (result.iterationsFailed / result.iterations) * 100 : 0;
  console.log(color('  Results', C.bold, C.white));
  console.log(`    Throughput    ${color(result.iterationsPerSec.toFixed(1) + ' iter/s', C.cyan)}  (${result.requestsPerSec.toFixed(1)} req/s)`);
  console.log(`    Iteration p95 ${fmtMs(result.iterationLatency.p95)}   p99 ${fmtMs(result.iterationLatency.p99)}`);
  console.log(`    Error rate    ${errorRate.toFixed(1)}%  (${result.iterationsFailed}/${result.iterations})`);
  console.log(`    Peak users    ${result.peakVus}${result.droppedArrivals ? `   dropped ${result.droppedArrivals}` : ''}`);
  console.log(`    Duration      ${fmtMs(result.durationMs)}`);
  console.log('');
  console.log(color('  Steps', C.bold, C.white));
  for (const [i, s] of result.steps.entries()) {
    const label = result.mode === 'request' ? s.name : `${i + 1}. ${s.name}`;
    console.log(`    ${label.padEnd(36).slice(0, 36)}  p95 ${fmtMs(s.latency.p95).padStart(8)}  ${color(s.failed ? `${s.failed} failed` : 'ok', s.failed ? C.red : C.green)}`);
  }
  console.log('');

  if (result.thresholds.length) {
    console.log(color('  Thresholds', C.bold, C.white));
    for (const t of result.thresholds) {
      const actual = t.metric === 'error_rate' ? `${t.actual.toFixed(1)}%` : t.metric === 'throughput' ? t.actual.toFixed(1) : fmtMs(t.actual);
      console.log(`    ${t.passed ? color('✓', C.green) : color('✗', C.red)} ${t.metric} ${t.op} ${t.value}  (actual ${actual})`);
    }
    console.log('');
    console.log(result.passed ? color('  PASSED', C.green, C.bold) : color('  FAILED', C.red, C.bold));
    console.log('');
  }

  const out = args.out as string | undefined;
  if (out) {
    const content = extname(out).toLowerCase() === '.json'
      ? JSON.stringify(result, null, 2)
      : perfReportToHtml(result, { planName: plan.name, target: targetLabel, generatedAt: new Date().toISOString() });
    await writeFile(out, content, 'utf8');
    console.log(color(`  Report written to ${out}`, C.gray));
    console.log('');
  }
  if (args.json) console.log(JSON.stringify(result, null, 2));

  process.exit(result.passed ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
