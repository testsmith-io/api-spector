// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { Environment, KeyValuePair } from '../shared/types';
import { decryptSecret } from './ipc/secret-handler';
import { hasSecretScheme, resolveExternalSecret } from './secrets';
import { PATH_PARAM_PATTERN } from '../shared/url-params';
import type { faker as FakerType } from '@faker-js/faker';
import dayjs from 'dayjs';
import * as vm from 'node:vm';

// `[name]` / `{name}` path-parameter placeholders (shared with url-params).
const PATH_PARAM_RE = new RegExp(PATH_PARAM_PATTERN, 'g');

let _fakerCache: { faker: typeof FakerType } | null = null;
async function getFaker(): Promise<typeof FakerType> {
  _fakerCache ??= await import('@faker-js/faker');
  return _fakerCache.faker;
}

/** Populated after first buildDynamicVars() call; used by interpolate() for inline expressions. */
let _exprContext: Record<string, unknown> | null = null;

/** Built-in dynamic variables ({{$uuid}}, {{$isoTimestamp}}, {{$randomEmail}}, …), fresh per send. */
export async function buildDynamicVars(): Promise<Record<string, string>> {
  const faker = await getFaker();
  const now   = dayjs();
  _exprContext = { faker, dayjs };
  return {
    $uuid:            faker.string.uuid(),
    $timestamp:       String(Date.now()),
    $isoTimestamp:    now.toISOString(),
    $randomInt:       String(faker.number.int({ min: 0, max: 1000 })),
    $randomFloat:     String(faker.number.float({ min: 0, max: 1000, fractionDigits: 2 })),
    $randomBoolean:   String(faker.datatype.boolean()),
    $randomEmail:     faker.internet.email(),
    $randomUsername:  faker.internet.username(),
    $randomPassword:  faker.internet.password(),
    $randomFullName:  faker.person.fullName(),
    $randomFirstName: faker.person.firstName(),
    $randomLastName:  faker.person.lastName(),
    $randomWord:      faker.lorem.word(),
    $randomPhrase:    faker.lorem.sentence(),
    $randomUrl:       faker.internet.url(),
    $randomIp:        faker.internet.ip(),
    $randomHexColor:  faker.color.rgb({ format: 'hex', casing: 'lower' }),
  };
}

/** Replace {{var}} placeholders from the merged vars map. Unmatched tokens that
 *  look like expressions (contain `.` or `(`) are evaluated with faker and dayjs in scope. */
export function interpolate(str: string, vars: Record<string, string>): string {
  // One level of `{...}` is allowed inside the token so object-arg expressions
  // resolve, e.g. {{faker.date.between({ from: '…', to: '…' })}}.
  return str.replaceAll(/\{\{\s*((?:[^{}]|\{[^{}]*\})+?)\s*\}\}/g, (match, key) => {
    const trimmed = key.trim();
    if (trimmed in vars) return vars[trimmed];
    if (_exprContext && (trimmed.includes('.') || trimmed.includes('('))) {
      try {
        const result = vm.runInNewContext(trimmed, _exprContext);
        if (result !== undefined && result !== null) return String(result);
      } catch {
        // Not a valid expression: leave unresolved.
      }
    }
    return match;
  });
}

/** Interpolate each DataSet cell value against `scope`, so a data table can use
 *  {{baseUrl}}, {{$randomEmail}}, {{faker.person.firstName()}}, etc. */
export function resolveDataRow(row: Record<string, string>, scope: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, typeof v === 'string' ? interpolate(v, scope) : v]),
  );
}

/** Build a URL with resolved query params appended. */
export function buildUrl(
  baseUrl: string,
  params: KeyValuePair[],
  vars: Record<string, string>
): string {
  // A row routes to the path when it's enabled, has a key, and either
  // paramType === 'path' or its key appears as a `{{name}}` token in the URL.
  // Everything else is appended as a query parameter.
  const templateTokens = new Set<string>();
  baseUrl.replaceAll(/\{\{\s*((?:[^{}]|\{[^{}]*\})+?)\s*\}\}/g, (_m, name) => {
    templateTokens.add(String(name).trim());
    return '';
  });
  // `[name]` / `{name}` / `:name` path placeholders route their row to the path.
  baseUrl.replaceAll(PATH_PARAM_RE, (_m, g1, g2, g3) => {
    templateTokens.add(g1 ?? g2 ?? g3);
    return '';
  });

  const enabled = (params ?? []).filter(p => p.enabled && p.key);
  const pathRows: KeyValuePair[] = [];
  const queryRows: KeyValuePair[] = [];
  for (const p of enabled) {
    const isPath = p.paramType === 'path' || templateTokens.has(p.key);
    if (isPath) pathRows.push(p);
    else queryRows.push(p);
  }

  // Merge path rows into the var scope before interpolating, so `/pets/{{id}}`
  // resolves from a row in the request's params table.
  const mergedVars = pathRows.length
    ? {
      ...vars,
      ...Object.fromEntries(pathRows.map(p => [p.key, interpolate(p.value, vars)])),
    }
    : vars;

  // Substitute `{{name}}` then `[name]` / `{name}` / `:name`; an unresolvable
  // placeholder is left as-is.
  let url = interpolate(baseUrl, mergedVars);
  url = url.replaceAll(PATH_PARAM_RE, (m, g1, g2, g3) => {
    const name = g1 ?? g2 ?? g3;
    return name in mergedVars ? mergedVars[name] : m;
  });

  if (!queryRows.length) return url;
  const sep = url.includes('?') ? '&' : '?';
  const qs = queryRows
    .map(p => `${encodeURIComponent(interpolate(p.key, vars))}=${encodeURIComponent(interpolate(p.value, vars))}`)
    .join('&');
  return url + sep + qs;
}

/** Swap a request URL's origin (and optional base path) for `baseUrl`, keeping its
 *  path and query. Lets the same contracts run against localhost/staging/prod.
 *  Returns the original URL when no base is given. */
export function rebaseUrl(fullUrl: string, baseUrl?: string): string {
  if (!baseUrl) return fullUrl;
  try {
    const orig = new URL(fullUrl, 'http://placeholder.invalid');
    const base = new URL(baseUrl);
    const basePath = base.pathname.replace(/\/$/, '');
    base.pathname = (basePath + orig.pathname).replaceAll(/\/{2,}/g, '/');
    base.search = orig.search;
    return base.toString();
  } catch {
    return fullUrl;
  }
}

/** Resolve all environment variables, decrypting encrypted secrets when a master key is set. */
export async function buildEnvVars(environment: Environment | null): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};
  if (!environment) return vars;
  const masterKey = process.env['API_SPECTOR_MASTER_KEY'];
  // External secrets resolve in a second pass so a secret ref can interpolate a
  // {{var}} defined anywhere in this environment, not only above it.
  const deferredSecretRefs: { key: string; ref: string }[] = [];
  for (const v of environment.variables) {
    if (!v.enabled) continue;
    if (v.secretRef && hasSecretScheme(v.secretRef)) {
      deferredSecretRefs.push({ key: v.key, ref: v.secretRef });
    } else if (v.envRef) {
      // OS environment variable, read at send-time.
      const envValue = process.env[v.envRef];
      if (envValue !== undefined) vars[v.key] = envValue;
    } else if (v.secret && v.secretEncrypted && v.secretSalt && v.secretIv) {
      // AES-256-GCM encrypted secret
      if (masterKey) {
        try {
          vars[v.key] = decryptSecret(v.secretEncrypted, v.secretSalt, v.secretIv, masterKey);
        } catch {
          // Wrong password or corrupted: fall through to env fallback.
        }
      }
      // CLI / CI: secret injected as an environment variable.
      if (vars[v.key] === undefined && process.env[v.key] !== undefined) {
        vars[v.key] = process.env[v.key]!;
      }
    } else if (v.secret) {
      // Secret with no stored ciphertext: check process.env (CI / CLI).
      if (process.env[v.key] !== undefined) {
        vars[v.key] = process.env[v.key]!;
      }
    } else {
      vars[v.key] = v.value;
    }
  }
  // Second pass: external secrets, with the plain vars as the scope a provider
  // interpolates against. A failure warns and leaves the var unset rather than aborting.
  for (const { key, ref } of deferredSecretRefs) {
    try {
      const resolved = await resolveExternalSecret(ref, { vars });
      if (resolved !== null) vars[key] = resolved;
    } catch (err) {
      console.warn(`[secrets] could not resolve ${key} (${ref}): ${(err as Error).message}`);
    }
  }
  return vars;
}

/** Resolve inline secret-manager tokens ({{vault:path#key}}, {{op://...}}, …) once,
 *  keyed by the full reference so a later {{...}} substitution picks it up. Runs
 *  up-front because interpolate() is synchronous. Throws if a secret can't be resolved. */
export async function resolveInlineSecretRefs(
  text: string,
  vars?: Record<string, string>,
): Promise<Record<string, string>> {
  const refs = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
    const inner = m[1].trim();
    if (hasSecretScheme(inner)) refs.add(inner);
  }
  if (refs.size === 0) return {};

  const out: Record<string, string> = {};
  await Promise.all([...refs].map(async (ref) => {
    // Pass the var scope so a provider can interpolate {{var}} inside the reference path.
    const value = await resolveExternalSecret(ref, { vars });
    if (value !== null) out[ref] = value;
  }));
  return out;
}

export function mergeVars(
  envVars: Record<string, string>,
  collectionVars: Record<string, string>,
  globals: Record<string, string>,
  localVars: Record<string, string> = {},
  dynamicVars: Record<string, string> = {},
  folderVars: Record<string, string> = {}
): Record<string, string> {
  // Precedence low->high: dynamic < globals < env < collection < folder < local.
  // null/undefined = unset: skip it, so it can't shadow a lower scope or render
  // as the literal "null" (serialized defs can carry real nulls).
  const out: Record<string, string> = {};
  for (const src of [dynamicVars, globals, envVars, collectionVars, folderVars, localVars]) {
    for (const [k, v] of Object.entries(src ?? {})) {
      if (v == null) continue;
      out[k] = v;
    }
  }
  return out;
}
