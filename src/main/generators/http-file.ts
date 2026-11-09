// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type {
  Collection, Environment, GeneratedFile, ApiRequest, Folder, KeyValuePair, AuthConfig,
} from '../../shared/types';
import { SPECTOR_TO_HTTP } from '../importers/http-file';

// ─── .http / .rest file exporter ──────────────────────────────────────────────
//
// Serialises a collection to a single `.http` file compatible with the VSCode
// REST Client and IntelliJ HTTP Client. Collection + (non-secret) environment
// variables are emitted as `@name = value` declarations so the file is
// self-contained and round-trips back through the importer.

/** Basename of a path, tolerant of both / and \ separators (no node:path dep). */
function basenameOf(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

/** Rewrite API Spector `{{$dynamic}}` tokens back to REST Client names. */
function mapOut(s: string): string {
  return s.replaceAll(/\{\{\s*(\$[A-Za-z]+)\s*\}\}/g, (_m, name: string) =>
    `{{${SPECTOR_TO_HTTP[name] ?? name}}}`);
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

/** Turn structured auth into a header (or a query param for api-key-in-query). */
function authToHeader(auth: AuthConfig): KeyValuePair | null {
  switch (auth.type) {
    case 'bearer':
      return auth.token ? { key: 'Authorization', value: `Bearer ${auth.token}`, enabled: true } : null;
    case 'basic': {
      const user = auth.username ?? '';
      const pass = auth.password ?? '';
      // base64 only encodes cleanly for literal values; templated creds fall back to a comment.
      const templated = /\{\{/.test(user) || /\{\{/.test(pass);
      const value = templated
        ? `Basic {{base64(${user}:${pass})}}`
        : `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
      return { key: 'Authorization', value, enabled: true };
    }
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
  // api-key-in-query appends its own parameter
  if (req.auth.type === 'apikey' && req.auth.apiKeyIn === 'query' && req.auth.apiKeyName) {
    query.push({ key: req.auth.apiKeyName, value: req.auth.apiKeyValue ?? '', enabled: true });
  }
  if (!query.length) return req.url;
  const qs = query.map(p => `${p.key}=${p.value}`).join('&');
  return req.url + (req.url.includes('?') ? '&' : '?') + qs;
}

function bodyLines(req: ApiRequest): { contentType?: string; text?: string } {
  const b = req.body;
  switch (b.mode) {
    case 'json': return { contentType: 'application/json', text: b.json ?? '' };
    case 'graphql': return { contentType: 'application/json', text: b.graphql?.query ?? '' };
    case 'soap': return { contentType: 'text/xml', text: b.soap?.envelope ?? '' };
    case 'raw': return { contentType: b.rawContentType, text: b.raw ?? '' };
    case 'form':
      return {
        contentType: 'application/x-www-form-urlencoded',
        text: (b.form ?? []).filter(f => f.enabled && f.key)
          .map(f => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`).join('&'),
      };
    default: return {};
  }
}

export function generateHttpFile(collection: Collection, environment: Environment | null): GeneratedFile[] {
  const lines: string[] = [];

  // ── File variables: environment first, collection variables override ──
  const vars: Record<string, string> = {};
  for (const v of environment?.variables ?? []) {
    if (v.enabled && !v.secret) vars[v.key] = v.value;
  }
  Object.assign(vars, collection.collectionVariables ?? {});
  const varKeys = Object.keys(vars);
  if (varKeys.length) {
    for (const k of varKeys) lines.push(`@${k} = ${mapOut(vars[k])}`);
    lines.push('');
  }

  // ── Requests ──
  orderedRequests(collection).forEach((req, idx) => {
    if (idx > 0) lines.push('');
    lines.push(`### ${req.name}`);
    if (req.description?.trim()) {
      for (const l of req.description.trim().split(/\r?\n/)) lines.push(`# ${l}`);
    }

    lines.push(`${req.method} ${mapOut(buildUrl(req))}`);

    const headers = [...(req.headers ?? []).filter(h => h.enabled && h.key)];
    const authHeader = authToHeader(req.auth);
    if (authHeader) headers.unshift(authHeader);

    const hasCT = headers.some(h => h.key.toLowerCase() === 'content-type');
    const isMultipart = req.body.mode === 'multipart' && !['get', 'head'].includes(req.method.toLowerCase())
      && (req.body.multipart ?? []).some(p => p.enabled && p.key);

    if (isMultipart) {
      // REST Client .http multipart: explicit boundary, with `< path` including
      // a file's contents. We always set the Content-Type so the boundary matches.
      const boundary = '----WebKitFormBoundaryApiSpector';
      const ctIdx = headers.findIndex(h => h.key.toLowerCase() === 'content-type');
      const ctHeader = { key: 'Content-Type', value: `multipart/form-data; boundary=${boundary}`, enabled: true };
      if (ctIdx >= 0) headers[ctIdx] = ctHeader; else headers.push(ctHeader);

      for (const h of headers) lines.push(`${h.key}: ${mapOut(h.value)}`);
      lines.push('');
      for (const p of (req.body.multipart ?? []).filter(f => f.enabled && f.key)) {
        lines.push(`--${boundary}`);
        if (p.type === 'file') {
          lines.push(`Content-Disposition: form-data; name="${p.key}"; filename="${p.fileName || basenameOf(p.filePath ?? '')}"`);
          if (p.contentType) lines.push(`Content-Type: ${p.contentType}`);
          lines.push('', `< ${mapOut(p.filePath ?? '')}`);
        } else {
          lines.push(`Content-Disposition: form-data; name="${p.key}"`, '', mapOut(p.value ?? ''));
        }
      }
      lines.push(`--${boundary}--`);
      return;
    }

    const body = bodyLines(req);
    // Emit a Content-Type header for the body if the request doesn't already set one.
    if (body.text && body.contentType && !hasCT) {
      headers.push({ key: 'Content-Type', value: body.contentType, enabled: true });
    }

    for (const h of headers) lines.push(`${h.key}: ${mapOut(h.value)}`);

    if (body.text) {
      lines.push('', mapOut(body.text));
    }
  });

  const slug = collection.name.replaceAll(/\W+/g, '-').replaceAll(/^-+|-+$/g, '').toLowerCase() || 'collection';
  return [{ path: `${slug}.http`, content: lines.join('\n') + '\n' }];
}
