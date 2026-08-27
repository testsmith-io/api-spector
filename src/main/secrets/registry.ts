// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { SecretProvider, SecretResolveContext } from './types';

// Registry of external-secret providers, keyed by reference scheme. New backends
// register here; the resolver dispatches by the scheme prefix of a reference.
const providers = new Map<string, SecretProvider>();

export function registerSecretProvider(provider: SecretProvider): void {
  providers.set(provider.scheme.toLowerCase(), provider);
}

export function registeredSchemes(): string[] {
  return [...providers.keys()];
}

// The scheme of a reference, e.g. `vault` for `vault:secret/data/app#token`.
// A reference has a scheme only when it starts with `<scheme>:` AND that scheme
// is registered — so ordinary keychain / env-var refs (which have no scheme) are
// never misread as external references.
function schemeOf(ref: string): string | null {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(ref);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  return providers.has(scheme) ? scheme : null;
}

export function hasSecretScheme(ref: string): boolean {
  return schemeOf(ref) !== null;
}

// Resolve a scheme-prefixed reference through its provider. Returns null when the
// reference has no registered scheme (caller falls back to keychain / env).
export async function resolveExternalSecret(
  ref: string,
  ctx: SecretResolveContext = {},
): Promise<string | null> {
  const scheme = schemeOf(ref);
  if (!scheme) return null;

  const provider = providers.get(scheme)!;
  const refBody = ref.slice(scheme.length + 1);
  return provider.resolve(refBody, ctx);
}
