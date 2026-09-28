// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react';
import { AI_OPENAI_TOKEN_REF, DEFAULT_AI_MODEL } from '../../../shared/types';
import { STORAGE_KEYS } from './storage-keys';
import type { ApiRequest, Collection, Folder, GenerateDocsInput } from '../../../shared/types';

const { electron } = window;

// AI config (model choice) lives in localStorage — per-machine, so it never
// lands in the workspace/collection files or version control. The API key
// itself lives only in the OS keychain (see AI_OPENAI_TOKEN_REF).
const CFG_KEY = STORAGE_KEYS.ai;

export interface AiConfig { model: string }

export function getAiConfig(): AiConfig {
  try { return { model: DEFAULT_AI_MODEL, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; }
  catch { return { model: DEFAULT_AI_MODEL }; }
}

export function setAiConfig(cfg: AiConfig): void {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* private mode */ }
}

// Cache the "is a key configured" check so every DocsEditor doesn't hit IPC.
let availableCache: boolean | null = null;
export function invalidateAiAvailable() { availableCache = null; }

async function checkAvailable(): Promise<boolean> {
  if (availableCache != null) return availableCache;
  try { availableCache = (await electron.hasSecret(AI_OPENAI_TOKEN_REF)).has; }
  catch { availableCache = false; }
  return availableCache;
}

/** Whether an OpenAI key is configured (drives the "Generate with AI" button). */
export function useAiAvailable(): boolean {
  const [available, setAvailable] = useState(availableCache ?? false);
  useEffect(() => { let live = true; checkAvailable().then(v => { if (live) setAvailable(v); }); return () => { live = false; }; }, []);
  return available;
}

export async function generateDocs(input: Omit<GenerateDocsInput, 'model'>): Promise<string> {
  return electron.generateAiDocs({ ...input, model: getAiConfig().model });
}

// ── Context builders (readable summaries fed to the model) ───────────────────

function kvLines(label: string, rows: { key: string; value: string; enabled?: boolean }[] | undefined): string[] {
  const on = (rows ?? []).filter(r => r.enabled !== false && r.key);
  if (on.length === 0) return [];
  return [`${label}:`, ...on.map(r => `  - ${r.key}: ${r.value}`)];
}

export function requestDocsContext(req: ApiRequest, example?: { response?: { status: number; body: string } | null }): string {
  const lines: string[] = [
    `Type: ${req.protocol ?? 'http'} request`,
    `Method: ${req.method}`,
    `URL: ${req.url}`,
  ];
  lines.push(...kvLines('Query params', req.params), ...kvLines('Headers', req.headers));
  if (req.auth && req.auth.type !== 'none') lines.push(`Auth: ${req.auth.type}`);
  if (req.body && req.body.mode !== 'none') {
    lines.push(`Request body (${req.body.mode}):`);
    const raw = typeof (req.body as { raw?: unknown }).raw === 'string' ? (req.body as { raw: string }).raw : '';
    if (raw) lines.push(raw.slice(0, 2000));
  }
  if (example?.response) {
    lines.push(`Example response (status ${example.response.status}):`, (example.response.body || '').slice(0, 2000));
  }
  return lines.join('\n');
}

export function folderDocsContext(folder: Folder, requests: Collection['requests']): string {
  const lines: string[] = [`Folder with ${folder.requestIds.length} direct request(s) and ${folder.folders.length} sub-folder(s).`];
  const reqs = folder.requestIds.map(id => requests[id]).filter(Boolean);
  if (reqs.length) {
    lines.push('Requests:');
    for (const r of reqs) lines.push(`  - ${r.method} ${r.url}${r.name ? ` (${r.name})` : ''}`);
  }
  if (folder.folders.length) {
    lines.push('Sub-folders: ' + folder.folders.map(f => f.name).join(', '));
  }
  return lines.join('\n');
}

export function collectionDocsContext(col: Collection): string {
  const reqs = Object.values(col.requests);
  const lines: string[] = [`API collection with ${reqs.length} request(s).`];
  const byMethod: Record<string, number> = {};
  for (const r of reqs) byMethod[r.method] = (byMethod[r.method] ?? 0) + 1;
  lines.push('Methods: ' + Object.entries(byMethod).map(([m, n]) => `${m}×${n}`).join(', '), 'Endpoints:');
  for (const r of reqs.slice(0, 60)) lines.push(`  - ${r.method} ${r.url}`);
  if (reqs.length > 60) lines.push(`  … and ${reqs.length - 60} more`);
  return lines.join('\n');
}
