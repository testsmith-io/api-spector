// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { Environment, KeyValuePair } from '../shared/types';
import { decryptSecret } from './ipc/secret-handler';
import type { faker as FakerType } from '@faker-js/faker';
import dayjs from 'dayjs';
import * as vm from 'vm';

let _fakerCache: { faker: typeof FakerType } | null = null;
async function getFaker(): Promise<typeof FakerType> {
  if (!_fakerCache) _fakerCache = await import('@faker-js/faker');
  return _fakerCache.faker;
}

/** Populated after first buildDynamicVars() call; used by interpolate() for inline expressions. */
let _exprContext: Record<string, unknown> | null = null;

/**
 * Built-in dynamic variables resolved fresh on every request send.
 * Available as {{$uuid}}, {{$isoTimestamp}}, {{$randomEmail}}, etc.
 */
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

/** Replace {{var}} placeholders with values from the merged vars map.
 *  Tokens that don't match a variable and look like expressions (contain `.` or `(`)
 *  are evaluated with faker and dayjs in scope when available. */
export function interpolate(str: string, vars: Record<string, string>): string {
  return str.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmed = key.trim();
    if (trimmed in vars) return vars[trimmed];
    // Try evaluating as an expression (e.g. faker.internet.email(), dayjs().format(...))
    if (_exprContext && (trimmed.includes('.') || trimmed.includes('('))) {
      try {
        const result = vm.runInNewContext(trimmed, _exprContext);
        if (result !== undefined && result !== null) return String(result);
      } catch {
        // Not a valid expression — fall through to unresolved
      }
    }
    return match;
  });
}

/** Build a URL with resolved query params appended. */
export function buildUrl(
  baseUrl: string,
  params: KeyValuePair[],
  vars: Record<string, string>
): string {
  // Detect which keys appear as `{{name}}` tokens in the URL template, so we
  // can route param rows correctly without depending on the user remembering
  // to flip a dropdown. A row is treated as a path substitution iff:
  //   - it's enabled and has a key
  //   - AND either paramType === 'path' OR its key appears in the URL template
  // Everything else gets appended as a query string parameter.
  const templateTokens = new Set<string>();
  baseUrl.replace(/\{\{([^}]+)\}\}/g, (_m, name) => {
    templateTokens.add(String(name).trim());
    return '';
  });

  const enabled = params.filter(p => p.enabled && p.key);
  const pathRows: KeyValuePair[] = [];
  const queryRows: KeyValuePair[] = [];
  for (const p of enabled) {
    const isPath = p.paramType === 'path' || templateTokens.has(p.key);
    if (isPath) pathRows.push(p);
    else queryRows.push(p);
  }

  // Merge path rows into the var scope (per-request priority) before
  // interpolating the URL, so `/pets/{{id}}` resolves from a row in the
  // request's params table.
  const mergedVars = pathRows.length
    ? {
      ...vars,
      ...Object.fromEntries(pathRows.map(p => [p.key, interpolate(p.value, vars)])),
    }
    : vars;

  const url = interpolate(baseUrl, mergedVars);

  if (!queryRows.length) return url;
  const sep = url.includes('?') ? '&' : '?';
  const qs = queryRows
    .map(p => `${encodeURIComponent(interpolate(p.key, vars))}=${encodeURIComponent(interpolate(p.value, vars))}`)
    .join('&');
  return url + sep + qs;
}

/** Resolve all environment variables, decrypting encrypted secrets when a master key is set. */
export async function buildEnvVars(environment: Environment | null): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};
  if (!environment) return vars;
  const masterKey = process.env['API_SPECTOR_MASTER_KEY'];
  for (const v of environment.variables) {
    if (!v.enabled) continue;
    if (v.envRef) {
      // OS environment variable — read from process.env at send-time
      const envValue = process.env[v.envRef];
      if (envValue !== undefined) vars[v.key] = envValue;
    } else if (v.secret && v.secretEncrypted && v.secretSalt && v.secretIv) {
      // AES-256-GCM encrypted secret
      if (masterKey) {
        try {
          vars[v.key] = decryptSecret(v.secretEncrypted, v.secretSalt, v.secretIv, masterKey);
        } catch {
          // Wrong password or corrupted — fall through to env fallback
        }
      }
      // CLI / CI context: secret injected as environment variable (e.g. from GitHub Secrets)
      if (vars[v.key] === undefined && process.env[v.key] !== undefined) {
        vars[v.key] = process.env[v.key]!;
      }
    } else if (v.secret) {
      // Secret with no stored ciphertext — check process.env (CI / CLI context)
      if (process.env[v.key] !== undefined) {
        vars[v.key] = process.env[v.key]!;
      }
    } else {
      vars[v.key] = v.value;
    }
  }
  return vars;
}

/** Merge all variable scopes. Local vars win everything; dynamic vars are the base layer. */
export function mergeVars(
  envVars: Record<string, string>,
  collectionVars: Record<string, string>,
  globals: Record<string, string>,
  localVars: Record<string, string> = {},
  dynamicVars: Record<string, string> = {}
): Record<string, string> {
  return { ...dynamicVars, ...globals, ...collectionVars, ...envVars, ...localVars };
}
