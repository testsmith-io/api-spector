#!/usr/bin/env node
// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

/**
 * API Spector contract CLI
 *
 * Usage:
 *   api-spector contract list --workspace <path>
 *   api-spector contract run  --workspace <path> --mode <mode> [options]
 *
 *   Modes: consumer | provider | bidirectional
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
 */

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { Workspace, ApiRequest, ContractSnapshot, ContractMode, ContractReport } from '../shared/types';
import { runConsumerContracts, hasContract } from '../main/contract/consumer-verifier';
import { runProviderVerification } from '../main/contract/provider-verifier';
import { runLiveProviderVerification } from '../main/contract/provider-live-verifier';
import { runBidirectional } from '../main/contract/bidirectional';
import { listSnapshots } from '../main/contract/snapshots';
import { toJUnitXml } from '../main/contract/report-formats';
import { reportToHtml, dashboardToHtml } from '../main/contract/html-report';
import { recordResult, canIDeploy, listResults } from '../main/contract/results-store';
import { importPact, pactToCollection, exportPact } from '../main/contract/pact-format';
import { writeFile as fsWriteFile } from 'fs/promises';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { parseArgs, loadWorkspace, loadCollections, loadEnvironments } from './cli-common';

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
    console.log( '    api-spector contract run --workspace <path> --spec-url <url> --pin' );
    return;
  }

  // Pretty table
  console.log( '' );
  console.log( '  ID       Name                                Version     Captured' );
  console.log( '  ──────── ─────────────────────────────────── ─────────── ──────────────────' );
  for ( const { snapshot } of snapshots ) {
    const id = snapshot.id.slice( 0, 8 );
    const name = snapshot.name.slice( 0, 35 ).padEnd( 35 );
    const version = ( snapshot.specVersion ?? '—' ).slice( 0, 11 ).padEnd( 11 );
    const when = snapshot.capturedAt.slice( 0, 19 ).replace( 'T', ' ' );
    console.log( `  ${id} ${name} ${version} ${when}` );
  }
  console.log( '' );
  console.log( '  Run against a snapshot:' );
  console.log( '    api-spector contract run --workspace <path> --mode provider --snapshot <id>' );
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
  const activeEnv = envName ? envs.find( e => e.name === envName ) : envs[0];
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
      report = await runProviderVerification( allRequests, envVars, specUrl, specPath, requestBaseUrl );
      break;
    case 'provider-live':
      report = await runLiveProviderVerification( contractRequests, envVars, collectionVars, providerBaseUrl, stateHandlerUrl );
      break;
    case 'bidirectional':
      report = await runBidirectional( contractRequests, envVars, collectionVars, specUrl, specPath, requestBaseUrl );
      break;
  }

  // Summary
  console.log( '' );
  if ( report.failed === 0 ) {
    console.log( `  ✓ All ${report.passed}/${report.total} passed in ${report.durationMs}ms` );
  } else {
    console.log( `  ✗ ${report.failed}/${report.total} failed (${report.passed} passed) in ${report.durationMs}ms` );
    console.log( '' );
    for ( const r of report.results.filter( r => !r.passed ) ) {
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

  const { dir } = await loadWorkspace( wsArg );
  const verdict = await canIDeploy( dir, pacticipant, appVersion );

  console.log( '' );
  console.log( verdict.deployable ? `  ✓ Computer says yes — safe to deploy.` : `  ✗ Computer says no.` );
  console.log( `  ${verdict.reason}` );
  process.exit( verdict.deployable ? 0 : 1 );
}

// ─── Dashboard report ─────────────────────────────────────────────────────────

async function cmdReport ( args: Record<string, string | boolean> ): Promise<void> {
  const wsArg = args['workspace'];
  if ( typeof wsArg !== 'string' ) { console.error( '  [error] --workspace <path> is required' ); process.exit( 2 ); }
  const out = typeof args['html'] === 'string' ? args['html'] : 'contract-dashboard.html';

  const { dir } = await loadWorkspace( wsArg );
  const records = await listResults( dir );
  await writeFile( out, dashboardToHtml( records, new Date().toISOString() ), 'utf8' );
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
  if ( sub === 'run' ) return cmdRun( args );
  if ( sub === 'can-i-deploy' ) return cmdCanIDeploy( args );
  if ( sub === 'report' ) return cmdReport( args );
  if ( sub === 'pact-import' ) return cmdPactImport( args );
  if ( sub === 'pact-export' ) return cmdPactExport( args );

  if ( args['help'] || !sub ) {
    console.log( `
  api-spector contract list          --workspace <path>
  api-spector contract run           --workspace <path> --mode <consumer|provider|provider-live|bidirectional> [options]
  api-spector contract report        --workspace <path> [--html <path>]
  api-spector contract can-i-deploy  --workspace <path> --pacticipant <name> --app-version <ver>
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
