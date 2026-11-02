// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT
//
// Cloud-synced workspace: push/pull the whole workspace through API Spector
// Cloud so teams without git can work together. The main process serializes the
// workspace to a secret-free snapshot and applies pulled snapshots to disk; this
// orchestrates the network calls and tracks the per-workspace sync state
// (mode + cloud id + base version) in workspace.settings.sync.
//
// The caller must reload the workspace (useWorkspaceLoader().reloadWorkspace)
// after a successful pull/restore, since those rewrite files on disk.

import { useStore } from '../store';
import type { Workspace } from '../../../shared/types';

const { electron } = window;

export type SyncMode = 'local' | 'git' | 'cloud';
export interface SyncSettings { mode: SyncMode; cloudWorkspaceId?: number; baseVersion?: number }

/** The current workspace's sync settings (defaults to git, the standard model). */
export function getSyncSettings(): SyncSettings {
  return useStore.getState().workspace?.settings?.sync ?? { mode: 'git' };
}

async function persistSync(patch: Partial<SyncSettings>): Promise<void> {
  const s = useStore.getState();
  const ws = s.workspace;
  if (!ws) return;
  const sync: SyncSettings = { ...(ws.settings?.sync ?? { mode: 'cloud' }), ...patch };
  const settings = { ...ws.settings, sync };
  s.updateWorkspaceSettings(settings);
  await electron.saveWorkspace({ ...ws, settings });
}

/** Change the sync backend for this workspace (git is the default). */
export async function setSyncMode(mode: SyncMode): Promise<void> {
  await persistSync({ mode });
}

function workspaceName(manifestName: string): string {
  return manifestName.replace(/\.(spector|json)$/i, '') || 'Workspace';
}

/** Persist all in-memory workspace state to disk before a push. The app keeps
 *  collections/flows dirty until saved, and the cloud snapshot is built FROM
 *  disk — so without this, a push would ship stale (or empty) files. */
async function flushToDisk(): Promise<void> {
  const s = useStore.getState();
  for (const { relPath, data, dirty } of Object.values(s.collections)) {
    if (!dirty) continue;
    await electron.saveCollection(relPath, data);
    s.markCollectionClean(data.id);
  }
  for (const { relPath, data } of Object.values(s.environments)) {
    await electron.saveEnvironment(relPath, data);
  }
  for (const { relPath, data } of Object.values(s.flows)) {
    await electron.saveFlow(relPath, data);
  }
  if (s.workspace) await electron.saveWorkspace(s.workspace);
}

export type PushOutcome =
  | { ok: true; version: number; collections: number; flows: number }
  | { ok: false; conflict: true; currentVersion?: number };

/** Push the local workspace to the cloud. Creates the cloud workspace on first
 *  push; afterwards a version guard rejects the push if someone else pushed. */
export async function pushWorkspace(): Promise<PushOutcome> {
  const sync = getSyncSettings();
  await flushToDisk();                 // capture current (unsaved) work before serializing
  const snap = await electron.serializeWorkspace();

  const files = snap.files ?? {};
  const collections = Object.keys(files).filter(p => p.startsWith('collections/')).length;
  const flows = Object.keys(files).filter(p => p.startsWith('flows/')).length;

  if (!sync.cloudWorkspaceId) {
    const created = await electron.cloudWorkspaceCreate({ name: workspaceName(snap.manifestName), payload: snap });
    await persistSync({ mode: 'cloud', cloudWorkspaceId: created.id, baseVersion: created.version });
    return { ok: true, version: created.version, collections, flows };
  }

  const res = await electron.cloudWorkspacePush({
    id: sync.cloudWorkspaceId,
    baseVersion: sync.baseVersion ?? 0,
    payload: snap,
  });
  if (res.conflict) return { ok: false, conflict: true, currentVersion: res.currentVersion };
  await persistSync({ baseVersion: res.version });
  return { ok: true, version: res.version ?? 0, collections, flows };
}

/** Pull the latest snapshot and write it to disk (merging local secrets). The
 *  caller MUST reload the workspace afterwards. */
export async function pullWorkspace(): Promise<{ version: number; filesWritten: number; collections: number; workspace: Workspace; workspacePath: string }> {
  const sync = getSyncSettings();
  if (!sync.cloudWorkspaceId) {
    throw new Error('This workspace is not linked to a cloud workspace yet. Push it first, or link an existing one.');
  }
  const remote = await electron.cloudWorkspacePull(sync.cloudWorkspaceId);
  const payload = (remote.payload ?? {}) as { manifest?: Workspace; files?: Record<string, string> };
  if (!payload.manifest || !payload.files) {
    throw new Error('The cloud workspace has no snapshot yet. Push from a populated workspace first.');
  }
  const applied = await electron.applyWorkspaceSnapshot({ manifest: payload.manifest, files: payload.files });
  // NOTE: do NOT persist sync settings here — saveWorkspace would write the
  // stale in-memory workspace back over the manifest we just applied. The caller
  // loads `workspace` into the store first, then calls markPulled(version).
  return {
    version: remote.version,
    filesWritten: applied.filesWritten,
    collections: applied.collections,
    workspace: applied.workspace,
    workspacePath: applied.workspacePath,
  };
}

/** Record the pulled version in sync settings. Call AFTER the pulled workspace
 *  has been loaded into the store, so saveWorkspace persists the merged manifest
 *  (not the pre-pull one). */
export async function markPulled(version: number): Promise<void> {
  await persistSync({ baseVersion: version });
}

/** List the org's cloud workspaces (to join an existing shared one). */
export async function listCloudWorkspaces() {
  const res = await electron.cloudWorkspaceList();
  return res.workspaces;
}

/** Link this local workspace to an existing cloud workspace. The caller then
 *  pulls + reloads to bring its content down. */
export async function linkToCloudWorkspace(id: number): Promise<void> {
  await persistSync({ mode: 'cloud', cloudWorkspaceId: id, baseVersion: 0 });
}
