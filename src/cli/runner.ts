#!/usr/bin/env node
// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

/**
 * API Tester CLI Runner
 *
 * Usage:
 *   api-spector run --workspace ./my-workspace.spector [options]
 *
 * Options:
 *   --workspace  <path>      Path to workspace.json (required)
 *   --environment <name>     Environment name to activate (also accepted: --env)
 *   --tags       <a,b>       Comma-separated tag filter
 *   --collection <name>      Limit to a specific collection by name (optional)
 *   --output     <path>      Write results to a file (e.g. results.json or results.xml)
 *   --format     json|junit  Output format (default: json; inferred from --output extension)
 *   --verbose                Print per-request console output and test details
 *   --bail                   Stop after first failure
 *   --help                   Show this message
 */

import { readFile, writeFile, stat, readdir } from 'fs/promises';
import { join, dirname, resolve, extname } from 'path';
import { fetch, Headers } from 'undici';

// Replaced at build time by electron-vite (`define` in main config).
declare const __APP_VERSION__: string;
import type {
  Workspace, Collection, Environment, ApiRequest,
  RunRequestResult, RunSummary, TlsSettings,
} from '../shared/types';
import { buildEnvVars, buildUrl, mergeVars, interpolate, buildDynamicVars } from '../main/interpolation';
import { runScript } from '../main/script-runner';
import { loadGlobals, getGlobals, patchGlobals, persistGlobals } from '../main/globals-store';
import { getSecret } from '../main/ipc/secret-handler';
import { buildDispatcher, buildProtocolFaultTests, maskHeaders, maskPii } from '../main/ipc/request-handler';
import { buildJsonReport, buildJUnitReport, buildHtmlReport } from '../shared/report';
import { buildRunPlan, resolveInheritedAuthAndHeaders } from '../shared/request-collection';

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

async function resolveWorkspacePath(wsPath: string): Promise<string> {
  const s = await stat(wsPath);
  if (!s.isDirectory()) return wsPath;
  const entries = await readdir(wsPath);
  const spector = entries.find(e => e.endsWith('.spector'));
  if (!spector) throw new Error(`No .spector workspace file found in directory: ${wsPath}`);
  return join(wsPath, spector);
}

async function loadWorkspace(wsPath: string): Promise<{ workspace: Workspace; dir: string }> {
  const resolved = await resolveWorkspacePath(wsPath);
  const raw = await readFile(resolved, 'utf8');
  return { workspace: JSON.parse(raw), dir: dirname(resolve(resolved)) };
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

interface ExecuteRequestResult {
  result:               RunRequestResult;
  updatedEnvVars:       Record<string, string>;
  updatedCollectionVars: Record<string, string>;
  updatedGlobals:       Record<string, string>;
  updatedLocalVars:     Record<string, string>;
}

async function executeRequest(
  req: ApiRequest,
  collectionVars: Record<string, string>,
  envVars: Record<string, string>,
  globals: Record<string, string>,
  localVars: Record<string, string>,
  verbose: boolean,
  tls?: TlsSettings,
  piiMaskPatterns: string[] = [],
): Promise<ExecuteRequestResult> {
  // Defensive defaults — AI-generated collections may omit empty arrays
  if (!req.headers) req.headers = [];
  if (!req.params) req.params = [];
  if (!req.body) req.body = { mode: 'none' };
  if (!req.auth) req.auth = { type: 'none' };

  const base: RunRequestResult = {
    requestId:   req.id,
    name:        req.name,
    method:      req.method,
    resolvedUrl: req.url,
    status:      'running',
  };

  let updatedEnvVars        = { ...envVars };
  let updatedCollectionVars = { ...collectionVars };
  let updatedGlobals        = { ...globals };
  let preScriptError: string | undefined;

  // Build preliminary vars so {{}} tokens in scripts get interpolated
  const dynamicVars = await buildDynamicVars();
  let vars = mergeVars(envVars, collectionVars, globals, localVars, dynamicVars);

  if (req.preRequestScript?.trim()) {
    const r = await runScript(interpolate(req.preRequestScript, vars), {
      envVars: { ...envVars }, collectionVars: { ...collectionVars },
      globals: { ...globals }, localVars: { ...localVars },
      piiMaskPatterns,
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

  // Re-merge vars after pre-script may have modified scopes
  vars = mergeVars(updatedEnvVars, updatedCollectionVars, updatedGlobals, localVars, dynamicVars);
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
    } else if (req.body.mode === 'soap' && req.body.soap) {
      // Send the SOAP envelope and the SOAPAction header. Without this
      // branch SOAP requests went out with an empty body and the server
      // replied `Root element is missing`.
      body = interpolate(req.body.soap.envelope, vars);
      if (!headers.has('content-type')) headers.set('Content-Type', 'text/xml; charset=utf-8');
      if (req.body.soap.soapAction && !headers.has('soapaction')) {
        headers.set('SOAPAction', req.body.soap.soapAction);
      }
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

    // Protocol-level fault check — auto-pass/fail for SOAP / GraphQL so they
    // stop landing in 'skipped' just because no hand-written assertion was
    // added. Empty for REST, preserving the "add assertions" nudge there.
    const protocolFaultTests = buildProtocolFaultTests(req.body.mode, responseBody);

    let testResults: RunRequestResult['testResults'] = [...protocolFaultTests];
    let consoleOutput: string[] = [];
    let postScriptError: string | undefined;

    if (req.postRequestScript?.trim()) {
      const r = await runScript(interpolate(req.postRequestScript, vars), {
        envVars: updatedEnvVars, collectionVars: updatedCollectionVars,
        globals: updatedGlobals, localVars, response,
        piiMaskPatterns,
      });
      testResults           = [...protocolFaultTests, ...r.testResults];
      consoleOutput         = r.consoleOutput;
      postScriptError       = r.error;
      updatedEnvVars        = r.updatedEnvVars;
      updatedCollectionVars = r.updatedCollectionVars;
      updatedGlobals        = r.updatedGlobals;
      localVars             = r.updatedLocalVars;
      patchGlobals(r.updatedGlobals);
      await persistGlobals();
      if (verbose && r.consoleOutput.length) r.consoleOutput.forEach(l => console.log(color(`    [post] ${l}`, C.gray)));
    }

    // Status determination:
    //   1. post-script crashed → 'error'
    //   2. has tests, any failed → 'failed'
    //   3. has tests, all passed → 'passed' (even on HTTP 4xx — user expects it)
    //   4. no tests + HTTP 4xx/5xx → 'failed'
    //   5. no tests + HTTP 2xx/3xx → 'passed' (a 2xx is success on its own;
    //      SOAP Fault / GraphQL `errors` are already failing tests from
    //      buildProtocolFaultTests, so they won't slip through here)
    const allPassed  = testResults.every(t => t.passed);
    const httpFailed = fetchResp.status >= 400;
    const hasTests   = testResults.length > 0;
    const status: RunRequestResult['status'] = postScriptError
      ? 'error'
      : hasTests
        ? (allPassed ? 'passed' : 'failed')
        : httpFailed
          ? 'failed'
          : 'passed';

    // If HTTP failed and user has NO tests, add synthetic failure.
    if (httpFailed && testResults.length === 0) {
      testResults = [
        ...testResults,
        {
          name:   `HTTP status ${fetchResp.status} ${fetchResp.statusText}`.trim(),
          passed: false,
          error:  `Request returned ${fetchResp.status} — no assertion was defined to verify the status code.`,
        },
      ];
    }

    const reqHeaders: Record<string, string> = {};
    headers.forEach((v, k) => { reqHeaders[k] = v; });

    return {
      result: {
        ...base,
        status,
        httpStatus: fetchResp.status,
        durationMs,
        testResults,
        consoleOutput,
        preScriptError,
        postScriptError,
        sentRequest:      { headers: reqHeaders, body },
        receivedResponse: response,
      },
      updatedEnvVars,
      updatedCollectionVars,
      updatedGlobals,
      updatedLocalVars: localVars,
    };
  } catch (err) {
    return {
      result: {
        ...base,
        status:     'error',
        durationMs: Date.now() - start,
        error:      err instanceof Error ? err.message : String(err),
        preScriptError,
      },
      updatedEnvVars,
      updatedCollectionVars,
      updatedGlobals,
      updatedLocalVars: localVars,
    };
  }
}

// ─── Result printing ──────────────────────────────────────────────────────────

function printResult(r: RunRequestResult, verbose: boolean) {
  const icon  = r.status === 'passed'  ? color('✓', C.green, C.bold)
              : r.status === 'failed'  ? color('✗', C.red, C.bold)
              : r.status === 'skipped' ? color('○', C.gray, C.bold)
              : color('⚠', C.yellow, C.bold);

  const http = r.httpStatus ? color(` ${r.httpStatus}`, r.httpStatus < 400 ? C.green : C.red) : '';
  const dur  = r.durationMs !== undefined ? color(` ${r.durationMs}ms`, C.gray) : '';
  const method = color(r.method.padEnd(7), C.cyan);
  const hookTag = r.isHook && r.hookType
    ? color(` [${r.hookType.toUpperCase()}]`, C.yellow)
    : '';

  console.log(`  ${icon}  ${method}  ${r.name}${hookTag}${http}${dur}`);
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
      '\nUsage:\n  api-spector run --workspace <path> [--environment <name>] [--tags <a,b>]\n' +
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
  const envName      = (args.environment ?? args.env) as string | undefined;
  const colName      = args.collection as string | undefined;
  const verbose      = Boolean(args.verbose);
  const bail         = Boolean(args.bail);
  const outputPath   = args.output  as string | undefined;

  // Infer format from file extension if --format not given
  const inferredFormat = outputPath
    ? extname(outputPath).toLowerCase() === '.xml'  ? 'junit'
    : extname(outputPath).toLowerCase() === '.html' ? 'html'
    : 'json'
    : 'json';
  const explicitFormat = (args.format as string | undefined)?.toLowerCase();
  const outputFormat   = (explicitFormat === 'junit' || explicitFormat === 'html') ? explicitFormat : inferredFormat;

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

  // Print header — include the package version (injected by electron-vite's
  // `define`) so CI logs show exactly which API Spector ran the suite.
  const version = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? `v${__APP_VERSION__}` : '';
  console.log('');
  console.log(color('  API Test Runner' + (version ? ` ${version}` : ''), C.bold, C.white));
  console.log(color(`  Workspace:   ${wsPath}`, C.gray));
  console.log(color(`  Environment: ${env?.name ?? '(none)'}`, C.gray));
  if (filterTags.length) console.log(color(`  Tags:        ${filterTags.join(', ')}`, C.gray));
  console.log('');

  // Collect resolved secret values so we can redact them from reports
  const envVarsSnapshot    = await buildEnvVars(env);
  const secretValuesToMask = (env?.variables ?? [])
    .filter(v => v.secret && v.enabled)
    .map(v => envVarsSnapshot[v.key])
    .filter((v): v is string => typeof v === 'string' && v.length > 0);

  function redact(s: string): string {
    let out = s;
    for (const secret of secretValuesToMask) out = out.split(secret).join('***');
    return out;
  }

  // Pattern-based PII redaction — applied to *both* sent and received traffic
  // so reports never leak credentials. Defaults mirror the UI's
  // WorkspaceSettingsModal so CLI runs of an unconfigured workspace still
  // get sane masking. `maskHeaders` always redacts authorization/cookie even
  // with an empty list, but we keep the explicit defaults for body fields.
  const DEFAULT_PII_PATTERNS = ['authorization', 'password', 'token', 'secret', 'api-key', 'x-api-key'];
  const piiPatterns = workspace.settings?.piiMaskPatterns ?? DEFAULT_PII_PATTERNS;

  function maskResult(r: RunRequestResult): RunRequestResult {
    return {
      ...r,
      sentRequest: r.sentRequest ? {
        headers: Object.fromEntries(
          Object.entries(maskHeaders(r.sentRequest.headers, piiPatterns))
            .map(([k, v]) => [k, redact(v)]),
        ),
        body: r.sentRequest.body != null ? redact(maskPii(r.sentRequest.body, piiPatterns)) : undefined,
      } : undefined,
      receivedResponse: r.receivedResponse ? {
        ...r.receivedResponse,
        headers: maskHeaders(r.receivedResponse.headers, piiPatterns),
        body:    redact(maskPii(r.receivedResponse.body, piiPatterns)),
      } : undefined,
    };
  }

  const summary: RunSummary = { total: 0, passed: 0, failed: 0, errors: 0, skipped: 0, durationMs: 0 };
  const allResults: RunRequestResult[] = [];
  const totalStart = Date.now();
  const timestamp = new Date().toISOString();
  let firstColName: string | undefined;

  for (const col of collections) {
    if (colName && col.name.toLowerCase() !== colName.toLowerCase()) continue;

    // Use the same plan builder the in-app runner uses, so before/beforeAll
    // hooks (e.g. a "fetch token" request) actually execute and propagate
    // their extracted variables to subsequent requests. `collectTagged`
    // silently dropped hooks, which is why CLI runs of an authed request
    // came back 401 even though the UI runner worked.
    const items = buildRunPlan(col, null, filterTags);
    if (items.length === 0) continue;

    if (!firstColName) firstColName = col.name;

    let runEnvVars        = await buildEnvVars(env);
    let runGlobals        = getGlobals();
    let runCollectionVars: Record<string, string> = { ...col.collectionVariables ?? {} };
    let runLocalVars:     Record<string, string> = {};

    console.log(color(`  ┌ ${col.name}`, C.bold, C.white));

    const workspaceTls = workspace.settings?.tls;
    const effectiveTls = col.tls
      ? { ...workspaceTls, ...col.tls }
      : workspaceTls;

    // Merge inherited auth/headers from collection/folder into each request
    for (const item of items) {
      const req = item.request;
      const inherited = resolveInheritedAuthAndHeaders(req.id, col);
      if (req.auth.type === 'none' && inherited.auth && inherited.auth.type !== 'none') {
        req.auth = inherited.auth;
      }
      const inheritedHeaders = inherited.headers.filter(h => h.enabled && h.key);
      if (inheritedHeaders.length) {
        req.headers = [...inheritedHeaders, ...req.headers];
      }
    }

    let bailed = false;
    let lastPrintedScope: string | null = null;
    // Mirrors runner-handler.ts: a beforeAll failure poisons its scope, a
    // before failure poisons its single main request. Subsequent items in
    // those scopes / for that request are reported as skipped without
    // executing.
    const failedScopes = new Set<string>();
    const skipRequests = new Set<string>();

    for (const item of items) {
      const { isHook, hookType, scopeId, scopeAncestors, mainRequestId } = item;

      let skipReason: string | undefined;
      if (isHook) {
        if (hookType === 'beforeAll') {
          if ((scopeAncestors ?? []).some(id => failedScopes.has(id))) {
            skipReason = 'Skipped — outer scope hook failed';
          }
        } else if (hookType === 'before') {
          const allScopes = [...(scopeAncestors ?? []), scopeId].filter(Boolean) as string[];
          if (allScopes.some(id => failedScopes.has(id))) {
            skipReason = 'Skipped — scope hook failed';
          } else if (mainRequestId && skipRequests.has(mainRequestId)) {
            skipReason = 'Skipped — before hook failed';
          }
        }
        // after / afterAll: never skip
      } else {
        const allScopes = [...(scopeAncestors ?? []), scopeId].filter(Boolean) as string[];
        if (allScopes.some(id => failedScopes.has(id))) {
          skipReason = 'Skipped — beforeAll hook failed';
        } else if (skipRequests.has(item.request.id)) {
          skipReason = 'Skipped — before hook failed';
        }
      }

      let result: RunRequestResult;
      if (skipReason) {
        result = {
          requestId:  item.request.id,
          name:       item.request.name,
          method:     item.request.method,
          resolvedUrl: item.request.url,
          status:     'failed',
          error:      skipReason,
          isHook,
          hookType,
          scopeId,
          scopePath:  item.scopePath,
        };
      } else {
        const out = await executeRequest(
          item.request,
          { ...item.collectionVars, ...runCollectionVars },
          runEnvVars,
          runGlobals,
          { ...runLocalVars },
          verbose,
          effectiveTls,
          piiPatterns,
        );
        result            = out.result;
        runEnvVars        = out.updatedEnvVars;
        runCollectionVars = out.updatedCollectionVars;
        runGlobals        = out.updatedGlobals;
        runLocalVars      = out.updatedLocalVars;

        result.isHook    = isHook;
        result.hookType  = hookType;
        result.scopeId   = scopeId;
        result.scopePath = item.scopePath;

        if (result.status === 'failed' || result.status === 'error') {
          if (isHook && hookType === 'beforeAll' && scopeId) {
            failedScopes.add(scopeId);
          } else if (isHook && hookType === 'before' && mainRequestId) {
            skipRequests.add(mainRequestId);
          }
        }
      }

      // Print a folder heading whenever the scope changes
      const scopeKey = (item.scopePath ?? []).join(' / ');
      if (scopeKey !== lastPrintedScope) {
        if (scopeKey) console.log(color(`    ${scopeKey}`, C.gray, C.bold));
        lastPrintedScope = scopeKey;
      }

      printResult(result, verbose);
      allResults.push(result);

      summary.total++;
      if (result.status === 'passed')       summary.passed++;
      else if (result.status === 'failed')  summary.failed++;
      else if (result.status === 'skipped') summary.skipped++;
      else                                   summary.errors++;

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
  const failStr  = summary.failed > 0   ? color(` · ${summary.failed} failed`, C.red, C.bold) : '';
  const errStr   = summary.errors > 0   ? color(` · ${summary.errors} errors`, C.yellow, C.bold) : '';
  const skipStr  = summary.skipped > 0  ? color(` · ${summary.skipped} skipped`, C.gray, C.bold) : '';
  const totalStr = color(` · ${summary.total} total · ${summary.durationMs}ms`, C.gray);

  console.log(`  ${passStr}${failStr}${errStr}${skipStr}${totalStr}\n`);

  // Write report file if --output was given
  if (outputPath) {
    const meta = { workspace: wsPath, environment: env?.name ?? null, collection: firstColName, timestamp };
    const maskedResults = allResults.map(maskResult);
    const report = outputFormat === 'junit' ? buildJUnitReport(maskedResults, summary, meta)
                 : outputFormat === 'html'  ? buildHtmlReport(maskedResults, summary, meta)
                 : buildJsonReport(maskedResults, summary, meta);
    await writeFile(resolve(outputPath), report, 'utf8');
    console.log(color(`  Report written: ${outputPath} (${outputFormat})\n`, C.gray));
  }

  process.exit(summary.failed + summary.errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(color(`Fatal: ${err.message}`, C.red));
  process.exit(2);
});
