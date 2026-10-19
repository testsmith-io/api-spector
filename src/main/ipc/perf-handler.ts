// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// IPC for Performance (load) testing. The load generation runs in a dedicated
// utilityProcess (perf-worker) so a heavy run never blocks the main event loop
// (IPC, menus, dialogs stay responsive). This handler resolves env vars in the
// main process (OS keychain), hands the run to the worker, relays live progress
// to the renderer, resolves with the aggregate, aborts on perf:stop, and
// exports an HTML report. The orchestration itself lives in perf-run.ts (shared
// with the CLI, which runs it directly in its own process).

import { type IpcMain, type IpcMainInvokeEvent, dialog, utilityProcess, type UtilityProcess } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import { type PerfRunPayload } from '../perf-run';
import { buildEnvVars } from '../interpolation';
import { perfReportToHtml, type PerfReportMeta } from '../perf-report';
import type { PerfResult } from '../../shared/types';

// One run at a time; keep the child so perf:stop can signal it.
let child: UtilityProcess | null = null;

function runInWorker(payload: PerfRunPayload, onProgress: (p: unknown) => void): Promise<PerfResult> {
  return new Promise<PerfResult>((resolve, reject) => {
    // Bundled alongside this file at out/main/perf-worker.js.
    const proc = utilityProcess.fork(join(__dirname, 'perf-worker.js'));
    child = proc;
    let settled = false;
    const done = () => { settled = true; if (child === proc) child = null; try { proc.kill(); } catch { /* ignore */ } };

    proc.on('message', (msg: { type: string; p?: unknown; result?: PerfResult; message?: string }) => {
      if (msg.type === 'progress') { onProgress(msg.p); return; }
      if (msg.type === 'result') { done(); resolve(msg.result as PerfResult); return; }
      if (msg.type === 'error') { done(); reject(new Error(msg.message || 'Load test failed')); return; }
    });
    proc.on('exit', () => { if (!settled) { if (child === proc) child = null; reject(new Error('Load test worker exited unexpectedly')); } });

    proc.postMessage({ type: 'run', payload });
  });
}

export function registerPerfHandlers(ipc: IpcMain): void {
  handleIpc(ipc, IPC.perf.run, async (event: IpcMainInvokeEvent, payload: PerfRunPayload): Promise<PerfResult> => {
    // Resolve env vars here (the worker can't reach the OS keychain), so a
    // sequence/flow run gets fully-resolved values and the worker stays Node-only.
    if ((payload.plan.target.kind === 'sequence' || payload.plan.target.kind === 'flow') && !payload.resolvedEnvVars) {
      payload.resolvedEnvVars = await buildEnvVars(payload.environment ?? null);
    }
    return runInWorker(payload, (p) => { if (!event.sender.isDestroyed()) event.sender.send(IPC.perf.progress, p); });
  });

  handleIpc(ipc, IPC.perf.stop, async () => { child?.postMessage({ type: 'stop' }); });

  handleIpc(ipc, IPC.perf.exportHtml, async (_e, result: PerfResult, meta: PerfReportMeta = {}): Promise<boolean> => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save performance report',
      defaultPath: `perf-report-${(meta.planName ?? 'run').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (canceled || !filePath) return false;
    await writeFile(filePath, perfReportToHtml(result, { generatedAt: new Date().toISOString(), ...meta }), 'utf8');
    return true;
  });
}
