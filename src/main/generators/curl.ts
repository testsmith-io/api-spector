// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type {
  Collection, Environment, GeneratedFile, ApiRequest, Folder, KeyValuePair, AuthConfig,
} from '../../shared/types';

// ─── cURL script exporter ─────────────────────────────────────────────────────
//
// Serialises a collection to a single runnable shell script: one `curl`
// invocation per request. Collection + (non-secret) environment variables are
// emitted as shell exports at the top, and `{{VAR}}` tokens are rewritten to
// `${VAR}` so the script runs as-is once the user fills in any blanks.

/** Rewrite `{{VAR}}` tokens to shell `${VAR}` so curl expands them at runtime. */
function mapOut(s: string): string {
  return s.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_m, name: string) => `\${${name}}`);
}

/** Single-quote a value for the shell, escaping embedded single quotes. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Double-quote a value that must still expand ${VAR}; escape " and \\ and $ that are not vars. */
function dq(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Depth-first list of requests in folder order. */
function orderedRequests(collection: Collection): ApiRequest[] {
  const out: ApiRequest[] = [];
  const walk = (folder: Folder): void => {
    for (const id of folder.requestIds) {
      const req = collection.requests[id];
      if (req) out.push(req);
    }
    for (const sub of folder.folders) walk(sub);
  };
  walk(collection.rootFolder);
  return out;
}

/** Non-basic auth as a header. Basic auth is emitted with `-u` instead. */
function authHeader(auth: AuthConfig): KeyValuePair | null {
  switch (auth.type) {
    case 'bearer':
      return auth.token ? { key: 'Authorization', value: `Bearer ${auth.token}`, enabled: true } : null;
    case 'apikey':
      if (auth.apiKeyIn === 'query') return null; // handled in the URL
      return auth.apiKeyName
        ? { key: auth.apiKeyName, value: auth.apiKeyValue ?? '', enabled: true }
        : null;
    default:
      return null;
  }
}

function buildUrl(req: ApiRequest): string {
  const query = (req.params ?? []).filter(p => p.enabled && p.key && p.paramType !== 'path');
  if (req.auth.type === 'apikey' && req.auth.apiKeyIn === 'query' && req.auth.apiKeyName) {
    query.push({ key: req.auth.apiKeyName, value: req.auth.apiKeyValue ?? '', enabled: true });
  }
  if (!query.length) return req.url;
  const qs = query.map(p => `${p.key}=${p.value}`).join('&');
  return req.url + (req.url.includes('?') ? '&' : '?') + qs;
}

function bodyOf(req: ApiRequest): { contentType?: string; text?: string } {
  const b = req.body;
  switch (b.mode) {
    case 'json':    return { contentType: 'application/json', text: b.json ?? '' };
    case 'graphql': return { contentType: 'application/json', text: JSON.stringify({ query: b.graphql?.query ?? '', variables: b.graphql?.variables ? safeParse(b.graphql.variables) : undefined }) };
    case 'soap':    return { contentType: 'text/xml', text: b.soap?.envelope ?? '' };
    case 'raw':     return { contentType: b.rawContentType, text: b.raw ?? '' };
    case 'form':
      return {
        contentType: 'application/x-www-form-urlencoded',
        text: (b.form ?? []).filter(f => f.enabled && f.key)
          .map(f => `${f.key}=${f.value}`).join('&'),
      };
    default: return {};
  }
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

export function generateCurl(collection: Collection, environment: Environment | null): GeneratedFile[] {
  const lines: string[] = ['#!/usr/bin/env bash', 'set -euo pipefail', ''];

  // ── Variable exports: environment first, collection variables override ──
  const vars: Record<string, string> = {};
  for (const v of environment?.variables ?? []) {
    if (v.enabled && !v.secret) vars[v.key] = v.value;
  }
  Object.assign(vars, collection.collectionVariables ?? {});
  const varKeys = Object.keys(vars);
  if (varKeys.length) {
    lines.push('# Variables (override via the environment before running)');
    for (const k of varKeys) lines.push(`${k}=${shq(vars[k])}`);
    lines.push('');
  }

  orderedRequests(collection).forEach((req, idx) => {
    if (idx > 0) lines.push('');
    lines.push(`# ${req.name}`);
    if (req.description?.trim()) {
      for (const l of req.description.trim().split(/\r?\n/)) lines.push(`# ${l}`);
    }

    const args: string[] = [`curl -sS -X ${req.method} ${dq(mapOut(buildUrl(req)))}`];

    // Basic auth uses -u; other schemes fold into a header below.
    if (req.auth.type === 'basic') {
      const user = mapOut(req.auth.username ?? '');
      const pass = mapOut(req.auth.password ?? '');
      args.push(`-u ${dq(`${user}:${pass}`)}`);
    }

    const headers = [...(req.headers ?? []).filter(h => h.enabled && h.key)];
    const ah = authHeader(req.auth);
    if (ah) headers.unshift(ah);

    const body = bodyOf(req);
    const hasCT = headers.some(h => h.key.toLowerCase() === 'content-type');
    if (body.text && body.contentType && !hasCT) {
      headers.push({ key: 'Content-Type', value: body.contentType, enabled: true });
    }

    for (const h of headers) args.push(`-H ${dq(`${h.key}: ${mapOut(h.value)}`)}`);

    if (body.text) args.push(`--data ${dq(mapOut(body.text))}`);

    lines.push(args.join(' \\\n  '));
  });

  const slug = collection.name.replace(/\W+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'collection';
  return [{ path: `${slug}.sh`, content: lines.join('\n') + '\n' }];
}
