// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';

// Resolve an external-secret reference from values injected into the environment,
// typically by a CI step that already read them from the secret manager (for
// example a GitLab component that logs in to Vault with its role and exports the
// values as job variables). When a reference is covered here, the backend
// network call is skipped, so the SAME `{{vault:path#key}}` reference that talks
// to Vault locally is served from the pipeline-provided value in CI, with no
// change to the collection.
//
// Lookups are keyed by the FULL reference string exactly as written in the
// workspace, e.g. "vault:secret/data/app#token". All sources are optional and
// absent by default, so local runs are unaffected. In order:
//
//   1. API_SPECTOR_SECRETS        inline JSON   { "<ref>": "<value>", ... }
//   2. API_SPECTOR_SECRETS_FILE   path to a JSON file of the same shape
//   3. API_SPECTOR_SECRET_ENV_MAP inline JSON   { "<ref>": "<ENV_VAR_NAME>", ... }
//                                 value is taken from process.env[ENV_VAR_NAME]

type Dict = Record<string, string>;

function parseDict(raw: string | undefined): Dict | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: Dict = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

// Cache parsed maps so several references in one run do not re-parse or re-read
// the file. Keyed by the controlling raw string, so a change (rare, in a
// long-lived UI process) invalidates the entry.
const cache = new Map<string, { key: string; dict: Dict | null }>();

function cached(name: string, rawKey: string, build: () => Dict | null): Dict | null {
  const hit = cache.get(name);
  if (hit && hit.key === rawKey) return hit.dict;
  const dict = build();
  cache.set(name, { key: rawKey, dict });
  return dict;
}

function valuesInline(): Dict | null {
  const raw = process.env['API_SPECTOR_SECRETS'];
  return cached('inline', raw ?? '', () => parseDict(raw));
}

function valuesFromFile(): Dict | null {
  const path = process.env['API_SPECTOR_SECRETS_FILE'];
  return cached('file', path ?? '', () => {
    if (!path) return null;
    try {
      return parseDict(readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  });
}

function envNameMap(): Dict | null {
  const raw = process.env['API_SPECTOR_SECRET_ENV_MAP'];
  return cached('envmap', raw ?? '', () => parseDict(raw));
}

/** The injected value for a full reference string, or undefined when nothing in
 *  the environment covers it (the caller then falls back to the real provider). */
export function injectedSecret(ref: string): string | undefined {
  const direct = valuesInline();
  if (direct && typeof direct[ref] === 'string') return direct[ref];

  const file = valuesFromFile();
  if (file && typeof file[ref] === 'string') return file[ref];

  const map = envNameMap();
  if (map && typeof map[ref] === 'string') {
    const value = process.env[map[ref]];
    if (value !== undefined && value !== '') return value;
  }

  return undefined;
}
