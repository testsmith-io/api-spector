// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { type IpcMain, dialog } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import { writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { ContractRunPayload, ContractReport, ContractSnapshot } from '../../shared/types';
import { runConsumerContracts }   from '../contract/consumer-verifier';
import { runProviderVerification } from '../contract/provider-verifier';
import { runLiveProviderVerification } from '../contract/provider-live-verifier';
import { runBidirectional }       from '../contract/bidirectional';
import { inferSchemaFromJson }    from '../contract/schema-inferrer';
import { reportToHtml, type ReportMeta } from '../contract/html-report';
import {
  captureSnapshot, listSnapshots, loadSnapshot, deleteSnapshot, relPathOf,
} from '../contract/snapshots';
import { getWorkspaceDir } from './file-handler';
import { validateContractRunPayload } from './ipc-validate';

/** If the caller picked a pinned snapshot, materialize it to a temp file so
 *  the existing provider-verifier flow (which wants a URL or a file path)
 *  doesn't need to change. Returns `{ specPath }` to feed back into the payload. */
async function resolveSnapshotSpec(relPath: string): Promise<{ specPath: string }> {
  const dir = getWorkspaceDir();
  if (!dir) throw new Error('No workspace open — cannot resolve snapshot.');
  const snap = await loadSnapshot(dir, relPath);
  const tmp = join(tmpdir(), `api-spector-${randomUUID()}.${snap.format === 'yaml' ? 'yaml' : 'json'}`);
  await writeFile(tmp, snap.spec, 'utf8');
  return { specPath: tmp };
}

export function registerContractHandlers(ipc: IpcMain): void {
  handleIpc(ipc, IPC.contract.run, async (_e, payload: ContractRunPayload): Promise<ContractReport> => {
    validateContractRunPayload(payload);
    const { mode, requests, envVars, collectionVars = {}, requestBaseUrl, providerBaseUrl, stateHandlerUrl } = payload;
    let { specUrl, specPath } = payload;

    if (payload.specSnapshotRelPath) {
      const resolved = await resolveSnapshotSpec(payload.specSnapshotRelPath);
      specPath = resolved.specPath;
      specUrl  = undefined;
    }

    switch (mode) {
      case 'consumer':
        return runConsumerContracts(requests, envVars, collectionVars);
      case 'provider':
        return runProviderVerification(requests, envVars, specUrl, specPath, requestBaseUrl);
      case 'provider-live':
        return runLiveProviderVerification(requests, envVars, collectionVars, providerBaseUrl, stateHandlerUrl);
      case 'bidirectional':
        return runBidirectional(requests, envVars, collectionVars, specUrl, specPath, requestBaseUrl);
    }
  });

  handleIpc(ipc, IPC.contract.inferSchema, (_e, jsonBody: string): string | null => {
    const schema = inferSchemaFromJson(jsonBody);
    return schema ? JSON.stringify(schema, null, 2) : null;
  });

  // Export a verification run as a self-contained HTML report (save dialog).
  handleIpc(ipc, IPC.contract.exportReportHtml, async (
    _e,
    report: ContractReport,
    meta: ReportMeta = {},
  ): Promise<boolean> => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save contract report',
      defaultPath: `contract-report-${report.mode}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (canceled || !filePath) return false;
    await writeFile(filePath, reportToHtml(report, { generatedAt: new Date().toISOString(), ...meta }), 'utf8');
    return true;
  });

  // ── Snapshots (pinned spec versions) ───────────────────────────────────────

  handleIpc(ipc, IPC.contract.captureSnapshot, async (
    _e,
    opts: { specUrl?: string; specPath?: string; name?: string },
  ): Promise<{ relPath: string; snapshot: ContractSnapshot }> => {
    const dir = getWorkspaceDir();
    if (!dir) throw new Error('No workspace open — cannot capture snapshot.');
    const snapshot = await captureSnapshot(dir, opts);
    const relPath  = relPathOf(snapshot);
    if (!relPath) throw new Error('Snapshot created but relPath was not attached.');
    return { relPath, snapshot };
  });

  handleIpc(ipc, IPC.contract.listSnapshots, async (
    _e,
    registered: string[] = [],
  ): Promise<Array<{ relPath: string; snapshot: ContractSnapshot }>> => {
    const dir = getWorkspaceDir();
    if (!dir) return [];
    return listSnapshots(dir, registered);
  });

  handleIpc(ipc, IPC.contract.loadSnapshot, async (_e, relPath: string): Promise<ContractSnapshot> => {
    const dir = getWorkspaceDir();
    if (!dir) throw new Error('No workspace open.');
    return loadSnapshot(dir, relPath);
  });

  handleIpc(ipc, IPC.contract.deleteSnapshot, async (_e, relPath: string): Promise<void> => {
    const dir = getWorkspaceDir();
    if (!dir) return;
    await deleteSnapshot(dir, relPath);
  });
}
