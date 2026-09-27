// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Central registry of localStorage keys used by the renderer, so the literal
// strings live in one place (typo-safe, greppable). These are per-machine UI
// preferences only — nothing here travels with the workspace.
export const STORAGE_KEYS = {
  theme:              'theme',
  zoom:               'zoom',
  activeEnvironmentId: 'activeEnvironmentId',
  runHooks:           'runHooks',
  gitPullRebase:      'apiSpector.git.pullRebase',
  ai:                 'apiSpector.ai',
  updateSkipped:      'apiSpectorUpdateSkipped',
} as const;
