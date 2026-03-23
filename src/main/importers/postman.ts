import { readFile } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import type { Collection, ApiRequest, AuthConfig, RequestBody, KeyValuePair, Folder } from '../../shared/types';
import { translateScript } from './script-translator';

// ─── Postman v2.1 importer ────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

function parseHeaders(raw: any[]): KeyValuePair[] {
  return (raw ?? []).map(h => ({
    key: h.key ?? '',
    value: h.value ?? '',
    enabled: !h.disabled,
    description: h.description ?? '',
  }));
}

function parseParams(urlObj: any): KeyValuePair[] {
  if (!urlObj || typeof urlObj === 'string') return [];
  return (urlObj.query ?? []).map((p: any) => ({
    key: p.key ?? '',
    value: p.value ?? '',
    enabled: !p.disabled,
    description: p.description ?? '',
  }));
}

function parseUrl(urlObj: any): string {
  if (!urlObj) return '';
  if (typeof urlObj === 'string') return urlObj;
  return urlObj.raw ?? '';
}

function parseBody(body: any): RequestBody {
  if (!body) return { mode: 'none' };
  const mode = body.mode ?? 'none';
  if (mode === 'raw') {
    const lang = body.options?.raw?.language ?? 'text';
    if (lang === 'json') return { mode: 'json', json: body.raw ?? '' };
    return { mode: 'raw', raw: body.raw ?? '', rawContentType: 'text/plain' };
  }
  if (mode === 'urlencoded') {
    return {
      mode: 'form',
      form: (body.urlencoded ?? []).map((p: any) => ({
        key: p.key ?? '', value: p.value ?? '', enabled: !p.disabled,
      })),
    };
  }
  return { mode: 'none' };
}

function parseAuth(auth: any): AuthConfig {
  if (!auth) return { type: 'none' };
  const type = auth.type ?? 'noauth';
  if (type === 'noauth' || type === 'none') return { type: 'none' };
  if (type === 'bearer') {
    const entries = Object.fromEntries((auth.bearer ?? []).map((e: any) => [e.key, e.value]));
    return { type: 'bearer', token: entries.token ?? '' };
  }
  if (type === 'basic') {
    const entries = Object.fromEntries((auth.basic ?? []).map((e: any) => [e.key, e.value]));
    return { type: 'basic', username: entries.username ?? '', password: entries.password ?? '' };
  }
  if (type === 'apikey') {
    const entries = Object.fromEntries((auth.apikey ?? []).map((e: any) => [e.key, e.value]));
    return {
      type: 'apikey',
      apiKeyName: entries.key ?? 'X-API-Key',
      apiKeyValue: entries.value ?? '',
      apiKeyIn: entries.in ?? 'header',
    };
  }
  return { type: 'none' };
}

function translateMaybe(src: string | undefined, format: Parameters<typeof translateScript>[1]): string | undefined {
  return src !== undefined ? translateScript(src, format) : undefined;
}

function parseRequest(item: any, collectionAuth: any): ApiRequest {
  const req = typeof item.request === 'string'
    ? { url: item.request, method: 'GET' }
    : (item.request ?? {});

  return {
    id: uuidv4(),
    name: item.name ?? 'Request',
    method: (req.method ?? 'GET').toUpperCase() as any,
    url: parseUrl(req.url),
    headers: parseHeaders(req.header),
    params: parseParams(req.url),
    auth: parseAuth(req.auth ?? collectionAuth),
    body: parseBody(req.body),
    description:       req.description ?? '',
    preRequestScript:  translateMaybe(parseScript(item.event, 'prerequest'), 'postman'),
    postRequestScript: translateMaybe(parseScript(item.event, 'test'), 'postman'),
    meta: {},
  };
}

function parseScript(events: any[] | undefined, listen: string): string | undefined {
  if (!Array.isArray(events)) return undefined;
  const event = events.find((e: any) => e.listen === listen);
  const exec  = event?.script?.exec;
  if (!exec) return undefined;
  const src = Array.isArray(exec) ? exec.join('\n') : String(exec);
  return src.trim() || undefined;
}

function parseFolder(item: any, requests: Record<string, ApiRequest>, collectionAuth: any): Folder {
  const folder: Folder = {
    id: uuidv4(),
    name: item.name ?? 'Folder',
    description: item.description ?? '',
    folders: [],
    requestIds: [],
  };

  for (const child of item.item ?? []) {
    if (Array.isArray(child.item)) {
      folder.folders.push(parseFolder(child, requests, collectionAuth));
    } else {
      const req = parseRequest(child, collectionAuth);
      requests[req.id] = req;
      folder.requestIds.push(req.id);
    }
  }

  return folder;
}

export async function importPostman(filePath: string): Promise<Collection> {
  const raw = await readFile(filePath, 'utf8');
  const data = JSON.parse(raw);
  const info = data.info ?? {};
  const collectionAuth = data.auth;
  const requests: Record<string, ApiRequest> = {};
  const rootFolder: Folder = {
    id: uuidv4(),
    name: 'root',
    description: '',
    folders: [],
    requestIds: [],
  };

  for (const item of data.item ?? []) {
    if (Array.isArray(item.item)) {
      rootFolder.folders.push(parseFolder(item, requests, collectionAuth));
    } else {
      const req = parseRequest(item, collectionAuth);
      requests[req.id] = req;
      rootFolder.requestIds.push(req.id);
    }
  }

  return {
    version: '1.0',
    id: uuidv4(),
    name: info.name ?? 'Imported Collection',
    description: info.description ?? '',
    rootFolder,
    requests,
  };
}
