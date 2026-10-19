// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import type { RunnerPayload, RunnerItem, RunRequestResult, RunSummary } from '../../shared/types';
import { buildEnvVars } from '../interpolation';
import { getGlobals } from '../globals-store';
import { buildDispatcher, executeRunnerRequest, HookSkipTracker, type RunnerExecResult } from '../request-exec';
import { runPlanConcurrent } from '../../shared/run-concurrent';

// ─── IPC handler ─────────────────────────────────────────────────────────────

const sleep = ( ms: number ) => new Promise( resolve => setTimeout( resolve, ms ) );

export function registerRunnerHandler ( ipc: IpcMain ): void {
  handleIpc(ipc, IPC.runner.start, async ( event: IpcMainInvokeEvent, payload: RunnerPayload ) => {
    const { items, environment, globals: payloadGlobals, proxy, tls, piiMaskPatterns = [], requestDelay = 0 } = payload;
    const concurrency = Math.max( 1, Math.min( 20, Math.floor( payload.concurrency ?? 1 ) ) );

    const envVars = await buildEnvVars( environment );
    const liveGlobals = getGlobals();
    const globals = { ...payloadGlobals, ...liveGlobals };

    const dispatcher = await buildDispatcher( proxy, tls );

    const summary: RunSummary = { total: items.length, passed: 0, failed: 0, errors: 0, skipped: 0, durationMs: 0 };
    const totalStart = Date.now();

    // Running variable snapshot threaded through the run.
    let runEnvVars = { ...envVars };
    let runCollectionVars: Record<string, string> = {};
    let runGlobals = { ...globals };
    let runLocalVars: Record<string, string> = {};
    // Folder-scoped variables accumulated during the run, keyed by folder id, so
    // a value a script writes with sp.folder.set is seen by later requests in
    // the same folder (e.g. "Create" stores an id that "Retrieve" reads).
    const runFolderVars: Record<string, Record<string, string>> = {};

    const skipTracker = new HookSkipTracker();

    // ── Shared helpers ───────────────────────────────────────────────────────
    const meta = ( item: RunnerItem, index: number ) => ( {
      index, iterationLabel: item.iterationLabel,
      isHook: item.isHook, hookType: item.hookType, scopeId: item.scopeId,
      collection: item.collection, scopePath: item.scopePath,
    } );
    const emitRunning = ( item: RunnerItem, index: number ) =>
      event.sender.send( IPC.runner.progress, { requestId: item.request.id, status: 'running', ...meta( item, index ) } );
    const emitResult = ( item: RunnerItem, index: number, result: RunRequestResult ) =>
      event.sender.send( IPC.runner.progress, { ...result, ...meta( item, index ) } );
    const tally = ( status: RunRequestResult['status'] ) => {
      if ( status === 'passed' ) summary.passed++;
      else if ( status === 'failed' ) summary.failed++;
      else if ( status === 'skipped' ) summary.skipped++;
      else summary.errors++;
    };
    const skippedResult = ( item: RunnerItem, reason: string ): RunRequestResult => ( {
      requestId: item.request.id, name: item.request.name, method: item.request.method,
      resolvedUrl: item.request.url, status: 'failed', error: reason,
      isHook: item.isHook, hookType: item.hookType, scopeId: item.scopeId,
      collection: item.collection, scopePath: item.scopePath, iterationLabel: item.iterationLabel,
    } );

    // Run one item against the CURRENT snapshot (spread synchronously at call
    // time, so a concurrent caller captures a consistent starting point).
    const execItem = ( item: RunnerItem ): Promise<RunnerExecResult> => executeRunnerRequest( {
      req: item.request,
      collectionVars: { ...item.collectionVars, ...runCollectionVars },
      envVars: runEnvVars,
      globals: runGlobals,
      localVars: { ...runLocalVars, ...item.dataRow },
      folderVars: { ...( item.folderVars ?? {} ), ...( item.folderId ? runFolderVars[item.folderId] ?? {} : {} ) },
      dispatcher, piiMaskPatterns, proxy, tls,
      expectStatus: item.expectStatus, owaspTag: item.owaspTag,
    } );

    // Fold a completed item's variable writes back into the running snapshot.
    // `replace` honours deletes (sequential); `merge` preserves concurrent
    // writes made by other in-flight requests (parallel).
    const applyUpdates = ( item: RunnerItem, out: RunnerExecResult, mode: 'replace' | 'merge' ) => {
      if ( mode === 'replace' ) {
        runEnvVars = out.updatedEnvVars;
        runCollectionVars = out.updatedCollectionVars;
        runGlobals = out.updatedGlobals;
        runLocalVars = out.updatedLocalVars;
      } else {
        runEnvVars = { ...runEnvVars, ...out.updatedEnvVars };
        runCollectionVars = { ...runCollectionVars, ...out.updatedCollectionVars };
        runGlobals = { ...runGlobals, ...out.updatedGlobals };
        runLocalVars = { ...runLocalVars, ...out.updatedLocalVars };
      }
      if ( item.folderId ) {
        runFolderVars[item.folderId] = { ...( runFolderVars[item.folderId] ?? {} ), ...out.updatedFolderVars };
      }
    };

    if ( concurrency <= 1 ) {
      // ── Sequential (default) ─────────────────────────────────────────────
      for ( let i = 0; i < items.length; i++ ) {
        const item = items[i];
        const skipReason = skipTracker.shouldSkip( item );
        if ( skipReason ) {
          const skipped = skippedResult( item, skipReason );
          tally( skipped.status );
          emitResult( item, i, skipped );
          continue;
        }
        emitRunning( item, i );
        const out = await execItem( item );
        applyUpdates( item, out, 'replace' );
        skipTracker.recordResult( item, out.result.status );
        tally( out.result.status );
        emitResult( item, i, out.result );
        if ( requestDelay > 0 && i < items.length - 1 ) await sleep( requestDelay );
      }
    } else {
      // ── Parallel ─────────────────────────────────────────────────────────
      // Hooks are barriers (beforeAll finishes before the batch, afterAll runs
      // after); regular requests run up to `concurrency` at a time, each from
      // the current snapshot, with writes merged back as they complete.
      const runItem = async ( item: RunnerItem, index: number ): Promise<void> => {
        const skipReason = skipTracker.shouldSkip( item );
        if ( skipReason ) { const sk = skippedResult( item, skipReason ); tally( sk.status ); emitResult( item, index, sk ); return; }
        emitRunning( item, index );
        try {
          const out = await execItem( item );
          applyUpdates( item, out, 'merge' );
          skipTracker.recordResult( item, out.result.status );
          tally( out.result.status );
          emitResult( item, index, out.result );
        } catch ( err ) {
          const r: RunRequestResult = { ...skippedResult( item, err instanceof Error ? err.message : String( err ) ), status: 'error' };
          skipTracker.recordResult( item, 'error' );
          tally( 'error' );
          emitResult( item, index, r );
        }
      };
      await runPlanConcurrent( concurrency, items, it => Boolean( it.isHook ), runItem );
    }

    summary.durationMs = Date.now() - totalStart;
    return summary;
  } );
}
