// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { SecretsSettings } from '../../shared/types';

// Non-secret connection config for external secret managers, from the workspace
// (settings.secrets). Env vars override, so the same workspace runs on a laptop or CI.
let current: SecretsSettings | undefined;

export function setSecretsConfig(settings: SecretsSettings | undefined): void {
  current = settings;
}

export function getSecretsConfig(): SecretsSettings | undefined {
  return current;
}
