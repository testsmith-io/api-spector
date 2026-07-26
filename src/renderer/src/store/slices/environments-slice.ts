// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Environment } from '../../../../shared/types';
import { uniqueName } from '../../../../shared/naming-utils';
import type { FullState } from '../index';

/** Hand-rolled env slug — intentionally kept byte-compatible with the paths
 *  this store has always written (it differs slightly from naming-utils'
 *  `envRelPath` around punctuation, and changing it would orphan files). */
function envSlugRelPath(name: string): string {
  return `environments/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.env.json`;
}

export interface EnvironmentsSliceState {
  environments: Record<string, { relPath: string; data: Environment }>
  activeEnvironmentId: string | null
}

export interface EnvironmentsSliceActions {
  loadEnvironment: (relPath: string, data: Environment) => void
  setActiveEnvironment: (id: string | null) => void
  updateEnvironment: (id: string, data: Environment) => void
  /** Set a plain (non-secret) variable on an environment, updating it if the
   *  key exists or appending it otherwise, then persist the env to disk.
   *  Used by "create environment variable" UI (e.g. from a response header). */
  upsertEnvVar: (envId: string, key: string, value: string) => void
  addEnvironment: () => void
  duplicateEnvironment: (id: string) => void
  deleteEnvironment: (id: string) => void
}

export type EnvironmentsSlice = EnvironmentsSliceState & EnvironmentsSliceActions

export const createEnvironmentsSlice: StateCreator<
  FullState,
  [['zustand/immer', never]],
  [],
  EnvironmentsSlice
> = (set, get) => ({
  environments: {},
  activeEnvironmentId: localStorage.getItem('activeEnvironmentId') ?? null,

  loadEnvironment: (relPath, data) => set(s => {
    s.environments[data.id] = { relPath, data };
  }),

  setActiveEnvironment: id => set(s => {
    s.activeEnvironmentId = id;
    if (id) localStorage.setItem('activeEnvironmentId', id);
    else localStorage.removeItem('activeEnvironmentId');
  }),

  updateEnvironment: (id, data) => set(s => {
    if (s.environments[id]) s.environments[id].data = data;
  }),

  upsertEnvVar: (envId, key, value) => {
    set(s => {
      const env = s.environments[envId]?.data;
      if (!env) return;
      const existing = env.variables.find(v => v.key === key && !v.secret);
      if (existing) existing.value = value;
      else env.variables.push({ key, value, enabled: true });
    });
    const entry = get().environments[envId];
    if (entry) {
      window.electron.saveEnvironment(entry.relPath, entry.data).catch((err: unknown) => {
        console.warn('upsertEnvVar: could not save environment', entry.relPath, err);
      });
    }
  },

  addEnvironment: () => set(s => {
    const existingNames = Object.values(s.environments).map(e => e.data.name);
    const envName = uniqueName('New Environment', existingNames);
    const env: Environment = {
      version: '1.0',
      id: uuidv4(),
      name: envName,
      variables: [],
    };
    const relPath = envSlugRelPath('New Environment');
    s.environments[env.id] = { relPath, data: env };
    s.activeEnvironmentId = env.id;
    if (s.workspace) s.workspace.environments.push(relPath);
  }),

  duplicateEnvironment: (id) => set(s => {
    const src = s.environments[id];
    if (!src) return;
    const existingNames = Object.values(s.environments).map(e => e.data.name);
    const newName = uniqueName(src.data.name + ' (copy)', existingNames);
    const newId   = uuidv4();
    // Deep-clone variables; secrets are stored by reference (key) so we
    // copy the reference too — the same OS keychain entry can back both
    // environments without re-prompting.
    const env: Environment = {
      ...JSON.parse(JSON.stringify(src.data)),
      id: newId,
      name: newName,
    };
    const relPath = envSlugRelPath(newName);
    s.environments[env.id] = { relPath, data: env };
    s.activeEnvironmentId = env.id;
    if (s.workspace) s.workspace.environments.push(relPath);
  }),

  deleteEnvironment: (id) => {
    const relPath = get().environments[id]?.relPath;
    if (relPath) {
      window.electron.deleteWorkspaceFile(relPath).catch((err: unknown) => {
        console.warn('deleteEnvironment: could not remove file', relPath, err);
      });
    }
    set(s => {
      delete s.environments[id];
      if (s.activeEnvironmentId === id) s.activeEnvironmentId = null;
      if (relPath && s.workspace) {
        s.workspace.environments = s.workspace.environments.filter(p => p !== relPath);
      }
    });
  },
});
