// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { type IpcMain } from 'electron';
import { writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { ContractRunPayload, ContractReport, ContractSnapshot } from '../../shared/types';
import { runConsumerContracts }   from '../contract/consumer-verifier';
import { runProviderVerification } from '../contract/provider-verifier';
import { runBidirectional }       from '../contract/bidirectional';
import { inferSchemaFromJson }    from '../contract/schema-inferrer';
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
  ipc.handle('contract:run', async (_e, payload: ContractRunPayload): Promise<ContractReport> => {
    validateContractRunPayload(payload);
    const { mode, requests, envVars, collectionVars = {}, requestBaseUrl } = payload;
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
      case 'bidirectional':
        return runBidirectional(requests, envVars, collectionVars, specUrl, specPath, requestBaseUrl);
    }
  });

  ipc.handle('contract:inferSchema', (_e, jsonBody: string): string | null => {
    const schema = inferSchemaFromJson(jsonBody);
    return schema ? JSON.stringify(schema, null, 2) : null;
  });

  // ── Snapshots (pinned spec versions) ───────────────────────────────────────

  ipc.handle('contract:captureSnapshot', async (
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

  ipc.handle('contract:listSnapshots', async (
    _e,
    registered: string[] = [],
  ): Promise<Array<{ relPath: string; snapshot: ContractSnapshot }>> => {
    const dir = getWorkspaceDir();
    if (!dir) return [];
    return listSnapshots(dir, registered);
  });

  ipc.handle('contract:loadSnapshot', async (_e, relPath: string): Promise<ContractSnapshot> => {
    const dir = getWorkspaceDir();
    if (!dir) throw new Error('No workspace open.');
    return loadSnapshot(dir, relPath);
  });

  ipc.handle('contract:deleteSnapshot', async (_e, relPath: string): Promise<void> => {
    const dir = getWorkspaceDir();
    if (!dir) return;
    await deleteSnapshot(dir, relPath);
  });
}
