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
 *   --format     json|junit|html|sarif  Output format (default: json; inferred from --output extension)
 *   --verbose                Print per-request console output and test details
 *   --bail                   Stop after first failure
 *   --help                   Show this message
 */

import { writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

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
  type RunnerExecResult,
} from '../main/request-exec';
import { buildJsonReport, buildJUnitReport, buildHtmlReport, buildSarifReport } from '../shared/report';
import { buildRunPlan, expandFolderDataSets, expandRunPlanWithData, resolveInheritedAuthAndHeaders, authIsConfigured } from '../shared/request-collection';
import { askVarsInRequest, resolveAskValues, missingAskMessages } from '../shared/ask-vars';
import { runPlanConcurrent } from '../shared/run-concurrent';
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
  // `--ask`, `--var`, `--env-var` and `--global-var` may be given more than
  // once, so collect them as arrays.
  const args = parseArgs(process.argv.slice(2), ['ask', 'var', 'env-var', 'global-var']);

  if (args.help) {
    console.log(
      '\nUsage:\n  api-spector run --workspace <path> [--environment <name>] [--tags <a,b>]\n' +
      '                  [--collection <name>] [--var "key=value"]\n' +
      '                  [--env-var "key=value"] [--global-var "key=value"]\n' +
      '                  [--output <path>] [--format json|junit|html|sarif]\n' +
      '                  [--ask "Message=value"] [--concurrency <n>] [--verbose] [--bail]\n\n' +
      '  --var "key=value"      Override a variable for this run (repeatable). Sits at\n' +
      '                         the CLI tier: above environment/collection/folder/\n' +
      '                         request values, below data-row and script-set values.\n' +
      '  --env-var "key=value"  Set an environment variable for this run (repeatable).\n' +
      '                         Seeds the environment scope; a script may override it.\n' +
      '  --global-var "key=value"  Set a global variable for this run (repeatable).\n' +
      '                         Seeds the globals scope; a script may override it.\n' +
      '  --ask "Message=value"  Supply an ask variable ({{@Message}}) for this run\n' +
      '                         (repeatable). Requests whose ask variables are not\n' +
      '                         supplied are skipped.\n' +
      '  --concurrency <n>      Run n requests at a time (default 1 = sequential).\n' +
      '                         Hooks run as barriers; best for independent requests.\n'
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
    ? extname(outputPath).toLowerCase() === '.xml'   ? 'junit'
    : extname(outputPath).toLowerCase() === '.html'  ? 'html'
    : extname(outputPath).toLowerCase() === '.sarif' ? 'sarif'
    : 'json'
    : 'json';
  const explicitFormat = (args.format as string | undefined)?.toLowerCase();
  const outputFormat   = (explicitFormat === 'junit' || explicitFormat === 'html' || explicitFormat === 'sarif') ? explicitFormat : inferredFormat;

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

  // Ask-variable answers for a non-interactive run: --ask "Message=value"
  // (repeatable). A request whose ask variables are not all supplied is skipped.
  const askAnswers: Record<string, string> = {};
  const askArgRaw = args['ask'];
  for (const entry of Array.isArray(askArgRaw) ? askArgRaw : askArgRaw ? [askArgRaw] : []) {
    if (typeof entry !== 'string') continue;
    const eq = entry.indexOf('=');
    if (eq > 0) askAnswers[entry.slice(0, eq).trim()] = entry.slice(eq + 1);
  }

  // Parse a repeatable "key=value" CLI argument into a map.
  const parseKeyVals = (raw: string | boolean | string[] | undefined): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const entry of Array.isArray(raw) ? raw : raw ? [raw] : []) {
      if (typeof entry !== 'string') continue;
      const eq = entry.indexOf('=');
      if (eq > 0) out[entry.slice(0, eq).trim()] = entry.slice(eq + 1);
    }
    return out;
  };

  // --var "key=value" (repeatable): a scope-agnostic override at the CLI tier of
  // the precedence chain — above environment/collection/folder/request/example,
  // below data-row and runtime (script-set) values. Injected as the initial
  // value of each request's local vars; a script that sets the key takes over.
  const cliVars = parseKeyVals(args['var']);
  // --env-var / --global-var "key=value" (repeatable): Postman/Bruno-style scope
  // seeds. They set the INITIAL value of the environment / globals scope (over
  // the stored value), resolve at that scope's precedence, and are overridden by
  // a script `sp.environment.set` / `sp.globals.set` later in the run.
  const envVarOverrides    = parseKeyVals(args['env-var']);
  const globalVarOverrides = parseKeyVals(args['global-var']);

  // Concurrency: run this many requests at once (1 = sequential). Hooks are
  // barriers and concurrent requests share the pre-batch variable snapshot, so
  // a parallel run suits independent requests.
  const concurrency = Math.max(1, Math.min(20, Math.floor(Number(args['concurrency'] ?? 1) || 1)));

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
    if (col.disabled) {
      // Excluded from the run, but recorded (per collection) so it is visible
      // both in the console and in the exported report rather than vanishing.
      console.log(color(`  ┌ ${col.name}  (disabled)`, C.gray));
      allResults.push({
        requestId:   col.id,
        name:        col.name,
        method:      '',
        resolvedUrl: '',
        status:      'skipped',
        error:       'Collection disabled',
        scopePath:   [],
      });
      summary.total++;
      summary.skipped++;
      continue;
    }

    // Use the same plan builder the in-app runner uses, so before/beforeAll
    // hooks (e.g. a "fetch token" request) actually execute and propagate
    // their extracted variables to subsequent requests. `collectTagged`
    // silently dropped hooks, which is why CLI runs of an authed request
    // came back 401 even though the UI runner worked.
    let items = buildRunPlan(col, null, filterTags);
    if (items.length === 0) continue;

    if (!firstColName) firstColName = col.name;

    // Seed the environment / globals scopes with the Postman/Bruno-style CLI
    // overrides (--env-var / --global-var). They override the stored values but
    // stay in the scope accumulators, so a script's sp.environment.set /
    // sp.globals.set during the run overrides them for later requests.
    let runEnvVars        = { ...(await buildEnvVars(env)), ...envVarOverrides };
    let runGlobals        = { ...getGlobals(), ...globalVarOverrides };
    let runCollectionVars: Record<string, string> = { ...col.collectionVariables };
    let runLocalVars:     Record<string, string> = {};
    // Folder-scoped variables accumulated during the run, keyed by folder id, so
    // sp.folder.set in one request is visible to later requests in the same
    // folder (mirrors the GUI runner).
    const runFolderVars: Record<string, Record<string, string>> = {};
    // CLI `--var` is the *initial* value for a variable, not a hard override:
    // per the precedence chain, a runtime script-set outranks it. So once a
    // script writes a key (in any scope) during this collection's run, we stop
    // re-seeding the CLI value for it and let the script's value carry forward.
    const cliOverridden = new Set<string>();
    const cliSeed = (): Record<string, string> =>
      Object.fromEntries(Object.entries(cliVars).filter(([k]) => !cliOverridden.has(k)));
    // The CLI seed is re-applied fresh each request via cliSeed(); it must NOT
    // stick in the threaded local vars (the executor echoes the localVars we
    // pass back as updatedLocalVars), or it would shadow a later script write to
    // the same key in another scope. So strip CLI keys from the threaded state.
    const stripCliSeed = (m: Record<string, string>): Record<string, string> => {
      const copy = { ...m };
      for (const k of Object.keys(cliVars)) delete copy[k];
      return copy;
    };
    // Flag any CLI key a script changed this request (by scope, vs the fed input).
    const trackCliOverrides = (
      out: RunnerExecResult,
      inputs: { col: Record<string, string>; env: Record<string, string>; globals: Record<string, string>; folder: Record<string, string>; local: Record<string, string> },
    ): void => {
      for (const k of Object.keys(cliVars)) {
        if (cliOverridden.has(k)) continue;
        if (out.updatedCollectionVars[k] !== inputs.col[k]
          || out.updatedEnvVars[k]       !== inputs.env[k]
          || out.updatedGlobals[k]       !== inputs.globals[k]
          || out.updatedFolderVars[k]    !== inputs.folder[k]
          || out.updatedLocalVars[k]     !== inputs.local[k]) {
          cliOverridden.add(k);
        }
      }
    };

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

    // Expansion — identical to the in-app runner so CLI/CI runs (and the
    // report) match the tree. Done after the auth/header merge so each request
    // is merged once, not once per iteration: each folder's own data table,
    // then the collection's. A data table can carry `expectStatus`/`owasp`
    // columns to double as an access-control matrix.
    items = expandFolderDataSets(items, col);
    items = expandRunPlanWithData(items, col.dataSet);

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

    if (concurrency <= 1) for (const item of items) {
      const { isHook, hookType, scopeId } = item;

      const skipReason = skipTracker.shouldSkip(item);

      // Ask variables ({{@Message}}) that were not supplied via --ask: skip this
      // request in the non-interactive run rather than send a blank value.
      const itemAsks = askVarsInRequest(item.request);
      const missingAsks = itemAsks.length ? missingAskMessages(itemAsks, askAnswers) : [];

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
          collection: item.collection,
          scopePath:  item.scopePath,
          iterationLabel: item.iterationLabel,
        };
      } else if (missingAsks.length) {
        result = {
          requestId:  item.request.id,
          name:       item.request.name,
          method:     item.request.method,
          resolvedUrl: item.request.url,
          status:     'skipped',
          error:      `Ask variable(s) not provided: ${missingAsks.join(', ')} (use --ask "${missingAsks[0]}=value")`,
          isHook,
          hookType,
          scopeId,
          collection: item.collection,
          scopePath:  item.scopePath,
          iterationLabel: item.iterationLabel,
        };
      } else {
        const colInput    = { ...item.collectionVars, ...runCollectionVars, ...resolveAskValues(itemAsks, askAnswers) };
        const folderInput  = { ...(item.folderVars ?? {}), ...(item.folderId ? runFolderVars[item.folderId] ?? {} : {}) };
        const localInput   = { ...cliSeed(), ...runLocalVars, ...item.dataRow };
        const out = await executeRunnerRequest({
          req: item.request,
          collectionVars: colInput,
          envVars: runEnvVars,
          globals: runGlobals,
          localVars: localInput,
          folderVars: folderInput,
          dispatcher,
          piiMaskPatterns: piiPatterns,
          tls: effectiveTls,
          onScriptOutput,
          expectStatus: item.expectStatus,
          owaspTag: item.owaspTag,
        });
        trackCliOverrides(out, { col: colInput, env: runEnvVars, globals: runGlobals, folder: folderInput, local: localInput });
        result            = out.result;
        runEnvVars        = out.updatedEnvVars;
        runCollectionVars = out.updatedCollectionVars;
        runGlobals        = out.updatedGlobals;
        runLocalVars      = stripCliSeed(out.updatedLocalVars);
        if (item.folderId) {
          runFolderVars[item.folderId] = { ...(runFolderVars[item.folderId] ?? {}), ...out.updatedFolderVars };
        }

        result.isHook    = isHook;
        result.hookType  = hookType;
        result.scopeId   = scopeId;
        result.collection = item.collection;
        result.scopePath = item.scopePath;
        result.iterationLabel = item.iterationLabel;

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
    else {
      // ── Parallel: run requests concurrently with hooks as barriers, then
      // print the collected results in plan order. ─────────────────────────────
      const resultsByIndex: (RunRequestResult | undefined)[] = new Array(items.length);
      const preResult = (item: typeof items[number], status: RunRequestResult['status'], error?: string): RunRequestResult => ({
        requestId: item.request.id, name: item.request.name, method: item.request.method,
        resolvedUrl: item.request.url, status, error,
        isHook: item.isHook, hookType: item.hookType, scopeId: item.scopeId,
        collection: item.collection, scopePath: item.scopePath, iterationLabel: item.iterationLabel,
      });
      const runItem = async (item: typeof items[number], i: number): Promise<void> => {
        const skipReason = skipTracker.shouldSkip(item);
        const itemAsks = askVarsInRequest(item.request);
        const missingAsks = itemAsks.length ? missingAskMessages(itemAsks, askAnswers) : [];
        if (skipReason) { resultsByIndex[i] = preResult(item, 'failed', skipReason); return; }
        if (missingAsks.length) { resultsByIndex[i] = preResult(item, 'skipped', `Ask variable(s) not provided: ${missingAsks.join(', ')}`); return; }
        try {
          const colInput    = { ...item.collectionVars, ...runCollectionVars, ...resolveAskValues(itemAsks, askAnswers) };
          const folderInput = { ...(item.folderVars ?? {}), ...(item.folderId ? runFolderVars[item.folderId] ?? {} : {}) };
          const localInput  = { ...cliSeed(), ...runLocalVars, ...item.dataRow };
          const out: RunnerExecResult = await executeRunnerRequest({
            req: item.request,
            collectionVars: colInput,
            envVars: runEnvVars, globals: runGlobals, localVars: localInput,
            folderVars: folderInput,
            dispatcher, piiMaskPatterns: piiPatterns, tls: effectiveTls,
            expectStatus: item.expectStatus, owaspTag: item.owaspTag,
          });
          trackCliOverrides(out, { col: colInput, env: runEnvVars, globals: runGlobals, folder: folderInput, local: localInput });
          runEnvVars = { ...runEnvVars, ...out.updatedEnvVars };
          runCollectionVars = { ...runCollectionVars, ...out.updatedCollectionVars };
          runGlobals = { ...runGlobals, ...out.updatedGlobals };
          runLocalVars = stripCliSeed({ ...runLocalVars, ...out.updatedLocalVars });
          if (item.folderId) runFolderVars[item.folderId] = { ...(runFolderVars[item.folderId] ?? {}), ...out.updatedFolderVars };
          const result = out.result;
          result.isHook = item.isHook; result.hookType = item.hookType; result.scopeId = item.scopeId;
          result.collection = item.collection; result.scopePath = item.scopePath; result.iterationLabel = item.iterationLabel;
          skipTracker.recordResult(item, result.status);
          resultsByIndex[i] = result;
        } catch (e) {
          resultsByIndex[i] = preResult(item, 'error', e instanceof Error ? e.message : String(e));
          skipTracker.recordResult(item, 'error');
        }
      };
      await runPlanConcurrent(concurrency, items, it => Boolean(it.isHook), runItem);

      for (let i = 0; i < items.length; i++) {
        const result = resultsByIndex[i];
        if (!result) continue;
        const item = items[i];
        const scopeKey = (item.scopePath ?? []).join(' / ');
        if (scopeKey !== lastPrintedScope) { if (scopeKey) console.log(color(`    ${scopeKey}`, C.gray, C.bold)); lastPrintedScope = scopeKey; }
        printResult(result, verbose);
        allResults.push(result);
        summary.total++;
        if (result.status === 'passed') summary.passed++;
        else if (result.status === 'failed') summary.failed++;
        else if (result.status === 'skipped') summary.skipped++;
        else summary.errors++;
        if (bail && (result.status === 'failed' || result.status === 'error')) { console.log(color('\n  Bailing after first failure.', C.yellow)); bailed = true; break; }
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
                 : outputFormat === 'sarif' ? buildSarifReport(maskedResults, summary, meta)
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
