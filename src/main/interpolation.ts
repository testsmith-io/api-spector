// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

import type { Environment, KeyValuePair } from '../shared/types';
import { decryptSecret } from './ipc/secret-handler';

/** Replace {{var}} placeholders with values from the merged vars map. */
export function interpolate(str: string, vars: Record<string, string>): string {
  return str.replace(/\{\{([^}]+)\}\}/g, (_, key) => vars[key.trim()] ?? `{{${key}}}`);
}

/** Build a URL with resolved query params appended. */
export function buildUrl(
  baseUrl: string,
  params: KeyValuePair[],
  vars: Record<string, string>
): string {
  const url = interpolate(baseUrl, vars);
  const enabled = params.filter(p => p.enabled && p.key);
  if (!enabled.length) return url;
  const sep = url.includes('?') ? '&' : '?';
  const qs = enabled
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
          // Wrong password or corrupted — skip
        }
      }
    } else {
      vars[v.key] = v.value;
    }
  }
  return vars;
}

/** Merge all variable scopes. Local vars win everything. */
export function mergeVars(
  envVars: Record<string, string>,
  collectionVars: Record<string, string>,
  globals: Record<string, string>,
  localVars: Record<string, string> = {}
): Record<string, string> {
  return { ...globals, ...collectionVars, ...envVars, ...localVars };
}
