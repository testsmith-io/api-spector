import { readFile } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import type { Collection, ApiRequest, AuthConfig, RequestBody, KeyValuePair, Folder } from '../../shared/types';
import { translateScript } from './script-translator';

// ─── Insomnia v4 export importer ──────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

function parseHeaders(headers: any[]): KeyValuePair[] {
  return (headers ?? []).map(h => ({
    key:         h.name        ?? '',
    value:       h.value       ?? '',
    enabled:     !h.disabled,
    description: h.description ?? '',
  }));
}

function parseParams(params: any[]): KeyValuePair[] {
  return (params ?? []).map(p => ({
    key:         p.name        ?? '',
    value:       p.value       ?? '',
    enabled:     !p.disabled,
    description: p.description ?? '',
  }));
}

function parseBody(body: any): RequestBody {
  if (!body) return { mode: 'none' };
  const mime: string = body.mimeType ?? '';

  if (mime.includes('json') || mime === 'application/json') {
    return { mode: 'json', json: body.text ?? '{}' };
  }
  if (mime === 'application/graphql') {
    return {
      mode: 'graphql',
      graphql: { query: body.text ?? '', variables: '{}' },
    };
  }
  if (mime === 'application/x-www-form-urlencoded') {
    return {
      mode: 'form',
      form: (body.params ?? []).map((p: any) => ({
        key: p.name ?? '', value: p.value ?? '', enabled: !p.disabled,
      })),
    };
  }
  if (body.text) {
    return { mode: 'raw', raw: body.text, rawContentType: mime || 'text/plain' };
  }
  return { mode: 'none' };
}

function parseAuth(auth: any): AuthConfig {
  if (!auth || !auth.type || auth.type === 'none') return { type: 'none' };
  if (auth.type === 'bearer') {
    return { type: 'bearer', token: auth.token ?? '' };
  }
  if (auth.type === 'basic') {
    return { type: 'basic', username: auth.username ?? '', password: auth.password ?? '' };
  }
  if (auth.type === 'apikey') {
    return {
      type:        'apikey',
      apiKeyName:  auth.key   ?? 'X-API-Key',
      apiKeyValue: auth.value ?? '',
      apiKeyIn:    auth.addTo === 'queryParams' ? 'query' : 'header',
    };
  }
  return { type: 'none' };
}

export async function importInsomnia(filePath: string): Promise<Collection> {
  const raw  = await readFile(filePath, 'utf8');
  const data = JSON.parse(raw);

  const resources: any[] = data.resources ?? [];

  // Find the workspace resource for collection metadata
  const workspace   = resources.find(r => r._type === 'workspace') ?? {};
  const workspaceId = workspace._id ?? '';

  const requests: Record<string, ApiRequest> = {};
  const folderById: Record<string, Folder>   = {};
  const rootFolder: Folder = { id: uuidv4(), name: 'root', description: '', folders: [], requestIds: [] };

  // First pass: build all folders
  for (const r of resources) {
    if (r._type !== 'request_group') continue;
    folderById[r._id] = {
      id:          uuidv4(),
      name:        r.name        ?? 'Folder',
      description: r.description ?? '',
      folders:     [],
      requestIds:  [],
    };
  }

  // Second pass: attach requests to their parent
  for (const r of resources) {
    if (r._type !== 'request') continue;
    const req: ApiRequest = {
      id:          uuidv4(),
      name:        r.name        ?? 'Request',
      method:      (r.method     ?? 'GET').toUpperCase() as any,
      url:         r.url         ?? '',
      headers:     parseHeaders(r.headers),
      params:      parseParams(r.parameters),
      auth:        parseAuth(r.authentication),
      body:        parseBody(r.body),
      description:       r.description       ?? '',
      preRequestScript:  r.preRequestScript   ? translateScript(String(r.preRequestScript).trim(),   'insomnia') || undefined : undefined,
      postRequestScript: r.afterResponseScript ? translateScript(String(r.afterResponseScript).trim(), 'insomnia') || undefined : undefined,
      meta:        {},
    };
    requests[req.id] = req;
    if (folderById[r.parentId]) {
      folderById[r.parentId].requestIds.push(req.id);
    } else {
      rootFolder.requestIds.push(req.id);
    }
  }

  // Third pass: nest folders into their parents
  for (const r of resources) {
    if (r._type !== 'request_group') continue;
    const folder = folderById[r._id];
    if (!folder) continue;
    const isTopLevel = r.parentId === workspaceId || !folderById[r.parentId];
    if (isTopLevel) {
      rootFolder.folders.push(folder);
    } else {
      folderById[r.parentId].folders.push(folder);
    }
  }

  return {
    version:     '1.0',
    id:          uuidv4(),
    name:        workspace.name        ?? 'Imported Collection',
    description: workspace.description ?? '',
    rootFolder,
    requests,
  };
}
