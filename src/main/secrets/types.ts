// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Pluggable external-secret backends. A provider resolves a scheme-prefixed
// reference (e.g. `vault:secret/data/app#token`) to a secret value at run time.
// HashiCorp Vault is the first provider; adding another backend (AWS Secrets
// Manager, Azure Key Vault, GCP Secret Manager, ...) is just implementing this
// interface and registering it — nothing in the run/interpolation pipeline
// changes. Providers must stay free of Electron imports so the engine build
// (out/main/lib.js, used by the cloud runtime) can use them.

export interface SecretResolveContext {
  /** Reserved for future per-request scoping (profile selection, etc.). */
  readonly profile?: string
}

export interface SecretProvider {
  /** The reference scheme this provider handles, e.g. `vault` — the part
   *  before the first `:` in a reference. Lower-case. */
  readonly scheme: string

  /** Resolve the reference body (everything after `scheme:`) to a secret value.
   *  Should throw a clear Error on misconfiguration or lookup failure. */
  resolve(refBody: string, ctx: SecretResolveContext): Promise<string>
}
