// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import type { RunnerPayload, RunRequestResult, RunSummary } from '../../shared/types';
import { buildEnvVars } from '../interpolation';
import { getGlobals } from '../globals-store';
import { buildDispatcher, executeRunnerRequest, HookSkipTracker } from '../request-exec';

// ─── IPC handler ─────────────────────────────────────────────────────────────

const sleep = ( ms: number ) => new Promise( resolve => setTimeout( resolve, ms ) );

export function registerRunnerHandler ( ipc: IpcMain ): void {
  handleIpc(ipc, IPC.runner.start, async ( event: IpcMainInvokeEvent, payload: RunnerPayload ) => {
    const { items, environment, globals: payloadGlobals, proxy, tls, piiMaskPatterns = [], requestDelay = 0 } = payload;

    const envVars = await buildEnvVars( environment );
    const liveGlobals = getGlobals();
    const globals = { ...payloadGlobals, ...liveGlobals };

    const dispatcher = await buildDispatcher( proxy, tls );

    const summary: RunSummary = { total: items.length, passed: 0, failed: 0, errors: 0, skipped: 0, durationMs: 0 };
    const totalStart = Date.now();

    let runEnvVars = { ...envVars };
    let runCollectionVars: Record<string, string> = {};
    let runGlobals = { ...globals };
    let runLocalVars: Record<string, string> = {};

    const skipTracker = new HookSkipTracker();

    for ( const item of items ) {
      // ── Determine whether to skip this item ─────────────────────────────
      const skipReason = skipTracker.shouldSkip( item );

      if ( skipReason ) {
        const skipped: RunRequestResult = {
          requestId: item.request.id,
          name: item.request.name,
          method: item.request.method,
          resolvedUrl: item.request.url,
          status: 'failed',
          error: skipReason,
          isHook: item.isHook,
          hookType: item.hookType,
          scopeId: item.scopeId,
          scopePath: item.scopePath,
          iterationLabel: item.iterationLabel,
        };
        summary.failed++;
        event.sender.send( IPC.runner.progress, skipped );
        continue;
      }

      // ── Run the item ────────────────────────────────────────────────────
      const runningUpdate: Partial<RunRequestResult> = {
        status: 'running', iterationLabel: item.iterationLabel,
        isHook: item.isHook, hookType: item.hookType, scopeId: item.scopeId,
        scopePath: item.scopePath,
      };
      event.sender.send( IPC.runner.progress, { requestId: item.request.id, ...runningUpdate } );

      const { result, updatedEnvVars, updatedCollectionVars, updatedGlobals, updatedLocalVars } = await executeRunnerRequest( {
        req: item.request,
        collectionVars: { ...item.collectionVars, ...runCollectionVars },
        envVars: runEnvVars,
        globals: runGlobals,
        localVars: { ...runLocalVars, ...( item.dataRow ?? {} ) },
        dispatcher,
        piiMaskPatterns,
        proxy,
        tls,
      } );

      runEnvVars = updatedEnvVars;
      runCollectionVars = updatedCollectionVars;
      runGlobals = updatedGlobals;
      runLocalVars = updatedLocalVars;

      // ── Post-run: propagate failures ────────────────────────────────────
      skipTracker.recordResult( item, result.status );

      if ( result.status === 'passed' ) summary.passed++;
      else if ( result.status === 'failed' ) summary.failed++;
      else if ( result.status === 'skipped' ) summary.skipped++;
      else summary.errors++;

      event.sender.send( IPC.runner.progress, {
        ...result, iterationLabel: item.iterationLabel,
        isHook: item.isHook, hookType: item.hookType, scopeId: item.scopeId,
        scopePath: item.scopePath,
      } );

      if ( requestDelay > 0 && item !== items[items.length - 1] ) {
        await sleep( requestDelay );
      }
    }

    summary.durationMs = Date.now() - totalStart;
    return summary;
  } );
}
