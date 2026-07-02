// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { readFile } from 'fs/promises';
import { basename } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  Collection, ApiRequest, Folder, KeyValuePair, RequestBody, AuthConfig, HttpMethod,
} from '../../shared/types';

// ─── .http / .rest file importer ──────────────────────────────────────────────
//
// Parses the request format shared by the VSCode REST Client and IntelliJ HTTP
// Client. A file is a flat list of requests separated by `###`, each with an
// optional name, a `METHOD URL` line, headers, and a body. File-level variables
// (`@name = value`) become collection variables; `{{$dynamic}}` system variables
// are mapped onto API Spector's equivalents.

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** REST Client / IntelliJ dynamic variables → API Spector dynamic variables.
 *  Shared with the exporter (reverse direction) so a round-trip stays stable. */
export const HTTP_TO_SPECTOR: Record<string, string> = {
  $guid:          '$uuid',
  $randomInt:     '$randomInt',
  $timestamp:     '$timestamp',
  $datetime:      '$isoTimestamp',
  $localDatetime: '$isoTimestamp',
};

export const SPECTOR_TO_HTTP: Record<string, string> = {
  $uuid:         '$guid',
  $randomInt:    '$randomInt',
  $timestamp:    '$timestamp',
  $isoTimestamp: '$datetime iso8601',
};

/** Rewrite `{{$dynamic ...}}` tokens from REST Client names to API Spector names.
 *  Arguments we can't represent (e.g. `$randomInt 1 100`) are dropped. */
export function mapDynamicVars(s: string): string {
  return s.replace(/\{\{\s*(\$[A-Za-z]+)[^}]*\}\}/g, (_m, name: string) =>
    `{{${HTTP_TO_SPECTOR[name] ?? name}}}`);
}

// ─── Body / auth helpers ──────────────────────────────────────────────────────

function contentTypeOf(headers: KeyValuePair[]): string {
  return headers.find(h => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? '';
}

function toRequestBody(bodyText: string, headers: KeyValuePair[]): RequestBody {
  if (!bodyText.trim()) return { mode: 'none' };
  const ct = contentTypeOf(headers);

  if (ct.includes('json') || (!ct && /^\s*[[{]/.test(bodyText))) {
    return { mode: 'json', json: bodyText };
  }
  if (ct.includes('graphql')) {
    return { mode: 'graphql', graphql: { query: bodyText, variables: '{}' } };
  }
  if (ct.includes('x-www-form-urlencoded')) {
    const form: KeyValuePair[] = bodyText.split('&').filter(Boolean).map(pair => {
      const [k, v = ''] = pair.split('=');
      return { key: decodeURIComponent(k.trim()), value: decodeURIComponent(v.trim()), enabled: true };
    });
    return { mode: 'form', form };
  }
  return { mode: 'raw', raw: bodyText, rawContentType: ct || 'text/plain' };
}

/** Lift `Authorization: Bearer …` into structured auth; leave other schemes as a
 *  plain header. Returns the (possibly reduced) header list and the auth config. */
function extractAuth(headers: KeyValuePair[]): { headers: KeyValuePair[]; auth: AuthConfig } {
  const authHeader = headers.find(h => h.key.toLowerCase() === 'authorization');
  if (authHeader) {
    const bearer = /^Bearer\s+(.+)$/i.exec(authHeader.value.trim());
    if (bearer) {
      return {
        headers: headers.filter(h => h !== authHeader),
        auth:    { type: 'bearer', token: bearer[1].trim() },
      };
    }
  }
  return { headers, auth: { type: 'none' } };
}

/** Remove IntelliJ pre-request / response-handler script blocks (`< {% … %}`,
 *  `> {% … %}`) and external handler references from a body region. */
function stripScriptBlocks(bodyLines: string[]): string {
  const joined = bodyLines.join('\n');
  return joined
    .replace(/[<>]\s*\{%[\s\S]*?%\}/g, '')      // inline script blocks
    .replace(/^\s*>\s+\S.*$/gm, '')             // > ./response-handler.js
    .replace(/^\s*<\s+\S.*$/gm, '')             // < ./body-from-file (unsupported)
    .trim();
}

// ─── Block parsing ────────────────────────────────────────────────────────────

interface Block { label?: string; lines: string[] }

function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const sep = /^###\s*(.*)$/.exec(raw);
    if (sep) {
      current = { label: sep[1].trim() || undefined, lines: [] };
      blocks.push(current);
    } else if (current) {
      current.lines.push(raw);
    } else {
      current = { lines: [raw] };
      blocks.push(current);
    }
  }
  return blocks;
}

function parseBlock(block: Block): ApiRequest | null {
  const { lines } = block;
  let name = block.label;
  let i = 0;

  // Leading comments / directives / stray @vars.
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    const named = /^(?:#|\/\/)\s*@name\s*=?\s*(.+)$/.exec(t);
    if (named) { name = named[1].trim(); continue; }
    if (t.startsWith('#') || t.startsWith('//')) continue;      // plain comment / directive
    if (/^@[A-Za-z0-9_]+\s*=/.test(t)) continue;                // file variable
    break;                                                       // → request line
  }
  if (i >= lines.length) return null;

  // Request line: [METHOD] URL [HTTP/x]
  const requestLine = lines[i++].trim();
  const rm = new RegExp(`^(?:(${METHODS.join('|')})\\s+)?(\\S.*?)(?:\\s+HTTP/[\\d.]+)?$`, 'i').exec(requestLine);
  if (!rm) return null;
  const method = (rm[1] ?? 'GET').toUpperCase() as HttpMethod;
  let url = rm[2].trim();

  // Headers until a blank line; fold wrapped query-string continuation lines.
  const rawHeaders: KeyValuePair[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { i++; break; }
    if (/^\s*[?&]/.test(line)) { url += line.trim(); continue; }
    const h = /^([^:\s][^:]*):\s*(.*)$/.exec(line);
    if (h) rawHeaders.push({ key: h[1].trim(), value: mapDynamicVars(h[2].trim()), enabled: true });
  }

  const bodyText = mapDynamicVars(stripScriptBlocks(lines.slice(i)));
  const { headers, auth } = extractAuth(rawHeaders);
  const body = toRequestBody(bodyText, headers);

  return {
    id:      uuidv4(),
    name:    name ?? `${method} ${url}`,
    method,
    url:     mapDynamicVars(url),
    headers,
    params:  [],
    auth,
    body,
    meta:    { tags: ['http-file'] },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Parse `.http` file text into a Collection (pure — no filesystem). */
export function parseHttpFile(text: string, name: string): Collection {
  // File-level variables: @name = value (collected across the whole file).
  const collectionVariables: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^@([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) collectionVariables[m[1]] = mapDynamicVars(m[2].trim());
  }

  const rootFolder: Folder = { id: uuidv4(), name: 'root', description: '', folders: [], requestIds: [] };
  const requests: Record<string, ApiRequest> = {};

  for (const block of splitBlocks(text)) {
    const req = parseBlock(block);
    if (!req) continue;
    requests[req.id] = req;
    rootFolder.requestIds.push(req.id);
  }

  return {
    version: '1.0',
    id:      uuidv4(),
    name,
    description: '',
    rootFolder,
    requests,
    ...(Object.keys(collectionVariables).length ? { collectionVariables } : {}),
  };
}

export async function importHttpFile(filePath: string): Promise<Collection> {
  const raw  = await readFile(filePath, 'utf8');
  const name = basename(filePath).replace(/\.(http|rest)$/i, '') || 'Imported HTTP';
  return parseHttpFile(raw, name);
}
