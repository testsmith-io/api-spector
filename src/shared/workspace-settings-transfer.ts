// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Export a workspace's settings to a portable file and import them into another
// workspace. Only the shareable settings travel: the machine/identity-local
// cloud (connection state), sync (per-workspace backend) and proxy (network- and
// machine-specific, and may carry a credential) blocks are dropped, so the file
// is safe to hand to someone else. (TLS cert paths stay - they are config, not
// secrets.) Collections, environments, mocks and the like are NOT part of this -
// it is the Workspace Settings block only.

import type { Workspace } from './types';

export type WorkspaceSettings = NonNullable<Workspace['settings']>;

export const WORKSPACE_SETTINGS_FILE_TYPE = 'api-spector-workspace-settings';
export const WORKSPACE_SETTINGS_FILE_VERSION = 1;

// Keys that must never travel in a settings file: cloud ties to one
// account/device, sync to one workspace's backend, and proxy is network/machine
// specific and can carry a username/password.
const LOCAL_ONLY_KEYS: readonly (keyof WorkspaceSettings)[] = ['cloud', 'sync', 'proxy'];

export interface WorkspaceSettingsFile {
  type: typeof WORKSPACE_SETTINGS_FILE_TYPE;
  version: number;
  /** ISO timestamp of when the file was written; informational only. */
  exportedAt?: string;
  settings: WorkspaceSettings;
}

/** The shareable subset of a workspace's settings: everything except the
 *  machine/identity-local cloud, sync and proxy blocks. */
export function portableSettings(settings: WorkspaceSettings | undefined): WorkspaceSettings {
  const out: WorkspaceSettings = { ...(settings ?? {}) };
  for (const k of LOCAL_ONLY_KEYS) delete out[k];
  return out;
}

/** Build the envelope written to disk on export. `exportedAt` is passed in so
 *  this stays clock-free (the caller stamps it). */
export function buildSettingsFile(settings: WorkspaceSettings | undefined, exportedAt?: string): WorkspaceSettingsFile {
  return {
    type: WORKSPACE_SETTINGS_FILE_TYPE,
    version: WORKSPACE_SETTINGS_FILE_VERSION,
    ...(exportedAt ? { exportedAt } : {}),
    settings: portableSettings(settings),
  };
}

/** Parse and validate an exported file's text. Throws a user-facing Error when
 *  it is not a workspace settings file; otherwise returns the settings it
 *  carries, with any local-only keys defensively stripped. */
export function parseSettingsFile(text: string): WorkspaceSettings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('This is not a workspace settings file.');
  const file = parsed as Partial<WorkspaceSettingsFile>;
  if (file.type !== WORKSPACE_SETTINGS_FILE_TYPE) throw new Error('This is not a workspace settings file.');
  if (!file.settings || typeof file.settings !== 'object') throw new Error('The settings file has nothing to import.');
  return portableSettings(file.settings as WorkspaceSettings);
}

/** Merge imported settings over the current ones. The current workspace keeps
 *  its own cloud and sync blocks (the imported portable settings never carry
 *  them), so importing settings never repoints this workspace's sync or cloud. */
export function mergeSettings(current: WorkspaceSettings | undefined, imported: WorkspaceSettings): WorkspaceSettings {
  return { ...(current ?? {}), ...portableSettings(imported) };
}
