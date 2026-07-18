#!/usr/bin/env node
// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

/**
 * API Spector contract CLI
 *
 * Usage:
 *   api-spector contract list --workspace <path>
 *   api-spector contract pin  --workspace <path> --spec-url <url> | --spec-path <file> [--name <label>]
 *   api-spector contract run  --workspace <path> --mode <mode> [options]
 *
 *   Modes: consumer | provider | provider-live | bidirectional
 *
 * Run options:
 *   --snapshot <id|name>      Run against a pinned snapshot (looks up by id
 *                             prefix or exact name). Takes priority over
 *                             --spec-url / --spec-path.
 *   --spec-url <url>          Fetch spec from URL for this run (not pinned).
 *   --spec-path <path>        Read spec from local file for this run.
 *   --collection <name>       Limit to a specific collection (default: all).
 *   --environment <name>      Environment to resolve {{vars}} against.
 *   --request-base-url <url>  Strip this host from request URLs before matching.
 *   --output <path>           Write ContractReport JSON to a file.
 *   --allow-pending           Never-verified failures report as pending.
 *
 * Also: pin, can-i-deploy [--to <env>], record-deployment, environments,
 * webhooks [--test], report [--serve], pact-import, pact-export.
 */

import { readFile, writeFile } from 'fs/promises';
import { join, resolve as resolvePath } from 'path';
import type { Workspace, ApiRequest, ContractSnapshot, ContractMode, ContractReport } from '../shared/types';
import { runConsumerContracts, hasContract } from '../main/contract/consumer-verifier';
import { runProviderVerification } from '../main/contract/provider-verifier';
import { runLiveProviderVerification } from '../main/contract/provider-live-verifier';
import { runBidirectional } from '../main/contract/bidirectional';
import { listSnapshots, captureSnapshot, relPathOf } from '../main/contract/snapshots';
import { toJUnitXml } from '../main/contract/report-formats';
import { reportToHtml, dashboardToHtml, fuzzReportToHtml } from '../main/contract/html-report';
import { runFuzz } from '../main/contract/fuzz';
import { recordResult, canIDeploy, listResults, recordDeployment, listEnvironments } from '../main/contract/results-store';
import { importPact, pactToCollection, exportPact } from '../main/contract/pact-format';
import { loadPendingStore, savePendingStore, applyPendingSemantics } from '../main/contract/pending';
import { loadWebhookConfig, watchContractEvents, fireWebhooks } from '../main/contract/webhooks';
import { writeFile as fsWriteFile } from 'fs/promises';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { parseArgs, loadWorkspace, loadCollections, loadEnvironments } from './cli-common';
import { selectEnvironment, resolveEnvironmentChain } from '../shared/environments';

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdList ( args: Record<string, string | boolean> ): Promise<void> {
  const wsArg = args['workspace'];
  if ( typeof wsArg !== 'string' ) {
    console.error( '  [error] --workspace <path> is required' );
    process.exit( 2 );
  }
  const { workspace, dir } = await loadWorkspace( wsArg );
  const snapshots = await listSnapshots( dir, workspace.contracts ?? [] );

  if ( snapshots.length === 0 ) {
    console.log( '  No contract snapshots. Capture one from the app or via:' );
    console.log( '    api-spector contract pin --workspace <path> --spec-url <url>' );
    return;
  }

  // Pretty table
  console.log( '' );
  console.log( '  ID       Name                                Version     Captured' );
  console.log( '  ──────── ─────────────────────────────────── ─────────── ──────────────────' );
  for ( const { snapshot } of snapshots ) {
    const id = snapshot.id.slice( 0, 8 );
    const name = snapshot.name.slice( 0, 35 ).padEnd( 35 );
    const version = ( snapshot.specVersion ?? '-' ).slice( 0, 11 ).padEnd( 11 );
    const when = snapshot.capturedAt.slice( 0, 19 ).replace( 'T', ' ' );
    console.log( `  ${id} ${name} ${version} ${when}` );
  }
  console.log( '' );
  console.log( '  Run against a snapshot:' );
  console.log( '    api-spector contract run --workspace <path> --mode provider --snapshot <id>' );
}

/** Pin an OpenAPI spec as a workspace snapshot (same as the GUI's Pin button)
 *  and register it in the workspace file so `list`/`run --snapshot` see it. */
async function cmdPin ( args: Record<string, string | boolean> ): Promise<void> {
  const wsArg = args['workspace'];
  if ( typeof wsArg !== 'string' ) {
    console.error( '  [error] --workspace <path> is required' );
    process.exit( 2 );
  }
  const specUrl = typeof args['spec-url'] === 'string' ? args['spec-url'] : undefined;
  const specPath = typeof args['spec-path'] === 'string' ? resolvePath( args['spec-path'] ) : undefined;
  if ( !specUrl && !specPath ) {
    console.error( '  [error] --spec-url <url> or --spec-path <file> is required' );
    process.exit( 2 );
  }
  const name = typeof args['name'] === 'string' ? args['name'] : undefined;

  const { workspace, dir, file } = await loadWorkspace( wsArg );
  const snapshot = await captureSnapshot( dir, { specUrl, specPath, name } );
  const relPath = relPathOf( snapshot );

  if ( relPath && !( workspace.contracts ?? [] ).includes( relPath ) ) {
    workspace.contracts = [ ...( workspace.contracts ?? [] ), relPath ];
    await writeFile( file, JSON.stringify( workspace, null, 2 ), 'utf8' );
  }

  console.log( `  Pinned "${snapshot.name}" (spec version ${snapshot.specVersion ?? 'unknown'}, sha256 ${snapshot.sha256.slice( 0, 12 )}...)` );
  console.log( `  ID:   ${snapshot.id.slice( 0, 8 )}` );
  if ( relPath ) console.log( `  File: ${relPath}` );
  console.log( '' );
  console.log( '  Run against it:' );
  console.log( `    api-spector contract run --workspace ${wsArg} --mode provider --snapshot ${snapshot.id.slice( 0, 8 )}` );
}

/** Find a snapshot by exact id, id-prefix (first 8 chars are shown by `list`),
 *  or exact name. Returns the rel-path + loaded snapshot for use with run. */
async function resolveSnapshot (
  ws: Workspace,
  dir: string,
  needle: string,
): Promise<{ relPath: string; snapshot: ContractSnapshot }> {
  const all = await listSnapshots( dir, ws.contracts ?? [] );
  const matches = all.filter( ( { snapshot } ) =>
    snapshot.id === needle ||
    snapshot.id.startsWith( needle ) ||
    snapshot.name === needle,
  );
  if ( matches.length === 0 ) throw new Error( `No snapshot matches "${needle}". Run \`api-spector contract list --workspace <path>\` to see available snapshots.` );
  if ( matches.length > 1 ) {
    const ids = matches.map( m => m.snapshot.id.slice( 0, 8 ) ).join( ', ' );
    throw new Error( `Ambiguous snapshot "${needle}" matches multiple (${ids}). Use a longer id prefix.` );
  }
  return matches[0];
}

async function cmdRun ( args: Record<string, string | boolean> ): Promise<void> {
  const wsArg = args['workspace'];
  const mode = args['mode'];
  if ( typeof wsArg !== 'string' ) {
    console.error( '  [error] --workspace <path> is required' );
    process.exit( 2 );
  }
  if ( mode !== 'consumer' && mode !== 'provider' && mode !== 'provider-live' && mode !== 'bidirectional' ) {
    console.error( '  [error] --mode must be one of: consumer, provider, provider-live, bidirectional' );
    process.exit( 2 );
  }

  const { workspace, dir } = await loadWorkspace( wsArg );

  // Collections + env vars
  const collectionName = typeof args['collection'] === 'string' ? args['collection'] : undefined;
  const collections = await loadCollections( workspace, dir, { filterName: collectionName } );
  const envs = await loadEnvironments( workspace, dir );
  const envName = typeof args['environment'] === 'string' ? args['environment'] : undefined;
  // --environment flag, else the workspace's default environment, else the
  // first environment (historical behavior). Inheritance chains are merged.
  const activeEnv = selectEnvironment( workspace, envs, envName )
    ?? ( envName ? undefined : envs[0] ? resolveEnvironmentChain( envs[0], envs ) : undefined );
  const envVars: Record<string, string> = {};
  for ( const v of activeEnv?.variables ?? [] ) if ( v.enabled ) envVars[v.key] = v.value;
  const collectionVars: Record<string, string> = {};
  for ( const c of collections ) Object.assign( collectionVars, c.collectionVariables ?? {} );

  const allRequests: ApiRequest[] = collections.flatMap( c => Object.values( c.requests ) );
  const contractRequests = allRequests.filter( r => hasContract( r.contract ) );

  // Resolve spec source: --snapshot takes priority over --spec-url / --spec-path.
  let specUrl = typeof args['spec-url'] === 'string' ? args['spec-url'] : undefined;
  let specPath = typeof args['spec-path'] === 'string' ? args['spec-path'] : undefined;
  let snapshotLabel: string | undefined;

  if ( typeof args['snapshot'] === 'string' ) {
    const { snapshot } = await resolveSnapshot( workspace, dir, args['snapshot'] );
    // Materialize the snapshot spec to a tmp file so the verifier can read it
    // like any other local spec file (matches how the IPC handler does it).
    const tmp = join( tmpdir(), `api-spector-${randomUUID()}.${snapshot.format === 'yaml' ? 'yaml' : 'json'}` );
    await fsWriteFile( tmp, snapshot.spec, 'utf8' );
    specPath = tmp;
    specUrl = undefined;
    snapshotLabel = `${snapshot.name}${snapshot.specVersion ? ` (${snapshot.specVersion})` : ''}`;
  }

  const requestBaseUrl = typeof args['request-base-url'] === 'string' ? args['request-base-url'] : undefined;
  const providerBaseUrl = typeof args['provider-base-url'] === 'string' ? args['provider-base-url'] : undefined;
  const stateHandlerUrl = typeof args['states-url'] === 'string' ? args['states-url'] : undefined;

  // Spec is required only for the spec-driven modes (provider, bidirectional).
  if ( ( mode === 'provider' || mode === 'bidirectional' ) && !specUrl && !specPath ) {
    console.error( '  [error] Provider / bidirectional mode requires --snapshot, --spec-url, or --spec-path' );
    process.exit( 2 );
  }
  if ( mode === 'provider-live' && !providerBaseUrl ) {
    console.error( '  [error] provider-live mode requires --provider-base-url <url>' );
    process.exit( 2 );
  }

  console.log( `  Running ${mode} contracts…` );
  if ( snapshotLabel ) console.log( `  Spec: snapshot "${snapshotLabel}"` );
  else if ( specUrl ) console.log( `  Spec: ${specUrl} (live)` );
  else if ( specPath ) console.log( `  Spec: ${specPath}` );
  if ( providerBaseUrl ) console.log( `  Provider: ${providerBaseUrl}` );

  let report: ContractReport;
  const modeValue = mode as ContractMode;
  switch ( modeValue ) {
    case 'consumer':
      report = await runConsumerContracts( contractRequests, envVars, collectionVars );
      break;
    case 'provider':
      report = await runProviderVerification( allRequests, envVars, collectionVars, specUrl, specPath, requestBaseUrl );
      break;
    case 'provider-live':
      report = await runLiveProviderVerification( contractRequests, envVars, collectionVars, providerBaseUrl, stateHandlerUrl );
      break;
    case 'bidirectional':
      report = await runBidirectional( contractRequests, envVars, collectionVars, specUrl, specPath, requestBaseUrl );
      break;
  }

  // Pending contracts: failures of interactions that never passed before are
  // reported but do not block (Pact's pending pacts). Opt-in per run; the
  // first-pass ledger lives in contracts/pending.json and only updates when
  // the flag is used, so teams that don't use it see no new files.
  if ( args['allow-pending'] ) {
    const store = await loadPendingStore( dir );
    const verified = mode === 'provider' ? allRequests : contractRequests;
    applyPendingSemantics( report, verified, store, new Date().toISOString() );
    await savePendingStore( dir, store );
  }

  // Summary
  console.log( '' );
  if ( report.failed === 0 ) {
    console.log( `  ✓ All ${report.passed}/${report.total - ( report.pending ?? 0 )} required passed in ${report.durationMs}ms` );
  } else {
    console.log( `  ✗ ${report.failed}/${report.total} failed (${report.passed} passed) in ${report.durationMs}ms` );
    console.log( '' );
    for ( const r of report.results.filter( r => !r.passed && !r.pending ) ) {
      console.log( `    ${r.method} ${r.requestName}` );
      for ( const v of r.violations ) {
        console.log( `      · ${v.type}: ${v.message}` );
      }
    }
  }
  if ( report.pending ) {
    console.log( '' );
    console.log( `  ⚠ ${report.pending} pending contract${report.pending === 1 ? '' : 's'} failed (never verified before; not blocking):` );
    for ( const r of report.results.filter( r => r.pending ) ) {
      console.log( `    ${r.method} ${r.requestName}` );
      for ( const v of r.violations ) {
        console.log( `      · ${v.type}: ${v.message}` );
      }
    }
  }

  if ( typeof args['output'] === 'string' ) {
    await writeFile( args['output'], JSON.stringify( report, null, 2 ), 'utf8' );
    console.log( `\n  Report written to ${args['output']}` );
  }

  if ( typeof args['junit'] === 'string' ) {
    await writeFile( args['junit'], toJUnitXml( report ), 'utf8' );
    console.log( `  JUnit report written to ${args['junit']}` );
  }

  if ( typeof args['html'] === 'string' ) {
    const html = reportToHtml( report, {
      consumer: collections[0]?.name,
      provider: providerBaseUrl,
      spec: snapshotLabel ?? specUrl ?? specPath,
      generatedAt: new Date().toISOString(),
    } );
    await writeFile( args['html'], html, 'utf8' );
    console.log( `  HTML report written to ${args['html']}` );
  }

  // Record the result for `can-i-deploy` gating.
  if ( args['record'] ) {
    const appVersion = typeof args['app-version'] === 'string' ? args['app-version'] : undefined;
    if ( !appVersion ) {
      console.error( '  [error] --record requires --app-version <version>' );
      process.exit( 2 );
    }
    const pacticipant = typeof args['pacticipant'] === 'string'
      ? args['pacticipant']
      : ( collections[0]?.name ?? 'app' );
    const file = await recordResult( dir, pacticipant, appVersion, report, new Date().toISOString() );
    console.log( `  Recorded result for ${pacticipant}@${appVersion} → ${file}` );
  }

  process.exit( report.failed === 0 ? 0 : 1 );
}

// ─── can-i-deploy ─────────────────────────────────────────────────────────────

async function cmdCanIDeploy ( args: Record<string, string | boolean> ): Promise<void> {
  const wsArg = args['workspace'];
  const pacticipant = args['pacticipant'];
  const appVersion = args['app-version'];
  if ( typeof wsArg !== 'string' ) { console.error( '  [error] --workspace <path> is required' ); process.exit( 2 ); }
  if ( typeof pacticipant !== 'string' ) { console.error( '  [error] --pacticipant <name> is required' ); process.exit( 2 ); }
  if ( typeof appVersion !== 'string' ) { console.error( '  [error] --app-version <version> is required' ); process.exit( 2 ); }

  const toEnv = typeof args['to'] === 'string' ? args['to'] : undefined;

  const { dir } = await loadWorkspace( wsArg );
  const verdict = await canIDeploy( dir, pacticipant, appVersion, toEnv );

  console.log( '' );
  console.log( verdict.deployable ? `  ✓ Computer says yes - safe to deploy.` : `  ✗ Computer says no.` );
  console.log( `  ${verdict.reason}` );
  if ( toEnv ) {
    if ( verdict.currentlyDeployed ) {
      console.log( `  ${toEnv} currently runs ${pacticipant}@${verdict.currentlyDeployed.version} (since ${verdict.currentlyDeployed.recordedAt}).` );
    } else {
      console.log( `  ${toEnv} has no recorded deployment of ${pacticipant} yet.` );
    }
    if ( verdict.deployable ) {
      console.log( `  After deploying, record it:` );
      console.log( `    api-spector contract record-deployment --workspace ${wsArg} --pacticipant ${pacticipant} --app-version ${appVersion} --env ${toEnv}` );
    }
  }
  process.exit( verdict.deployable ? 0 : 1 );
}

// ─── Deployment tracking ──────────────────────────────────────────────────────

async function cmdRecordDeployment ( args: Record<string, string | boolean> ): Promise<void> {
  const wsArg = args['workspace'];
  const pacticipant = args['pacticipant'];
  const appVersion = args['app-version'];
  const env = args['env'];
  if ( typeof wsArg !== 'string' ) { console.error( '  [error] --workspace <path> is required' ); process.exit( 2 ); }
  if ( typeof pacticipant !== 'string' ) { console.error( '  [error] --pacticipant <name> is required' ); process.exit( 2 ); }
  if ( typeof appVersion !== 'string' ) { console.error( '  [error] --app-version <version> is required' ); process.exit( 2 ); }
  if ( typeof env !== 'string' ) { console.error( '  [error] --env <name> is required (e.g. staging, prod)' ); process.exit( 2 ); }

  const { dir } = await loadWorkspace( wsArg );

  // Recording documents a fact (the deploy happened), so it never blocks.
  // But warn loudly when the recorded version has no passing verification,
  // because that means the can-i-deploy gate was skipped.
  const verdict = await canIDeploy( dir, pacticipant, appVersion );
  const { file, previous } = await recordDeployment( dir, env, pacticipant, appVersion, new Date().toISOString() );

  console.log( `  Recorded: ${pacticipant}@${appVersion} deployed to ${env}` );
  if ( previous ) console.log( `  Replaces: ${pacticipant}@${previous.version} (deployed ${previous.recordedAt})` );
  console.log( `  File:     ${file}` );
  if ( !verdict.deployable ) {
    console.log( '' );
    console.log( `  [warn] ${verdict.reason}` );
    console.log( `  [warn] This version was deployed without a passing contract verification.` );
  }
}

async function cmdEnvironments ( args: Record<string, string | boolean> ): Promise<void> {
  const wsArg = args['workspace'];
  if ( typeof wsArg !== 'string' ) { console.error( '  [error] --workspace <path> is required' ); process.exit( 2 ); }

  const { dir } = await loadWorkspace( wsArg );
  const envs = await listEnvironments( dir );

  if ( envs.length === 0 ) {
    console.log( '  No deployments recorded. After a deploy, run:' );
    console.log( '    api-spector contract record-deployment --workspace <path> --pacticipant <name> --app-version <ver> --env <name>' );
    return;
  }

  for ( const e of envs ) {
    console.log( '' );
    console.log( `  ${e.name}` );
    for ( const [p, d] of Object.entries( e.deployed ).sort( ( a, b ) => a[0].localeCompare( b[0] ) ) ) {
      console.log( `    ${p}@${d.version}    since ${d.recordedAt.slice( 0, 19 ).replace( 'T', ' ' )}` );
    }
  }
  console.log( '' );
}

// ─── Fuzzing ──────────────────────────────────────────────────────────────────

async function cmdFuzz ( args: Record<string, string | boolean> ): Promise<void> {
  const wsArg = args['workspace'];
  if ( typeof wsArg !== 'string' ) { console.error( '  [error] --workspace <path> is required' ); process.exit( 2 ); }

  const { workspace, dir } = await loadWorkspace( wsArg );
  const collectionName = typeof args['collection'] === 'string' ? args['collection'] : undefined;
  const collections = await loadCollections( workspace, dir, { filterName: collectionName } );
  const envs = await loadEnvironments( workspace, dir );
  const envName = typeof args['environment'] === 'string' ? args['environment'] : undefined;
  const activeEnv = selectEnvironment( workspace, envs, envName )
    ?? ( envName ? undefined : envs[0] ? resolveEnvironmentChain( envs[0], envs ) : undefined );
  const envVars: Record<string, string> = {};
  for ( const v of activeEnv?.variables ?? [] ) if ( v.enabled ) envVars[v.key] = v.value;
  const collectionVars: Record<string, string> = {};
  for ( const c of collections ) Object.assign( collectionVars, c.collectionVariables ?? {} );

  const allRequests: ApiRequest[] = collections.flatMap( c => Object.values( c.requests ) );

  // Spec source: --snapshot, --spec-url, or --spec-path. Optional: without one,
  // request bodies are the baseline.
  let specUrl = typeof args['spec-url'] === 'string' ? args['spec-url'] : undefined;
  let specPath = typeof args['spec-path'] === 'string' ? args['spec-path'] : undefined;
  if ( typeof args['snapshot'] === 'string' ) {
    const { snapshot } = await resolveSnapshot( workspace, dir, args['snapshot'] );
    const tmp = join( tmpdir(), `api-spector-${randomUUID()}.${snapshot.format === 'yaml' ? 'yaml' : 'json'}` );
    await fsWriteFile( tmp, snapshot.spec, 'utf8' );
    specPath = tmp;
    specUrl = undefined;
  }

  const providerBaseUrl = typeof args['provider-base-url'] === 'string' ? args['provider-base-url'] : undefined;
  if ( !providerBaseUrl && !specUrl && !specPath ) {
    console.error( '  [error] fuzz needs a target: --provider-base-url <url> (and optionally a spec via --snapshot / --spec-url / --spec-path)' );
    process.exit( 2 );
  }

  const includeWrites = Boolean( args['include-writes'] );
  console.log( `  Fuzzing ${allRequests.length} request(s)${specUrl || specPath ? ' against the spec' : ' from request bodies'}...` );
  if ( !includeWrites ) console.log( '  Write methods (POST/PUT/PATCH/DELETE) are skipped. Add --include-writes to fuzz them (sends malformed writes; target staging or a mock).' );

  const report = await runFuzz( {
    requests: allRequests,
    envVars,
    collectionVars,
    specUrl,
    specPath,
    providerBaseUrl,
    requestBaseUrl: typeof args['request-base-url'] === 'string' ? args['request-base-url'] : undefined,
    casesPerOperation: typeof args['cases'] === 'string' ? Math.max( 1, Number( args['cases'] ) ) : undefined,
    seed: typeof args['seed'] === 'string' ? Number( args['seed'] ) : undefined,
    includeWrites,
    strictStatus: Boolean( args['strict-status'] ),
    checkResponses: Boolean( args['check-responses'] ),
    trace: Boolean( args['trace'] ),
  } );

  console.log( '' );
  if ( report.totalFindings === 0 ) {
    console.log( `  ✓ No findings across ${report.totalCases} malformed cases (seed ${report.seed}, ${report.durationMs}ms)` );
  } else {
    console.log( `  ✗ ${report.totalFindings} finding(s) across ${report.totalCases} cases (seed ${report.seed}, ${report.durationMs}ms)` );
    for ( const op of report.results.filter( r => r.findings.length > 0 ) ) {
      console.log( '' );
      console.log( `    ${op.method} ${op.requestName}  (${op.findings.length}/${op.cases})` );
      for ( const f of op.findings ) {
        console.log( `      · [${f.oracle}] HTTP ${f.status} on ${f.mutation.target} (${f.mutation.kind}): ${f.message}` );
      }
    }
  }
  if ( report.skippedWrites ) console.log( `\n  ${report.skippedWrites} write-method request(s) skipped (use --include-writes).` );
  if ( report.skippedNoBody ) console.log( `  ${report.skippedNoBody} request(s) had no body to fuzz.` );

  // --trace: list every case that was sent, not just findings.
  if ( args['trace'] ) {
    for ( const op of report.results ) {
      if ( !op.trace?.length ) continue;
      console.log( '' );
      console.log( `  ${op.method} ${op.requestName} - ${op.trace.length} cases sent:` );
      for ( const t of op.trace ) {
        const mark = t.finding ? '✗' : '·';
        console.log( `    ${mark} HTTP ${t.status}  ${t.mutation.target} (${t.mutation.kind})` );
        console.log( `        req:  ${( t.request.body ?? '' ).slice( 0, 200 )}` );
        console.log( `        resp: ${( t.responseSample ?? '' ).replace( /\s+/g, ' ' ).slice( 0, 200 )}` );
      }
    }
  }

  if ( typeof args['output'] === 'string' ) {
    await writeFile( args['output'], JSON.stringify( report, null, 2 ), 'utf8' );
    console.log( `\n  Report written to ${args['output']}` );
  }
  if ( typeof args['html'] === 'string' ) {
    await writeFile( args['html'], fuzzReportToHtml( report, new Date().toISOString() ), 'utf8' );
    console.log( `  HTML report written to ${args['html']}` );
  }

  process.exit( report.totalFindings === 0 ? 0 : 1 );
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────

async function cmdWebhooks ( args: Record<string, string | boolean> ): Promise<void> {
  const wsArg = args['workspace'];
  if ( typeof wsArg !== 'string' ) { console.error( '  [error] --workspace <path> is required' ); process.exit( 2 ); }

  const { dir } = await loadWorkspace( wsArg );
  const hooks = await loadWebhookConfig( dir );

  if ( hooks.length === 0 ) {
    console.log( '  No webhooks configured. Create contracts/webhooks.json in the workspace:' );
    console.log( '' );
    console.log( '    {' );
    console.log( '      "webhooks": [' );
    console.log( '        {' );
    console.log( '          "name": "trigger provider CI",' );
    console.log( '          "url": "https://ci.example.com/api/trigger",' );
    console.log( '          "events": ["result-recorded", "deployment-recorded"],' );
    console.log( '          "headers": { "Authorization": "Bearer $CI_TOKEN" }' );
    console.log( '        }' );
    console.log( '      ]' );
    console.log( '    }' );
    console.log( '' );
    console.log( '  $NAME tokens are replaced from the serving process environment.' );
    console.log( '  The dashboard (`contract report --serve`) fires them when new results appear.' );
    return;
  }

  console.log( '' );
  for ( const h of hooks ) {
    console.log( `  ${h.name ?? '(unnamed)'}` );
    console.log( `    url:    ${h.url}` );
    console.log( `    events: ${h.events?.length ? h.events.join( ', ' ) : 'all'}` );
  }
  console.log( '' );

  if ( args['test'] ) {
    console.log( '  Sending test event...' );
    await fireWebhooks( hooks, {
      event: 'result-recorded',
      pacticipant: 'webhook-test',
      version: '0.0.0',
      passed: true,
      recordedAt: new Date().toISOString(),
    } );
  }
}

// ─── Dashboard report ─────────────────────────────────────────────────────────

async function cmdReport ( args: Record<string, string | boolean> ): Promise<void> {
  const wsArg = args['workspace'];
  if ( typeof wsArg !== 'string' ) { console.error( '  [error] --workspace <path> is required' ); process.exit( 2 ); }

  const { dir } = await loadWorkspace( wsArg );

  // ── Serve mode: read-only dashboard over HTTP ──────────────────────────────
  // Results are re-read from disk on every request, so recording a new run
  // (or `git pull`ing one) shows up on refresh with no restart. The server
  // never accepts writes: results only ever arrive via the filesystem/git.
  if ( args['serve'] ) {
    const port = typeof args['port'] === 'string' ? Number( args['port'] ) : 8080;
    if ( !Number.isInteger( port ) || port < 1 || port > 65535 ) {
      console.error( '  [error] --port must be a number between 1 and 65535' );
      process.exit( 2 );
    }
    const { createServer } = await import( 'http' );
    const server = createServer( async ( req, res ) => {
      try {
        const url = req.url ?? '/';
        if ( url === '/healthz' ) {
          res.writeHead( 200, { 'Content-Type': 'text/plain' } );
          res.end( 'ok' );
          return;
        }
        const records = await listResults( dir );
        const runMatch = /^\/run\/([^/]+)\/([^/]+)$/.exec( url );
        if ( runMatch ) {
          const pacticipant = decodeURIComponent( runMatch[1] );
          const version = decodeURIComponent( runMatch[2] );
          const rec = records.find( r => r.pacticipant === pacticipant && r.version === version );
          if ( !rec ) {
            res.writeHead( 404, { 'Content-Type': 'text/plain' } );
            res.end( 'No recorded result for that pacticipant/version' );
            return;
          }
          res.writeHead( 200, { 'Content-Type': 'text/html; charset=utf-8' } );
          res.end( reportToHtml( rec.report, {
            title: `${pacticipant} @ ${version}`,
            generatedAt: rec.recordedAt,
          } ) );
          return;
        }
        const environments = await listEnvironments( dir );
        res.writeHead( 200, { 'Content-Type': 'text/html; charset=utf-8' } );
        res.end( dashboardToHtml( records, new Date().toISOString(), { runLinkBase: '/run', environments } ) );
      } catch ( e ) {
        res.writeHead( 500, { 'Content-Type': 'text/plain' } );
        res.end( e instanceof Error ? e.message : String( e ) );
      }
    } );
    server.listen( port, () => {
      console.log( `  Contract dashboard serving at http://localhost:${port}` );
      console.log( `  Workspace: ${wsArg} (results re-read on every request)` );
      console.log( '  Read-only: record new results via `contract run --record`, then refresh.' );
    } );

    // Outbound webhooks: when contracts/webhooks.json exists, poll for new
    // results/deployments (written locally or arriving via git pull) and
    // notify the configured URLs. Inbound stays closed.
    const hooks = await loadWebhookConfig( dir );
    if ( hooks.length > 0 ) {
      const intervalMs = typeof args['webhook-interval'] === 'string'
        ? Math.max( 2, Number( args['webhook-interval'] ) ) * 1000
        : 10_000;
      watchContractEvents( dir, hooks, intervalMs );
      console.log( `  Webhooks: ${hooks.length} configured (polling every ${intervalMs / 1000}s)` );
    }
    return;
  }

  const out = typeof args['html'] === 'string' ? args['html'] : 'contract-dashboard.html';
  const records = await listResults( dir );
  const environments = await listEnvironments( dir );
  await writeFile( out, dashboardToHtml( records, new Date().toISOString(), { environments } ), 'utf8' );
  console.log( `  Dashboard with ${records.length} recorded result(s) written to ${out}` );
}

// ─── Pact interop ─────────────────────────────────────────────────────────────

async function cmdPactImport ( args: Record<string, string | boolean> ): Promise<void> {
  const file = args['file'];
  if ( typeof file !== 'string' ) { console.error( '  [error] --file <pact.json> is required' ); process.exit( 2 ); }

  const result = importPact( await readFile( file, 'utf8' ) );
  console.log( `  Imported ${result.requests.length} interaction(s): ${result.consumer} → ${result.provider} (spec ${result.specVersion})` );

  if ( typeof args['out'] === 'string' ) {
    const collection = pactToCollection( result );
    await writeFile( args['out'], JSON.stringify( collection, null, 2 ), 'utf8' );
    console.log( `  Collection written to ${args['out']}` );
    console.log( `  Set the "baseUrl" collection variable, then verify with:` );
    console.log( `    api-spector contract run --workspace <path> --mode provider-live --provider-base-url <url>` );
  }
}

async function cmdPactExport ( args: Record<string, string | boolean> ): Promise<void> {
  const wsArg = args['workspace'];
  const out = args['out'];
  if ( typeof wsArg !== 'string' ) { console.error( '  [error] --workspace <path> is required' ); process.exit( 2 ); }
  if ( typeof out !== 'string' ) { console.error( '  [error] --out <pact.json> is required' ); process.exit( 2 ); }

  const { workspace, dir } = await loadWorkspace( wsArg );
  const collectionName = typeof args['collection'] === 'string' ? args['collection'] : undefined;
  const collections = await loadCollections( workspace, dir, { filterName: collectionName } );
  const requests = collections.flatMap( c => Object.values( c.requests ) ).filter( r => hasContract( r.contract ) );

  if ( requests.length === 0 ) {
    console.error( '  [error] No requests with contracts found to export.' );
    process.exit( 2 );
  }

  const consumer = typeof args['consumer'] === 'string' ? args['consumer'] : ( collections[0]?.name ?? 'consumer' );
  const provider = typeof args['provider'] === 'string' ? args['provider'] : 'provider';
  const pact = exportPact( consumer, provider, requests );
  await writeFile( out, JSON.stringify( pact, null, 2 ), 'utf8' );
  console.log( `  Exported ${requests.length} interaction(s) to ${out} (${consumer} → ${provider})` );
}

// ─── Entry ───────────────────────────────────────────────────────────────────

async function main (): Promise<void> {
  const [, , sub, ...rest] = process.argv;
  const args = parseArgs( rest );

  if ( sub === 'list' ) return cmdList( args );
  if ( sub === 'pin' ) return cmdPin( args );
  if ( sub === 'run' ) return cmdRun( args );
  if ( sub === 'can-i-deploy' ) return cmdCanIDeploy( args );
  if ( sub === 'record-deployment' ) return cmdRecordDeployment( args );
  if ( sub === 'environments' ) return cmdEnvironments( args );
  if ( sub === 'webhooks' ) return cmdWebhooks( args );
  if ( sub === 'fuzz' ) return cmdFuzz( args );
  if ( sub === 'report' ) return cmdReport( args );
  if ( sub === 'pact-import' ) return cmdPactImport( args );
  if ( sub === 'pact-export' ) return cmdPactExport( args );

  if ( args['help'] || !sub ) {
    console.log( `
  api-spector contract list          --workspace <path>
  api-spector contract pin           --workspace <path> --spec-url <url> | --spec-path <file> [--name <label>]
  api-spector contract run           --workspace <path> --mode <consumer|provider|provider-live|bidirectional> [options]
  api-spector contract report        --workspace <path> [--html <path>] [--serve [--port <n>]]
  api-spector contract can-i-deploy  --workspace <path> --pacticipant <name> --app-version <ver> [--to <env>]
  api-spector contract record-deployment --workspace <path> --pacticipant <name> --app-version <ver> --env <name>
  api-spector contract environments  --workspace <path>
  api-spector contract webhooks      --workspace <path> [--test]
  api-spector contract fuzz          --workspace <path> --provider-base-url <url> [--snapshot <id> | --spec-url <url>] [--cases <n>] [--seed <n>] [--include-writes] [--trace] [--html <path>]
  api-spector contract pact-import   --file <pact.json> [--out <collection.json>]
  api-spector contract pact-export   --workspace <path> --out <pact.json> [--consumer <name> --provider <name> --collection <name>]

  Modes:
    consumer       Send requests to the real provider, assert each response (live).
    provider       Static check that requests conform to an OpenAPI spec (no HTTP).
    provider-live  Replay consumer contracts against a running provider, with
                   provider-state setup. The real Pact-style verification.
    bidirectional  Static spec/contract compatibility + live response check.

  Run options:
    --snapshot <id|name>      Pinned snapshot (run list to see IDs)
    --spec-url <url>          Live URL (fetched once for this run)
    --spec-path <path>        Local spec file
    --collection <name>       Filter to one collection
    --environment <name>      Environment for {{var}} resolution
    --request-base-url <url>  Strip this host before matching spec paths
    --provider-base-url <url> (provider-live) rebase requests onto this origin
    --states-url <url>        (provider-live) provider state handler endpoint
    --output <path>           Write ContractReport JSON here
    --junit <path>            Write JUnit XML here (for CI test reporters)
    --html <path>             Write a self-contained HTML report here
    --record                  Record the result for can-i-deploy gating
    --pacticipant <name>      Name to record under (default: collection name)
    --app-version <ver>       Version to record under (required with --record)
    --allow-pending           Failures of never-verified interactions report as
                              pending instead of blocking (exit 0)
`);
    return;
  }

  console.error( `  [error] Unknown subcommand "${sub}"` );
  process.exit( 2 );
}

main().catch( e => {
  console.error( `  [error] ${e instanceof Error ? e.message : String( e )}` );
  process.exit( 1 );
} );
