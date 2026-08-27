// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { SecretsSettings } from '../../shared/types';

// Non-secret connection config for external secret managers, taken from the
// workspace (settings.secrets). Set once at run start; providers read it and let
// environment variables override, so the same workspace runs unchanged on a
// laptop (VAULT_ADDR + ~/.vault-token) and in CI (VAULT_ADDR + OIDC/AppRole).
let current: SecretsSettings | undefined;

export function setSecretsConfig(settings: SecretsSettings | undefined): void {
  current = settings;
}

export function getSecretsConfig(): SecretsSettings | undefined {
  return current;
}
