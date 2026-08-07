// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { KeyValuePair, AuthConfig, RequestBody, HttpMethod } from './types';

// ─── cURL command importer ────────────────────────────────────────────────────
//
// Parses a `curl` command line (as copied from a browser's "Copy as cURL", the
// terminal, or docs) into the fields of an ApiRequest. Best-effort: unknown
// flags are ignored rather than rejected, so a partial command still imports.

/** Flags that take an argument we deliberately consume-and-drop. */
const SKIP_WITH_ARG = new Set([
  '--connect-timeout', '--max-time', '-m', '--retry', '--resolve', '--cacert',
  '--cert', '--key', '--proxy', '-x', '--output', '-o', '--write-out', '-w',
]);

/** Split a shell-ish command into tokens, honouring quotes and line escapes. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let inTok = false;
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i];
    // Line-continuation backslash (possibly CRLF): swallow it.
    if (c === '\\' && (input[i + 1] === '\n' || input[i + 1] === '\r')) {
      i += input[i + 1] === '\r' && input[i + 2] === '\n' ? 3 : 2;
      continue;
    }
    if (c === "'") {
      inTok = true; i++;
      while (i < n && input[i] !== "'") cur += input[i++];
      i++; // closing quote
      continue;
    }
    if (c === '"') {
      inTok = true; i++;
      while (i < n && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < n && `"\\$\``.includes(input[i + 1])) { cur += input[i + 1]; i += 2; }
        else cur += input[i++];
      }
      i++; // closing quote
      continue;
    }
    if (/\s/.test(c)) {
      if (inTok) { tokens.push(cur); cur = ''; inTok = false; }
      i++;
      continue;
    }
    if (c === '\\' && i + 1 < n) { cur += input[i + 1]; i += 2; inTok = true; continue; }
    cur += c; inTok = true; i++;
  }
  if (inTok) tokens.push(cur);
  return tokens;
}

function looksJson(s: string): boolean {
  const t = s.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return false;
  try { JSON.parse(t); return true; } catch { return false; }
}

function decodeBasic(b64: string): { username: string; password: string } | null {
  try {
    const decoded = typeof atob === 'function'
      ? atob(b64)
      : Buffer.from(b64, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx === -1) return null;
    return { username: decoded.slice(0, idx), password: decoded.slice(idx + 1) };
  } catch { return null; }
}

export interface ParsedCurl {
  name: string
  method: HttpMethod
  url: string
  headers: KeyValuePair[]
  params: KeyValuePair[]
  auth: AuthConfig
  body: RequestBody
}

/** Parse a curl command. Throws only if no URL can be found. */
export function parseCurl(command: string): ParsedCurl {
  const tokens = tokenize(command.trim());
  if (tokens[0] === 'curl') tokens.shift();

  let method: string | null = null;
  let url = '';
  let user: string | null = null;
  let forceGet = false;
  const headers: KeyValuePair[] = [];
  const dataParts: string[] = [];
  const formParts: string[] = [];

  const next = (i: number): string => tokens[i + 1] ?? '';

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t) {
      case '-X': case '--request': method = next(i); i++; break;
      case '-H': case '--header': {
        const raw = next(i); i++;
        const idx = raw.indexOf(':');
        if (idx > 0) headers.push({ key: raw.slice(0, idx).trim(), value: raw.slice(idx + 1).trim(), enabled: true });
        break;
      }
      case '-u': case '--user': user = next(i); i++; break;
      case '-d': case '--data': case '--data-raw': case '--data-ascii': case '--data-binary':
        dataParts.push(next(i)); i++; break;
      case '--data-urlencode': dataParts.push(next(i)); i++; break;
      case '-F': case '--form': formParts.push(next(i)); i++; break;
      case '-b': case '--cookie': headers.push({ key: 'Cookie', value: next(i), enabled: true }); i++; break;
      case '-A': case '--user-agent': headers.push({ key: 'User-Agent', value: next(i), enabled: true }); i++; break;
      case '-e': case '--referer': headers.push({ key: 'Referer', value: next(i), enabled: true }); i++; break;
      case '--url': url = next(i); i++; break;
      case '-G': case '--get': forceGet = true; break;
      case '-I': case '--head': method = method ?? 'HEAD'; break;
      default:
        if (SKIP_WITH_ARG.has(t)) { i++; break; }
        if (t.startsWith('-')) break;      // some other flag we ignore
        if (!url) url = t;                 // first bare token is the URL
        break;
    }
  }

  if (!url) throw new Error('No URL found in the curl command.');

  const hasData = dataParts.length > 0;
  const isForm = formParts.length > 0;
  const resolvedMethod = (forceGet ? 'GET' : method ?? (hasData || isForm ? 'POST' : 'GET')).toUpperCase();

  // Auth: -u wins; otherwise fold an Authorization header into structured auth.
  let auth: AuthConfig = { type: 'none' };
  if (user) {
    const idx = user.indexOf(':');
    auth = { type: 'basic', username: idx === -1 ? user : user.slice(0, idx), password: idx === -1 ? '' : user.slice(idx + 1) };
  } else {
    const authIdx = headers.findIndex(h => h.key.toLowerCase() === 'authorization');
    if (authIdx !== -1) {
      const v = headers[authIdx].value;
      if (/^Bearer\s+/i.test(v)) { auth = { type: 'bearer', token: v.replace(/^Bearer\s+/i, '') }; headers.splice(authIdx, 1); }
      else if (/^Basic\s+/i.test(v)) {
        const creds = decodeBasic(v.replace(/^Basic\s+/i, '').trim());
        if (creds) { auth = { type: 'basic', ...creds }; headers.splice(authIdx, 1); }
      }
    }
  }

  // Body.
  let body: RequestBody = { mode: 'none' };
  if (isForm) {
    body = {
      mode: 'form',
      form: formParts.map(kv => { const idx = kv.indexOf('='); return { key: idx === -1 ? kv : kv.slice(0, idx), value: idx === -1 ? '' : kv.slice(idx + 1), enabled: true }; }),
    };
  } else if (hasData) {
    const data = dataParts.join('&');
    const ct = headers.find(h => h.key.toLowerCase() === 'content-type')?.value;
    if ((ct && ct.includes('json')) || looksJson(data)) body = { mode: 'json', json: data };
    else body = { mode: 'raw', raw: data, rawContentType: ct ?? 'application/x-www-form-urlencoded' };
  }

  // A friendly name from the URL path.
  let name: string;
  try {
    const u = new URL(url.replace(/\{\{[^}]+\}\}/g, 'x'));
    name = `${resolvedMethod} ${u.pathname === '/' ? u.hostname : u.pathname}`;
  } catch {
    // Templated or protocol-less URL: strip scheme/query and keep the rest.
    const cleaned = url.replace(/^[a-z]+:\/\//i, '').replace(/\?.*$/, '');
    name = `${resolvedMethod} ${cleaned}`.trim();
  }

  return { name, method: resolvedMethod as HttpMethod, url, headers, params: [], auth, body };
}
