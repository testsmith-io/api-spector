// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

export interface ProxyConfigInput {
  url: string
  auth?: { username: string; password: string }
}

/**
 * Normalize user-provided proxy URL into a URL that undici ProxyAgent accepts.
 * Handles common Windows/manual formats:
 * - "proxy.local:8080"            -> "http://proxy.local:8080/"
 * - "http=proxy:8080;https=..."   -> picks https, then http, then first token
 */
export function buildProxyUri(proxy: ProxyConfigInput): string {
  const raw = proxy.url.trim();
  if (!raw) throw new Error('Proxy URL is empty');

  const normalized = normalizeProxyInput(raw);
  const parsed = new URL(normalized);

  if (proxy.auth && (proxy.auth.username || proxy.auth.password)) {
    parsed.username = proxy.auth.username;
    parsed.password = proxy.auth.password;
  }

  return parsed.toString();
}

function normalizeProxyInput(input: string): string {
  if (input.includes('=')) {
    const entries = input
      .split(';')
      .map(part => part.trim())
      .filter(Boolean);

    const map = new Map<string, string>();
    for (const part of entries) {
      const idx = part.indexOf('=');
      if (idx <= 0 || idx === part.length - 1) continue;
      const key = part.slice(0, idx).trim().toLowerCase();
      const value = part.slice(idx + 1).trim();
      if (value) map.set(key, value);
    }

    const picked = map.get('https') ?? map.get('http') ?? map.values().next().value;
    if (picked) return ensureScheme(picked);
  }

  return ensureScheme(input);
}

function ensureScheme(value: string): string {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value) ? value : `http://${value}`;
}
