// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { KeyValuePair } from './types';

export interface SplitUrlResult {
  /** The URL with its query string removed. */
  url: string
  /** Existing params with the extracted query params merged in. */
  params: KeyValuePair[]
  /** True when a query string was actually extracted. */
  changed: boolean
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * Split a query string off a URL and merge its parameters into `existing`.
 * Used when a URL is pasted into the address bar so `?a=1&b=2` lands in the
 * Params tab instead of staying in the URL. Values are decoded here; the send
 * path re-encodes them, so the request on the wire is unchanged.
 *
 * Pasted keys win over existing rows with the same key; other existing rows are
 * kept. Blank existing rows (the trailing "add" row) are dropped.
 */
export function extractQueryParams(rawUrl: string, existing: KeyValuePair[]): SplitUrlResult {
  const qIdx = rawUrl.indexOf('?');
  if (qIdx === -1) return { url: rawUrl, params: existing, changed: false };

  const base = rawUrl.slice(0, qIdx);
  // A trailing #fragment is not part of the query; keep it out of the last value.
  let query = rawUrl.slice(qIdx + 1);
  let fragment = '';
  const hashIdx = query.indexOf('#');
  if (hashIdx !== -1) { fragment = query.slice(hashIdx); query = query.slice(0, hashIdx); }

  const parsed: KeyValuePair[] = [];
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = safeDecode(eq === -1 ? pair : pair.slice(0, eq));
    if (!key) continue;
    const value = eq === -1 ? '' : safeDecode(pair.slice(eq + 1));
    parsed.push({ key, value, enabled: true });
  }

  const nextUrl = base + fragment;
  if (parsed.length === 0) return { url: nextUrl, params: existing, changed: nextUrl !== rawUrl };

  const pastedKeys = new Set(parsed.map(p => p.key));
  const kept = (existing ?? []).filter(p => (p.key || p.value) && !pastedKeys.has(p.key));
  return { url: nextUrl, params: [...kept, ...parsed], changed: true };
}
