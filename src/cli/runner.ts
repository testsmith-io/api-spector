#!/usr/bin/env node
// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

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

import { writeFile } from 'fs/promises';
import { resolve, extname } from 'path';

// Replaced at build time by electron-vite (`define` in main config).
declare const __APP_VERSION__: string;
import type {
  Workspace,
  RunRequestResult, RunSummary,
} from '../shared/types';
import { buildEnvVars } from '../main/interpolation';
import { setSecretsConfig } from '../main/secrets';
import { loadGlobals, getGlobals } from '../main/globals-store';
import {
  buildDispatcher,
  executeRunnerRequest,
  HookSkipTracker,
  maskHeaders,
  maskPii,
} from '../main/request-exec';
import { buildJsonReport, buildJUnitReport, buildHtmlReport } from '../shared/report';
import { buildRunPlan, resolveInheritedAuthAndHeaders, authIsConfigured } from '../shared/request-collection';
import { selectEnvironment } from '../shared/environments';
import {
  C, color, parseArgs,
  loadWorkspace, loadCollections, loadEnvironments,
} from './cli-common';

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
      console.log(`${ti} ${t.name}${t.error ? color(` - ${t.error}`, C.red) : ''}`);
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

  // Apply external secret-manager connection config (Vault, ...) from the
  // workspace. Environment variables override it, so the same workspace runs
  // unchanged locally and in CI.
  setSecretsConfig(workspace.settings?.secrets);

  const collections  = await loadCollections(workspace, wsDir, {
    onError: relPath => console.error(color(`  [warn] Could not load collection: ${relPath}`, C.yellow)),
  });
  const environments = await loadEnvironments(workspace, wsDir);

  // Resolve environment: --environment flag, else the workspace's default
  // environment (settings.defaultEnvironment). Inheritance chains
  // (`extends`) are merged by selectEnvironment.
  const env = selectEnvironment(workspace, environments, envName);

  if (envName && !env) {
    console.warn(color(`Warning: environment "${envName}" not found. Running without environment.`, C.yellow));
  } else if (!envName && workspace.settings?.defaultEnvironment && !env) {
    console.warn(color(`Warning: default environment "${workspace.settings.defaultEnvironment}" not found. Running without environment.`, C.yellow));
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
    .filter(v => (v.secret || v.secretRef) && v.enabled)
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
      if (!authIsConfigured(req.auth) && inherited.auth && inherited.auth.type !== 'none') {
        req.auth = inherited.auth;
      }
      const inheritedHeaders = inherited.headers.filter(h => h.enabled && h.key);
      if (inheritedHeaders.length) {
        req.headers = [...inheritedHeaders, ...req.headers];
      }
    }

    let bailed = false;
    let lastPrintedScope: string | null = null;
    // Same propagation rules as the GUI runner: a beforeAll failure poisons
    // its scope, a before failure poisons its single main request.
    const skipTracker = new HookSkipTracker();
    // Built once per collection — shared across digest/ntlm retries.
    const dispatcher = await buildDispatcher(undefined, effectiveTls);

    // Prints pre/post script console output live in verbose mode, matching
    // the old inline behavior.
    const onScriptOutput = (phase: 'pre' | 'post', lines: string[], error?: string): void => {
      if (verbose && lines.length) lines.forEach(l => console.log(color(`    [${phase}] ${l}`, C.gray)));
      if (phase === 'pre' && error) console.error(color(`    [pre-script error] ${error}`, C.red));
    };

    for (const item of items) {
      const { isHook, hookType, scopeId } = item;

      const skipReason = skipTracker.shouldSkip(item);

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
        const out = await executeRunnerRequest({
          req: item.request,
          collectionVars: { ...item.collectionVars, ...runCollectionVars },
          envVars: runEnvVars,
          globals: runGlobals,
          localVars: { ...runLocalVars },
          dispatcher,
          piiMaskPatterns: piiPatterns,
          tls: effectiveTls,
          onScriptOutput,
        });
        result            = out.result;
        runEnvVars        = out.updatedEnvVars;
        runCollectionVars = out.updatedCollectionVars;
        runGlobals        = out.updatedGlobals;
        runLocalVars      = out.updatedLocalVars;

        result.isHook    = isHook;
        result.hookType  = hookType;
        result.scopeId   = scopeId;
        result.scopePath = item.scopePath;

        skipTracker.recordResult(item, result.status);
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
