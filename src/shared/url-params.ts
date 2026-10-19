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

// An `[name]` path placeholder (API Spector style; deliberately not Bruno's
// `:id` and not the `{{var}}` used for variables). The name must start with a
// letter or underscore, so an IPv6 host literal like `[::1]` never matches.
const PATH_PARAM_RE = /\[([A-Za-z_]\w*)\]/g;

/** Names of the `[name]` path placeholders in a URL, in order, de-duplicated. */
export function extractPathParamNames(url: string): string[] {
  const names: string[] = [];
  for (const m of url.matchAll(PATH_PARAM_RE)) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

/** Names referenced by either a `[name]` placeholder or a `{{name}}` token. */
function referencedNames(url: string): Set<string> {
  const names = new Set(extractPathParamNames(url));
  for (const m of url.matchAll(/\{\{([^}]+)\}\}/g)) names.add(m[1].trim());
  return names;
}

/**
 * Reconcile the Params tab with the URL, Bruno-style:
 *  - a `?a=1&b=2` query string is moved into query-param rows (via
 *    {@link extractQueryParams}); the send path re-appends them, so the wire
 *    request is unchanged;
 *  - each `[name]` in the path gets a path-param row (preserving a value the
 *    user already typed for it);
 *  - auto-added path rows that are now empty and no longer referenced in the URL
 *    are pruned, so editing or removing a `[name]` keeps the table in sync.
 * Query rows and rows the user gave a value are never removed.
 */
export function syncParamsFromUrl(rawUrl: string, existing: KeyValuePair[]): SplitUrlResult {
  const q = extractQueryParams(rawUrl, existing);
  const url = q.url;
  let changed = q.changed;

  const pathNames = extractPathParamNames(url);
  const referenced = referencedNames(url);

  // Prune empty, unreferenced path rows (e.g. after renaming [id] -> [userId]).
  let params = q.params.filter(p => {
    if (p.paramType === 'path' && !p.value && p.key && !referenced.has(p.key)) {
      changed = true;
      return false;
    }
    return true;
  });

  // Add a path row for every :name not already in the table.
  const have = new Set(params.filter(p => p.key).map(p => p.key));
  const additions: KeyValuePair[] = pathNames
    .filter(n => !have.has(n))
    .map(n => ({ key: n, value: '', enabled: true, paramType: 'path' as const }));
  if (additions.length) {
    changed = true;
    params = [...params, ...additions];
  }

  return { url, params, changed };
}
