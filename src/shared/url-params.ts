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

/** Split a URL's query string into Params rows: values are decoded here and the send
 *  path re-encodes them (wire request unchanged); pasted keys win, blank rows dropped. */
export function extractQueryParams(rawUrl: string, existing: KeyValuePair[]): SplitUrlResult {
  const qIdx = rawUrl.indexOf('?');
  if (qIdx === -1) return { url: rawUrl, params: existing, changed: false };

  const base = rawUrl.slice(0, qIdx);
  // A trailing #fragment is not part of the query.
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

// Path placeholders `[name]` / `{name}` / `:name`, never the `{{var}}` token: name must
// start with a letter/underscore (so `[::1]`, `:3900`, `://` never match). Name is group 1/2/3.
export const PATH_PARAM_PATTERN = String.raw`\[([A-Za-z_]\w*)\]|(?<!\{)\{([A-Za-z_]\w*)\}(?!\})|:([A-Za-z_]\w*)`;
const PATH_PARAM_RE = new RegExp(PATH_PARAM_PATTERN, 'g');

// Resolve `{{name}}` tokens from a value map, leaving unknown tokens as-is.
// Display-only: unlike the send path's interpolate(), it does not evaluate
// faker()/dayjs() expressions, so it stays pure and renderer-safe.
function interpTokens(str: string, vars: Record<string, string>): string {
  return str.replaceAll(/\{\{([^}]+)\}\}/g, (m, key) => {
    const k = String(key).trim();
    return k in vars ? vars[k] : m;
  });
}

/** Preview the final request URL like the send path's buildUrl (query rows URL-encoded,
 *  path / `{{name}}` / `[name]` substituted), but pure: expressions are not evaluated. */
export function buildPreviewUrl(
  baseUrl: string,
  params: KeyValuePair[],
  varValues: Record<string, string> = {},
): string {
  const templateTokens = new Set<string>();
  for (const m of baseUrl.matchAll(/\{\{([^}]+)\}\}/g)) templateTokens.add(m[1].trim());
  for (const m of baseUrl.matchAll(PATH_PARAM_RE)) templateTokens.add(m[1] ?? m[2] ?? m[3]);

  const enabled = (params ?? []).filter(p => p.enabled && p.key);
  const pathRows  = enabled.filter(p => p.paramType === 'path' || templateTokens.has(p.key));
  const queryRows = enabled.filter(p => !(p.paramType === 'path' || templateTokens.has(p.key)));

  const scope: Record<string, string> = { ...varValues };
  for (const p of pathRows) scope[p.key] = interpTokens(p.value, varValues);

  let url = interpTokens(baseUrl, scope);
  url = url.replaceAll(PATH_PARAM_RE, (m: string, g1?: string, g2?: string, g3?: string) => { const name = g1 ?? g2 ?? g3 ?? ''; return name in scope ? scope[name] : m; });

  if (!queryRows.length) return url;
  const sep = url.includes('?') ? '&' : '?';
  const qs = queryRows
    .map(p => `${encodeURIComponent(interpTokens(p.key, varValues))}=${encodeURIComponent(interpTokens(p.value, varValues))}`)
    .join('&');
  return url + sep + qs;
}

/** Names of the `[name]` / `{name}` / `:name` path placeholders in a URL, in order, de-duplicated. */
export function extractPathParamNames(url: string): string[] {
  const names: string[] = [];
  for (const m of url.matchAll(PATH_PARAM_RE)) {
    const name = m[1] ?? m[2] ?? m[3];
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Names referenced by either a `[name]` placeholder or a `{{name}}` token. */
function referencedNames(url: string): Set<string> {
  const names = new Set(extractPathParamNames(url));
  for (const m of url.matchAll(/\{\{([^}]+)\}\}/g)) names.add(m[1].trim());
  return names;
}

/** Reconcile Params with the URL: extract query rows, add a path row per `[name]`
 *  (keeping typed values), and prune empty path rows no longer referenced. */
export function syncParamsFromUrl(rawUrl: string, existing: KeyValuePair[]): SplitUrlResult {
  const q = extractQueryParams(rawUrl, existing);
  const url = q.url;
  let changed = q.changed;

  const pathNames = extractPathParamNames(url);
  const referenced = referencedNames(url);

  // Prune empty, unreferenced path rows, e.g. after renaming [id] to [userId].
  let params = q.params.filter(p => {
    if (p.paramType === 'path' && !p.value && p.key && !referenced.has(p.key)) {
      changed = true;
      return false;
    }
    return true;
  });

  // Add a path row for every name not already in the table.
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
