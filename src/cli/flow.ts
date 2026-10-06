#!/usr/bin/env node
// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

/**
 * API Spector CLI — flows
 *
 * Usage:
 *   api-spector flow list   --workspace <path>
 *   api-spector flow run <name> --workspace <path> [options]
 *
 * Options:
 *   --workspace   <path>   Path to the workspace (.spector file or its folder) (required)
 *   --environment <name>   Environment to activate (also accepted: --env)
 *   --output      <path>   Write the run report to a file (.json or .xml)
 *   --format      json|junit   Report format (default inferred from --output, else json)
 *   --verbose              Print script console output and per-test detail
 *   --help                 Show this message
 *
 * Exit code is non-zero when any block failed or errored.
 */

import { writeFile } from 'node:fs/promises';
import { extname } from 'node:path';

// Replaced at build time by electron-vite (`define` in main config).
declare const __APP_VERSION__: string;

import type { Workspace, ApiRequest, Collection } from '../shared/types';
import { buildEnvVars, interpolate } from '../main/interpolation';
import { setSecretsConfig } from '../main/secrets';
import { loadGlobals, getGlobals } from '../main/globals-store';
import { buildDispatcher, executeRunnerRequest } from '../main/request-exec';
import { runScript, evaluateExpression } from '../main/script-runner';
import { resolveInheritedAuthAndHeaders, authIsConfigured } from '../shared/request-collection';
import { selectEnvironment } from '../shared/environments';
import { runFlow, type FlowEngineDeps, type FlowRunEvent, type FlowRunSummary } from '../shared/flow-engine';
import { buildFlowHtmlReport } from '../shared/flow-report';
import { normalizeFlow, BLOCK_SPECS } from '../shared/flow-blocks';
import {
  C, color, parseArgs,
  loadWorkspace, loadCollections, loadEnvironments, loadFlows,
} from './cli-common';

// ─── Report (our own shape; a flow isn't a flat request list) ───────────────

function buildJunit(flowName: string, summary: FlowRunSummary): string {
  const cases = summary.blocks
    .filter(b => b.type === 'request' || b.type === 'validate')
    .map(b => {
      const name = `${b.label}${b.resolvedUrl ? ` ${b.resolvedUrl}` : ''}`;
      const inner = b.status === 'failed' || b.status === 'error'
        ? `\n      <failure message="${escapeXml(b.error ?? 'assertion failed')}"/>\n    `
        : '';
      return `    <testcase name="${escapeXml(name)}" classname="${escapeXml(flowName)}" time="${((b.durationMs ?? 0) / 1000).toFixed(3)}">${inner}</testcase>`;
    })
    .join('\n');
  const failures = summary.failed;
  const errors = summary.errors;
  const tests = summary.blocks.filter(b => b.type === 'request' || b.type === 'validate').length;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="${escapeXml(flowName)}" tests="${tests}" failures="${failures}" errors="${errors}" time="${(summary.durationMs / 1000).toFixed(3)}">\n${cases}\n  </testsuite>\n</testsuites>\n`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const positionals: string[] = [];
  for (const a of argv) { if (a.startsWith('--')) break; positionals.push(a); }
  const sub = positionals[0];
  const name = positionals[1];
  const args = parseArgs(argv);

  if (args.help || !sub || (sub !== 'run' && sub !== 'list')) {
    console.log(
      '\nUsage:\n' +
      '  api-spector flow list --workspace <path>\n' +
      '  api-spector flow run <name> --workspace <path> [--environment <name>]\n' +
      '                               [--output <path>] [--format json|junit] [--verbose]\n',
    );
    process.exit(args.help ? 0 : 1);
  }

  const wsPath = args.workspace as string;
  if (!wsPath) {
    console.error(color('Error: --workspace is required', C.red));
    process.exit(1);
  }

  let workspace: Workspace, wsDir: string;
  try {
    ;({ workspace, dir: wsDir } = await loadWorkspace(wsPath));
  } catch {
    console.error(color(`Error: could not read workspace: ${wsPath}`, C.red));
    process.exit(1);
  }

  await loadGlobals(wsDir);
  setSecretsConfig(workspace.settings?.secrets);

  const flows = (await loadFlows(workspace, wsDir, relPath =>
    console.error(color(`  [warn] Could not load flow: ${relPath}`, C.yellow)),
  )).map(normalizeFlow);

  // ── flow list ──
  if (sub === 'list') {
    if (flows.length === 0) { console.log(color('  No flows in this workspace.', C.gray)); process.exit(0); }
    console.log('');
    for (const f of flows) {
      const steps = f.nodes.filter(n => n.type !== 'start' && n.type !== 'end').length;
      console.log(`  ${color(f.name, C.bold, C.white)}  ${color(`(${steps} blocks)`, C.gray)}`);
    }
    console.log('');
    process.exit(0);
  }

  // ── flow run <name> ──
  if (!name) { console.error(color('Error: a flow name is required: api-spector flow run <name>', C.red)); process.exit(1); }
  const flow = flows.find(f => f.name.toLowerCase() === name.toLowerCase());
  if (!flow) {
    console.error(color(`Error: flow "${name}" not found. Run \`api-spector flow list\` to see available flows.`, C.red));
    process.exit(1);
  }

  const collections = await loadCollections(workspace, wsDir, {
    onError: relPath => console.error(color(`  [warn] Could not load collection: ${relPath}`, C.yellow)),
  });
  const environments = await loadEnvironments(workspace, wsDir);
  const envName = (args.environment ?? args.env) as string | undefined;
  const env = selectEnvironment(workspace, environments, envName);
  const verbose = Boolean(args.verbose);

  const version = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? `v${__APP_VERSION__}` : '';
  console.log('');
  console.log(color('  API Flow Runner' + (version ? ` ${version}` : ''), C.bold, C.white));
  console.log(color(`  Flow:        ${flow.name}`, C.gray));
  console.log(color(`  Workspace:   ${wsPath}`, C.gray));
  console.log(color(`  Environment: ${env?.name ?? '(none)'}`, C.gray));
  console.log('');

  const envVars = await buildEnvVars(env);
  const globals = getGlobals();
  const dispatcher = await buildDispatcher(workspace.settings?.proxy, workspace.settings?.tls);
  const piiMaskPatterns = workspace.settings?.piiMaskPatterns ?? [];
  const colById = new Map<string, Collection>(collections.map(c => [c.id, c]));

  const printEvent = (evt: FlowRunEvent) => {
    const spec = BLOCK_SPECS[evt.blockType];
    if (evt.kind === 'log') {
      console.log(color(`  · ${evt.message}`, C.cyan));
      return;
    }
    if (evt.kind === 'display') {
      const v = evt.display?.value;
      console.log(color(`  ▣ ${evt.display?.label ?? 'display'}:`, C.magenta), typeof v === 'string' ? v : JSON.stringify(v, null, 2));
      return;
    }
    if (evt.kind !== 'block-result') return;
    const icon = evt.status === 'passed' ? color('✓', C.green, C.bold)
      : evt.status === 'failed' ? color('✗', C.red, C.bold)
      : evt.status === 'error' ? color('⚠', C.yellow, C.bold)
      : color('•', C.gray);
    const http = evt.httpStatus ? color(` ${evt.httpStatus}`, evt.httpStatus < 400 ? C.green : C.red) : '';
    const dur = evt.durationMs !== undefined ? color(` ${evt.durationMs}ms`, C.gray) : '';
    const iter = evt.iteration !== undefined ? color(` [#${evt.iteration}]`, C.gray) : '';
    console.log(`  ${icon}  ${color((spec?.label ?? evt.blockType).padEnd(12), C.cyan)}${iter}${http}${dur}`);
    if (verbose && evt.testResults?.length) {
      for (const t of evt.testResults) {
        console.log(`     ${t.passed ? color('✓', C.green) : color('✗', C.red)} ${t.name}${t.error ? color(` - ${t.error}`, C.red) : ''}`);
      }
    }
    if (evt.error) console.log(color(`     Error: ${evt.error}`, C.red));
  };

  const deps: FlowEngineDeps = {
    runRequest: async (ref, input) => {
      const col = colById.get(ref.collectionId);
      const original = col?.requests[ref.requestId];
      if (!col || !original) return null;
      const req = JSON.parse(JSON.stringify(original)) as ApiRequest;
      const inherited = resolveInheritedAuthAndHeaders(original.id, col);
      if (!authIsConfigured(req.auth) && inherited.auth && inherited.auth.type !== 'none') req.auth = inherited.auth;
      const inheritedHeaders = inherited.headers.filter(h => h.enabled && h.key);
      if (inheritedHeaders.length) req.headers = [...inheritedHeaders, ...(req.headers ?? [])];
      const { result, updatedEnvVars, updatedCollectionVars, updatedGlobals, updatedLocalVars } =
        await executeRunnerRequest({
          req,
          collectionVars: { ...(col.collectionVariables ?? {}), ...input.collectionVars },
          envVars: input.envVars, globals: input.globals, localVars: input.localVars,
          // Flows chain on the real response body (not the PII-masked report copy).
          dispatcher, piiMaskPatterns: [], proxy: workspace.settings?.proxy, tls: workspace.settings?.tls,
        });
      const rr = result.receivedResponse;
      const response = rr
        ? { status: rr.status, statusText: rr.statusText, headers: rr.headers, body: rr.body, bodySize: rr.body?.length ?? 0, durationMs: result.durationMs ?? 0 }
        : null;
      return {
        envVars: updatedEnvVars, collectionVars: updatedCollectionVars, globals: updatedGlobals, localVars: updatedLocalVars,
        response, status: result.status, httpStatus: result.httpStatus, durationMs: result.durationMs,
        error: result.error, testResults: result.testResults, name: result.name, method: result.method, resolvedUrl: result.resolvedUrl,
      };
    },
    runScript: async (code, input) => {
      const out = await runScript(code, { envVars: input.envVars, collectionVars: input.collectionVars, globals: input.globals, localVars: input.localVars, response: input.response ?? undefined, piiMaskPatterns, data: input.data });
      if (verbose && out.consoleOutput?.length) for (const line of out.consoleOutput) console.log(color(`     ${line}`, C.gray));
      return { envVars: out.updatedEnvVars, collectionVars: out.updatedCollectionVars, globals: out.updatedGlobals, localVars: out.updatedLocalVars, testResults: out.testResults, consoleOutput: out.consoleOutput, error: out.error };
    },
    evalExpression: async (code, input) => {
      const out = await evaluateExpression(code, { envVars: input.envVars, collectionVars: input.collectionVars, globals: input.globals, localVars: input.localVars, response: input.response ?? undefined, piiMaskPatterns, data: input.data });
      return { envVars: out.updatedEnvVars, collectionVars: out.updatedCollectionVars, globals: out.updatedGlobals, localVars: out.updatedLocalVars, value: out.value, consoleOutput: out.consoleOutput, error: out.error };
    },
    resolveFlow: (flowId) => flows.find(f => f.id === flowId) ?? null,
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    interpolate: (str, vars) => interpolate(str, vars),
    onEvent: printEvent,
  };

  let summary: FlowRunSummary;
  try {
    summary = await runFlow(flow, deps, { envVars, globals });
  } catch (err) {
    console.error(color(`\n  Flow aborted: ${err instanceof Error ? err.message : String(err)}`, C.red));
    process.exit(1);
  }

  console.log('');
  console.log(
    `  ${color(`${summary.passed} passed`, C.green)}` +
    (summary.failed ? `  ${color(`${summary.failed} failed`, C.red)}` : '') +
    (summary.errors ? `  ${color(`${summary.errors} errors`, C.yellow)}` : '') +
    color(`  ${summary.total} blocks · ${summary.durationMs}ms`, C.gray),
  );
  console.log('');

  if (verbose && summary.variables) {
    const v = summary.variables;
    const rows = [
      ...Object.entries(v.localVars).map(([k, val]) => [k, val, 'local']),
      ...Object.entries(v.collectionVars).map(([k, val]) => [k, val, 'collection']),
      ...Object.entries(v.globals).map(([k, val]) => [k, val, 'global']),
    ];
    if (rows.length) {
      console.log(color('  Variables:', C.bold));
      for (const [k, val, scope] of rows) {
        console.log(`    ${color(k, C.cyan)} ${color(`(${scope})`, C.gray)} = ${val.length > 80 ? val.slice(0, 80) + '…' : val}`);
      }
      console.log('');
    }
  }

  const outputPath = args.output as string | undefined;
  if (outputPath) {
    const explicit = (args.format as string | undefined)?.toLowerCase();
    const ext = extname(outputPath).toLowerCase();
    const fmt = explicit ?? (ext === '.xml' ? 'junit' : ext === '.html' ? 'html' : 'json');
    const content = fmt === 'junit' ? buildJunit(flow.name, summary)
      : fmt === 'html' ? buildFlowHtmlReport(summary, { flow: flow.name, environment: env?.name ?? null })
      : JSON.stringify(summary, null, 2);
    await writeFile(outputPath, content, 'utf8');
    console.log(color(`  Report written to ${outputPath} (${fmt})`, C.gray));
    console.log('');
  }

  process.exit(summary.failed + summary.errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
