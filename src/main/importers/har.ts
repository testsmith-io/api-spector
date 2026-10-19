// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Import an HTTP Archive (.har) file — the request/response capture format that
// browser devtools, proxies (Charles, mitmproxy, Fiddler) and many tools export.
// A HAR is a flat list of recorded exchanges, usually dominated by static assets
// and repeats, so we keep the API-like calls, drop the noise, dedupe, and group
// what's left by host into one collection the user can trim in the import picker.

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { Collection, ApiRequest, Folder, KeyValuePair, RequestBody } from '../../shared/types';

interface HarNameValue { name: string; value?: string }
interface HarPostData { mimeType?: string; text?: string; params?: HarNameValue[] }
interface HarEntry {
  _resourceType?: string
  request?: {
    method?: string
    url?: string
    headers?: HarNameValue[]
    postData?: HarPostData
  }
  response?: { content?: { mimeType?: string } }
}

// Asset URLs and headers that are noise for an API client.
const STATIC_EXT = /\.(?:js|mjs|cjs|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|map|mp4|webm|mp3|wav)(?:\?|#|$)/i;
// Dropped headers: auto/transport ones, plus cookies (session cookies are
// sensitive and the collection is saved to disk, so we never persist them).
const SKIP_HEADER = new Set(['host', 'connection', 'content-length', 'accept-encoding', 'cookie']);

function isApiLike(entry: HarEntry): boolean {
  const rt = (entry._resourceType ?? '').toLowerCase();
  if (rt) return rt === 'xhr' || rt === 'fetch';   // Chrome/Firefox annotate this
  const url = entry.request?.url ?? '';
  if (STATIC_EXT.test(url)) return false;
  const ct = (entry.response?.content?.mimeType ?? '').toLowerCase();
  if (ct.startsWith('image/') || ct.startsWith('font/') || ct.startsWith('audio/') || ct.startsWith('video/')) return false;
  if (ct.includes('css') || ct.includes('javascript')) return false;
  return true;
}

function bodyFrom(postData: HarPostData | undefined): RequestBody {
  if (!postData) return { mode: 'none' };
  const mime = (postData.mimeType ?? '').toLowerCase();
  if (postData.params && postData.params.length && mime.includes('x-www-form-urlencoded')) {
    return { mode: 'form', form: postData.params.map(p => ({ key: p.name, value: p.value ?? '', enabled: true })) };
  }
  const text = postData.text ?? '';
  if (!text.trim()) return { mode: 'none' };
  if (mime.includes('json')) return { mode: 'json', json: text };
  return { mode: 'raw', raw: text, rawContentType: postData.mimeType || 'text/plain' };
}

function requestName(method: string, url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${method} ${path}`;
  } catch {
    return `${method} ${url}`;
  }
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return 'other'; }
}

/** Map a parsed HAR document into a collection. Pure (no file I/O) for testing. */
export function harToCollection(data: { log?: { entries?: HarEntry[] } }, name: string): Collection {
  const entries = data.log?.entries;
  if (!Array.isArray(entries)) throw new Error('Not a HAR file (no log.entries array found).');

  const requests: Record<string, ApiRequest> = {};
  const byHost = new Map<string, string[]>();
  const seen = new Set<string>();

  for (const entry of entries) {
    const r = entry.request;
    if (!r?.url || !r.method || !isApiLike(entry)) continue;

    const body = bodyFrom(r.postData);
    const bodyText = body.mode === 'json' ? body.json ?? '' : body.mode === 'raw' ? body.raw ?? '' : '';
    const dedupeKey = `${r.method} ${r.url} ${bodyText}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const headers: KeyValuePair[] = (r.headers ?? [])
      .filter(h => h.name && !h.name.startsWith(':') && !SKIP_HEADER.has(h.name.toLowerCase()))
      .map(h => ({ key: h.name, value: h.value ?? '', enabled: true }));

    const req: ApiRequest = {
      id: uuidv4(),
      name: requestName(r.method, r.url),
      method: r.method,
      url: r.url,
      headers,
      params: [],
      auth: { type: 'none' },
      body,
    } as ApiRequest;

    requests[req.id] = req;
    const host = hostOf(r.url);
    const list = byHost.get(host) ?? [];
    list.push(req.id);
    byHost.set(host, list);
  }

  const folders: Folder[] = [...byHost.entries()].map(([host, requestIds]) => ({
    id: uuidv4(), name: host, description: '', folders: [], requestIds,
  }));

  return {
    version: '1.0',
    id: uuidv4(),
    name: name || 'Imported HAR',
    description: '',
    // Single host collapses to a flat list; multiple hosts group into folders.
    rootFolder: folders.length === 1
      ? { id: uuidv4(), name: 'root', description: '', folders: [], requestIds: folders[0].requestIds }
      : { id: uuidv4(), name: 'root', description: '', folders, requestIds: [] },
    requests,
  };
}

export async function importHar(filePath: string): Promise<Collection> {
  const raw = await readFile(filePath, 'utf8');
  let data: { log?: { entries?: HarEntry[] } };
  try { data = JSON.parse(raw); } catch { throw new Error('Not valid JSON — pick a .har file exported from your browser or proxy.'); }
  return harToCollection(data, basename(filePath).replace(/\.har$/i, ''));
}
