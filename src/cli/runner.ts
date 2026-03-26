#!/usr/bin/env node
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

/**
 * API Tester CLI Runner
 *
 * Usage:
 *   api-spector run --workspace ./my-workspace.spector [options]
 *
 * Options:
 *   --workspace  <path>      Path to workspace.json (required)
 *   --env        <name>      Environment name to activate (optional)
 *   --tags       <a,b>       Comma-separated tag filter
 *   --collection <name>      Limit to a specific collection by name (optional)
 *   --output     <path>      Write results to a file (e.g. results.json or results.xml)
 *   --format     json|junit  Output format (default: json; inferred from --output extension)
 *   --verbose                Print per-request console output and test details
 *   --bail                   Stop after first failure
 *   --help                   Show this message
 */

import { readFile, writeFile } from 'fs/promises';
import { join, dirname, resolve, extname } from 'path';
import { fetch, Headers } from 'undici';
import type {
  Workspace, Collection, Environment, ApiRequest,
  RunRequestResult, RunSummary, TlsSettings,
} from '../shared/types';
import { buildEnvVars, buildUrl, mergeVars, interpolate, buildDynamicVars } from '../main/interpolation';
import { runScript } from '../main/script-runner';
import { loadGlobals, getGlobals, patchGlobals, persistGlobals } from '../main/globals-store';
import { getSecret } from '../main/ipc/secret-handler';
import { buildDispatcher } from '../main/ipc/request-handler';
import { buildJsonReport, buildJUnitReport } from '../shared/report';
import { collectTagged } from '../shared/request-collection';

// ─── ANSI colour helpers ──────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  white:  '\x1b[97m',
};

function color(str: string, ...codes: string[]): string {
  return process.stdout.isTTY ? codes.join('') + str + C.reset : str;
}

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

// ─── File loading ─────────────────────────────────────────────────────────────

async function loadWorkspace(wsPath: string): Promise<{ workspace: Workspace; dir: string }> {
  const raw = await readFile(wsPath, 'utf8');
  return { workspace: JSON.parse(raw), dir: dirname(resolve(wsPath)) };
}

async function loadCollections(workspace: Workspace, dir: string): Promise<Collection[]> {
  const cols: Collection[] = [];
  for (const relPath of workspace.collections) {
    try {
      const raw = await readFile(join(dir, relPath), 'utf8');
      cols.push(JSON.parse(raw));
    } catch (_e) {
      console.error(color(`  [warn] Could not load collection: ${relPath}`, C.yellow));
    }
  }
  return cols;
}

async function loadEnvironments(workspace: Workspace, dir: string): Promise<Environment[]> {
  const envs: Environment[] = [];
  for (const relPath of workspace.environments) {
    try {
      const raw = await readFile(join(dir, relPath), 'utf8');
      envs.push(JSON.parse(raw));
    } catch (_e) {
      // ignore missing env files
    }
  }
  return envs;
}

// ─── Execute one request ──────────────────────────────────────────────────────

async function executeRequest(
  req: ApiRequest,
  collectionVars: Record<string, string>,
  envVars: Record<string, string>,
  globals: Record<string, string>,
  verbose: boolean,
  tls?: TlsSettings,
): Promise<RunRequestResult> {
  const base: RunRequestResult = {
    requestId:   req.id,
    name:        req.name,
    method:      req.method,
    resolvedUrl: req.url,
    status:      'running',
  };

  let localVars:            Record<string, string> = {};
  let updatedEnvVars        = { ...envVars };
  let updatedCollectionVars = { ...collectionVars };
  let updatedGlobals        = { ...globals };
  let preScriptError: string | undefined;

  if (req.preRequestScript?.trim()) {
    const r = await runScript(req.preRequestScript, {
      envVars: { ...envVars }, collectionVars: { ...collectionVars },
      globals: { ...globals }, localVars: {},
    });
    preScriptError        = r.error;
    localVars             = r.updatedLocalVars;
    updatedEnvVars        = r.updatedEnvVars;
    updatedCollectionVars = r.updatedCollectionVars;
    updatedGlobals        = r.updatedGlobals;
    patchGlobals(r.updatedGlobals);
    await persistGlobals();
    if (verbose && r.consoleOutput.length) r.consoleOutput.forEach(l => console.log(color(`    [pre] ${l}`, C.gray)));
    if (r.error) console.error(color(`    [pre-script error] ${r.error}`, C.red));
  }

  const dynamicVars = await buildDynamicVars();
  const vars        = mergeVars(updatedEnvVars, updatedCollectionVars, updatedGlobals, localVars, dynamicVars);
  const resolvedUrl = buildUrl(req.url, req.params, vars);
  base.resolvedUrl  = resolvedUrl;

  const start = Date.now();

  try {
    // Auth headers
    const authH: Record<string, string> = {};
    if (req.auth.type === 'bearer') {
      let token = req.auth.token ?? '';
      if (!token && req.auth.tokenSecretRef) token = (await getSecret(req.auth.tokenSecretRef)) ?? '';
      if (token) authH['Authorization'] = `Bearer ${interpolate(token, vars)}`;
    }

    const headers = new Headers();
    for (const h of req.headers) {
      if (h.enabled && h.key) headers.set(interpolate(h.key, vars), interpolate(h.value, vars));
    }
    for (const [k, v] of Object.entries(authH)) headers.set(k, v);

    let body: string | undefined;
    if (req.body.mode === 'json' && req.body.json) {
      body = interpolate(req.body.json, vars);
      if (!headers.has('content-type')) headers.set('Content-Type', 'application/json');
    } else if (req.body.mode === 'raw' && req.body.raw) {
      body = interpolate(req.body.raw, vars);
      if (!headers.has('content-type')) headers.set('Content-Type', req.body.rawContentType ?? 'text/plain');
    } else if (req.body.mode === 'graphql' && req.body.graphql) {
      const gql = req.body.graphql;
      const gqlBody: Record<string, unknown> = { query: interpolate(gql.query, vars) };
      const rawVars = gql.variables?.trim();
      if (rawVars) {
        try { gqlBody.variables = JSON.parse(interpolate(rawVars, vars)); } catch { /* skip */ }
      }
      if (gql.operationName?.trim()) gqlBody.operationName = gql.operationName.trim();
      body = JSON.stringify(gqlBody);
      if (!headers.has('content-type')) headers.set('Content-Type', 'application/json');
    }

    const dispatcher = await buildDispatcher(undefined, tls);
    const fetchResp   = await fetch(resolvedUrl, {
      method:  req.method,
      headers,
      body:    ['GET', 'HEAD'].includes(req.method) ? undefined : body,
      ...(dispatcher ? { dispatcher } : {}),
    } as Parameters<typeof fetch>[1]);
    const responseBody = await fetchResp.text();
    const durationMs   = Date.now() - start;
    const respHeaders: Record<string, string> = {};
    fetchResp.headers.forEach((v, k) => { respHeaders[k] = v; });

    const response = {
      status: fetchResp.status, statusText: fetchResp.statusText,
      headers: respHeaders, body: responseBody,
      bodySize: Buffer.byteLength(responseBody, 'utf8'), durationMs,
    };

    let testResults: RunRequestResult['testResults'] = [];
    let consoleOutput: string[] = [];
    let postScriptError: string | undefined;

    if (req.postRequestScript?.trim()) {
      const r = await runScript(req.postRequestScript, {
        envVars: updatedEnvVars, collectionVars: updatedCollectionVars,
        globals: updatedGlobals, localVars, response,
      });
      testResults      = r.testResults;
      consoleOutput    = r.consoleOutput;
      postScriptError  = r.error;
      patchGlobals(r.updatedGlobals);
      await persistGlobals();
      if (verbose && r.consoleOutput.length) r.consoleOutput.forEach(l => console.log(color(`    [post] ${l}`, C.gray)));
    }

    const allPassed = testResults.every(t => t.passed);
    const status: RunRequestResult['status'] = postScriptError
      ? 'error'
      : testResults.length > 0 ? (allPassed ? 'passed' : 'failed') : 'passed';

    return { ...base, status, httpStatus: fetchResp.status, durationMs, testResults, consoleOutput, preScriptError, postScriptError };
  } catch (err) {
    return {
      ...base,
      status:     'error',
      durationMs: Date.now() - start,
      error:      err instanceof Error ? err.message : String(err),
      preScriptError,
    };
  }
}

// ─── Result printing ──────────────────────────────────────────────────────────

function printResult(r: RunRequestResult, verbose: boolean) {
  const icon  = r.status === 'passed' ? color('✓', C.green, C.bold)
              : r.status === 'failed' ? color('✗', C.red, C.bold)
              : color('⚠', C.yellow, C.bold);

  const http = r.httpStatus ? color(` ${r.httpStatus}`, r.httpStatus < 400 ? C.green : C.red) : '';
  const dur  = r.durationMs !== undefined ? color(` ${r.durationMs}ms`, C.gray) : '';
  const method = color(r.method.padEnd(7), C.cyan);

  console.log(`  ${icon}  ${method}  ${r.name}${http}${dur}`);
  if (verbose) console.log(color(`       ${r.resolvedUrl}`, C.gray));

  if (r.testResults?.length) {
    for (const t of r.testResults) {
      const ti = t.passed ? color('  ✓', C.green) : color('  ✗', C.red);
      console.log(`${ti} ${t.name}${t.error ? color(` — ${t.error}`, C.red) : ''}`);
    }
  }
  if (r.error) console.log(color(`     Error: ${r.error}`, C.red));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(
      '\nUsage:\n  api-spector run --workspace <path> [--env <name>] [--tags <a,b>]\n' +
      '                  [--collection <name>] [--output <path>] [--format json|junit]\n' +
      '                  [--verbose] [--bail]\n'
    );
    process.exit(0);
  }

  const wsPath = args.workspace as string;
  if (!wsPath) {
    console.error(color('Error: --workspace is required', C.red));
    process.exit(1);
  }

  const filterTags   = args.tags    ? (args.tags as string).split(',').map(t => t.trim()).filter(Boolean) : [];
  const envName      = args.env     as string | undefined;
  const colName      = args.collection as string | undefined;
  const verbose      = Boolean(args.verbose);
  const bail         = Boolean(args.bail);
  const outputPath   = args.output  as string | undefined;

  // Infer format from file extension if --format not given
  const inferredFormat = outputPath && extname(outputPath).toLowerCase() === '.xml' ? 'junit' : 'json';
  const outputFormat   = (args.format as string | undefined)?.toLowerCase() === 'junit' ? 'junit' : inferredFormat;

  // Load workspace
  let workspace: Workspace, wsDir: string;
  try {
    ;({ workspace, dir: wsDir } = await loadWorkspace(wsPath));
  } catch {
    console.error(color(`Error: could not read workspace file: ${wsPath}`, C.red));
    process.exit(1);
  }

  await loadGlobals(wsDir);

  const collections  = await loadCollections(workspace, wsDir);
  const environments = await loadEnvironments(workspace, wsDir);

  // Resolve environment
  const env = envName
    ? environments.find(e => e.name.toLowerCase() === envName.toLowerCase()) ?? null
    : null;

  if (envName && !env) {
    console.warn(color(`Warning: environment "${envName}" not found. Running without environment.`, C.yellow));
  }

  // Print header
  console.log('');
  console.log(color('  API Test Runner', C.bold, C.white));
  console.log(color(`  Workspace:   ${wsPath}`, C.gray));
  console.log(color(`  Environment: ${env?.name ?? '(none)'}`, C.gray));
  if (filterTags.length) console.log(color(`  Tags:        ${filterTags.join(', ')}`, C.gray));
  console.log('');

  const summary: RunSummary = { total: 0, passed: 0, failed: 0, errors: 0, durationMs: 0 };
  const allResults: RunRequestResult[] = [];
  const totalStart = Date.now();
  const timestamp = new Date().toISOString();
  let firstColName: string | undefined;

  for (const col of collections) {
    if (colName && col.name.toLowerCase() !== colName.toLowerCase()) continue;

    const items = collectTagged(col.rootFolder, col.requests, col.collectionVariables ?? {}, filterTags);
    if (items.length === 0) continue;

    if (!firstColName) firstColName = col.name;

    const envVars = await buildEnvVars(env);
    const globals = getGlobals();

    console.log(color(`  ┌ ${col.name}`, C.bold, C.white));

    const workspaceTls = workspace.settings?.tls;
    const effectiveTls = col.tls
      ? { ...workspaceTls, ...col.tls }
      : workspaceTls;

    let bailed = false;
    for (const item of items) {
      const result = await executeRequest(item.request, item.collectionVars, envVars, globals, verbose, effectiveTls);
      printResult(result, verbose);
      allResults.push(result);

      summary.total++;
      if (result.status === 'passed')      summary.passed++;
      else if (result.status === 'failed') summary.failed++;
      else                                  summary.errors++;

      if (bail && (result.status === 'failed' || result.status === 'error')) {
        console.log(color('\n  Bailing after first failure.', C.yellow));
        bailed = true;
        break;
      }
    }

    console.log('');
    if (bailed) break;
  }

  summary.durationMs = Date.now() - totalStart;

  // Summary line
  const passStr  = color(`${summary.passed} passed`, C.green, C.bold);
  const failStr  = summary.failed > 0  ? color(` · ${summary.failed} failed`, C.red, C.bold) : '';
  const errStr   = summary.errors > 0  ? color(` · ${summary.errors} errors`, C.yellow, C.bold) : '';
  const totalStr = color(` · ${summary.total} total · ${summary.durationMs}ms`, C.gray);

  console.log(`  ${passStr}${failStr}${errStr}${totalStr}\n`);

  // Write report file if --output was given
  if (outputPath) {
    const meta = { workspace: wsPath, environment: env?.name ?? null, collection: firstColName, timestamp };
    const report = outputFormat === 'junit'
      ? buildJUnitReport(allResults, summary, meta)
      : buildJsonReport(allResults, summary, meta);
    await writeFile(resolve(outputPath), report, 'utf8');
    console.log(color(`  Report written: ${outputPath} (${outputFormat})\n`, C.gray));
  }

  process.exit(summary.failed + summary.errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(color(`Fatal: ${err.message}`, C.red));
  process.exit(2);
});
