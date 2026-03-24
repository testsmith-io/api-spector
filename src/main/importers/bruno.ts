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

import { readFile, readdir, stat } from 'fs/promises';
import { join, basename } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Collection, ApiRequest, AuthConfig, RequestBody, KeyValuePair, Folder } from '../../shared/types';
import { translateScript } from './script-translator';

// ─── Bruno collection importer ────────────────────────────────────────────────
// Accepts a path to the root bruno.json file. Scans the directory tree for
// .bru request files and reconstructs the collection hierarchy from the
// directory structure.

// ─── .bru parser ─────────────────────────────────────────────────────────────

/**
 * Extract the content of a named block from a .bru file.
 * Handles nested braces correctly (e.g. body:json contains JSON with braces).
 */
function extractBlock(content: string, blockName: string): string | null {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === `${blockName} {`) {
      let depth = 1;
      const blockLines: string[] = [];
      i++;
      while (i < lines.length && depth > 0) {
        const trimmed = lines[i].trim();
        // Track depth by counting standalone braces
        if (trimmed === '{') depth++;
        if (trimmed === '}') {
          depth--;
          if (depth === 0) break;
        }
        blockLines.push(lines[i]);
        i++;
      }
      return blockLines.join('\n');
    }
  }
  return null;
}

/** Parse `key: value` lines from a block's content. */
function parseKv(blockContent: string | null): Record<string, string> {
  if (!blockContent) return {};
  const result: Record<string, string> = {};
  for (const line of blockContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim();
      if (key) result[key] = val;
    }
  }
  return result;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;
type _BruMethod = typeof HTTP_METHODS[number]

export function parseBruFile(content: string, fileName: string): ApiRequest {
  // ── meta block ──
  const meta = parseKv(extractBlock(content, 'meta'));

  // ── HTTP method block (block name is the method) ──
  let method: string = 'GET';
  let methodAttrs: Record<string, string> = {};
  for (const m of HTTP_METHODS) {
    const block = extractBlock(content, m);
    if (block !== null) {
      method = m.toUpperCase();
      methodAttrs = parseKv(block);
      break;
    }
  }

  const url       = methodAttrs['url']  ?? '';
  const bodyMode  = methodAttrs['body'] ?? 'none';
  const authMode  = methodAttrs['auth'] ?? 'none';

  // ── headers ──
  const headers: KeyValuePair[] = Object.entries(parseKv(extractBlock(content, 'headers'))).map(([k, v]) => ({
    key: k, value: v, enabled: true,
  }));

  // ── query params ──
  const params: KeyValuePair[] = Object.entries(parseKv(extractBlock(content, 'params:query'))).map(([k, v]) => ({
    key: k, value: v, enabled: true,
  }));

  // ── body ──
  let body: RequestBody = { mode: 'none' };
  if (bodyMode === 'json') {
    const jsonContent = extractBlock(content, 'body:json') ?? '';
    body = { mode: 'json', json: jsonContent.trim() };
  } else if (bodyMode === 'text') {
    const rawContent = extractBlock(content, 'body:text') ?? '';
    body = { mode: 'raw', raw: rawContent.trim(), rawContentType: 'text/plain' };
  } else if (bodyMode === 'formUrlEncoded') {
    const form = Object.entries(parseKv(extractBlock(content, 'body:form-urlencoded'))).map(([k, v]) => ({
      key: k, value: v, enabled: true,
    }));
    body = { mode: 'form', form };
  } else if (bodyMode === 'graphql') {
    const gqlContent = extractBlock(content, 'body:graphql') ?? '';
    body = { mode: 'graphql', graphql: { query: gqlContent.trim(), variables: '{}' } };
  }

  // ── auth ──
  let auth: AuthConfig = { type: 'none' };
  if (authMode === 'bearer') {
    const bearerAttrs = parseKv(extractBlock(content, 'auth:bearer'));
    auth = { type: 'bearer', token: bearerAttrs['token'] ?? '' };
  } else if (authMode === 'basic') {
    const basicAttrs = parseKv(extractBlock(content, 'auth:basic'));
    auth = { type: 'basic', username: basicAttrs['username'] ?? '', password: basicAttrs['password'] ?? '' };
  } else if (authMode === 'apikey') {
    const apiKeyAttrs = parseKv(extractBlock(content, 'auth:apikey'));
    auth = {
      type:        'apikey',
      apiKeyName:  apiKeyAttrs['key']   ?? 'X-API-Key',
      apiKeyValue: apiKeyAttrs['value'] ?? '',
      apiKeyIn:    apiKeyAttrs['in']    === 'query' ? 'query' : 'header',
    };
  }

  return {
    id:          uuidv4(),
    name:        meta['name']  ?? basename(fileName, '.bru'),
    method:      method        as ApiRequest['method'],
    url,
    headers,
    params,
    auth,
    body,
    description:       '',
    preRequestScript:  extractBlock(content, 'script:pre-request')  ? translateScript(extractBlock(content, 'script:pre-request')!.trim(),  'bruno') || undefined : undefined,
    postRequestScript: extractBlock(content, 'script:post-response') ? translateScript(extractBlock(content, 'script:post-response')!.trim(), 'bruno') || undefined : undefined,
    meta:        { seq: meta['seq'] !== undefined ? Number(meta['seq']) : 0 },
  };
}

// ─── Directory scanner ────────────────────────────────────────────────────────

async function scanDir(
  dirPath:  string,
  name:     string,
  requests: Record<string, ApiRequest>,
  ignore:   Set<string>,
): Promise<Folder> {
  const folder: Folder = { id: uuidv4(), name, description: '', folders: [], requestIds: [] };
  const entries = await readdir(dirPath);
  const bruRequests: ApiRequest[] = [];

  for (const entry of entries) {
    if (ignore.has(entry)) continue;
    const fullPath = join(dirPath, entry);
    const s = await stat(fullPath);
    if (s.isDirectory()) {
      const sub = await scanDir(fullPath, entry, requests, ignore);
      // Only include non-empty subfolders
      if (sub.folders.length > 0 || sub.requestIds.length > 0) folder.folders.push(sub);
    } else if (entry.endsWith('.bru')) {
      const content = await readFile(fullPath, 'utf8');
      const req = parseBruFile(content, entry);
      requests[req.id] = req;
      bruRequests.push(req);
    }
  }

  // Preserve Bruno's seq ordering
  bruRequests.sort((a, b) => ((a.meta?.['seq'] as number) ?? 0) - ((b.meta?.['seq'] as number) ?? 0));
  folder.requestIds = bruRequests.map(r => r.id);
  return folder;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Import a Bruno collection.
 * @param filePath  Path to the root `bruno.json` file.
 */
export async function importBruno(filePath: string): Promise<Collection> {
  const raw    = await readFile(filePath, 'utf8');
  const config = JSON.parse(raw) as { name?: string; ignore?: string[] };
  const dirPath = filePath.slice(0, filePath.lastIndexOf('/') + 1) || '.';
  const ignore  = new Set<string>(['node_modules', '.git', ...(config.ignore ?? [])]);

  const requests: Record<string, ApiRequest> = {};
  const rootFolder = await scanDir(dirPath, 'root', requests, ignore);

  return {
    version:     '1.0',
    id:          uuidv4(),
    name:        config.name ?? 'Imported Collection',
    description: '',
    rootFolder,
    requests,
  };
}
