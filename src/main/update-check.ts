// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Best-effort "is there a newer release on npm?" check. Network-optional: any
// failure (offline, timeout, rate limit) resolves to null so the caller simply
// shows nothing. The only outbound call is to the public npm registry.

const REGISTRY_URL = 'https://registry.npmjs.org/@testsmith/api-spector/latest';

export interface UpdateInfo {
  current: string
  latest: string
  updateAvailable: boolean
  command: string
}

/** Numeric semver comparison. Returns true when `a` is strictly newer than `b`.
 *  Pre-release tags are ignored (compared on the numeric core only). */
export function isNewer(a: string, b: string): boolean {
  const core = (v: string) => v.split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const [a0, a1, a2] = core(a);
  const [b0, b1, b2] = core(b);
  if (a0 !== b0) return a0 > b0;
  if (a1 !== b1) return a1 > b1;
  return a2 > b2;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const current = __APP_VERSION__;
  if (!current) return null;
  try {
    const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    const latest = data.version;
    if (!latest) return null;
    return {
      current,
      latest,
      updateAvailable: isNewer(latest, current),
      command: 'npm update -g @testsmith/api-spector',
    };
  } catch {
    return null;
  }
}
