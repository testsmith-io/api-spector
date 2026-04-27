// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { readFile, writeFile, mkdir, unlink, readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { createHash, randomUUID } from 'crypto';
import { fetch } from 'undici';
import { load as yamlLoad } from 'js-yaml';
import type { ContractSnapshot } from '../../shared/types';

// ─── Contract snapshot storage ───────────────────────────────────────────────
//
// Snapshots live under `<workspace>/contracts/<id>.contract.json`, so users can
// version-control them alongside collections and environments. Each snapshot
// embeds the spec text verbatim, so replaying a run against a pinned version
// doesn't depend on the network or upstream availability.

const SNAPSHOT_DIR = 'contracts';

function safeName(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'spec';
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function detectFormat(source: string, contentType: string): 'yaml' | 'json' {
  const lc = source.toLowerCase();
  if (lc.endsWith('.yaml') || lc.endsWith('.yml')) return 'yaml';
  if (lc.endsWith('.json')) return 'json';
  if (contentType.includes('yaml')) return 'yaml';
  return 'json';
}

function tryExtractSpecVersion(specText: string, format: 'yaml' | 'json'): string | undefined {
  try {
    const parsed = format === 'yaml' ? yamlLoad(specText) : JSON.parse(specText);
    const info = (parsed as { info?: { version?: unknown } } | null)?.info;
    if (info && typeof info.version === 'string') return info.version;
  } catch { /* spec may be malformed — we still snapshot the bytes */ }
  return undefined;
}

// ─── Capture ────────────────────────────────────────────────────────────────

export interface CaptureOptions {
  /** HTTP URL to fetch the spec from. */
  specUrl?: string
  /** Absolute local file path. */
  specPath?: string
  /** Human-readable label. Falls back to hostname or filename. */
  name?: string
}

export async function captureSnapshot(workspaceDir: string, opts: CaptureOptions): Promise<ContractSnapshot> {
  const { specUrl, specPath } = opts;
  if (!specUrl && !specPath) throw new Error('captureSnapshot: specUrl or specPath is required');

  let specText: string;
  let format: 'yaml' | 'json';
  let source: string;

  if (specUrl) {
    const resp = await fetch(specUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} loading spec from ${specUrl}`);
    specText = await resp.text();
    format = detectFormat(specUrl, resp.headers.get('content-type') ?? '');
    source = specUrl;
  } else {
    specText = await readFile(specPath!, 'utf8');
    format = detectFormat(specPath!, '');
    source = specPath!;
  }

  const id = randomUUID();
  const specVersion = tryExtractSpecVersion(specText, format);

  // Build a readable name: prefer the user-supplied label, else derive from
  // the source hostname/filename and include the spec's own version if known.
  let name = opts.name?.trim();
  if (!name) {
    try { name = new URL(source).hostname; } catch { name = source.split(/[\\/]/).pop() ?? 'spec'; }
  }
  if (specVersion && !name.includes(specVersion)) name = `${name} ${specVersion}`;

  const snapshot: ContractSnapshot = {
    version: '1.0',
    id,
    name,
    source,
    capturedAt: new Date().toISOString(),
    format,
    specVersion,
    spec: specText,
    sha256: sha256(specText),
  };

  const relPath = join(SNAPSHOT_DIR, `${safeName(name)}-${id.slice(0, 8)}.contract.json`);
  const absPath = resolve(workspaceDir, relPath);
  await mkdir(join(workspaceDir, SNAPSHOT_DIR), { recursive: true });
  await writeFile(absPath, JSON.stringify(snapshot, null, 2), 'utf8');

  // Stash the relPath on the snapshot object so callers can immediately
  // register it in the workspace manifest without re-deriving the path.
  Object.defineProperty(snapshot, '__relPath', { value: relPath, enumerable: false });
  return snapshot;
}

export function relPathOf(snapshot: ContractSnapshot): string | undefined {
  const hidden = (snapshot as unknown as { __relPath?: string }).__relPath;
  return hidden;
}

// ─── Load / list / delete ───────────────────────────────────────────────────

export async function loadSnapshot(workspaceDir: string, relPath: string): Promise<ContractSnapshot> {
  const raw = await readFile(resolve(workspaceDir, relPath), 'utf8');
  return JSON.parse(raw) as ContractSnapshot;
}

/** Lists snapshots referenced by the workspace AND any `.contract.json` files
 *  discovered under `<workspace>/contracts/` (so orphan files aren't silently
 *  ignored when users drop them in by hand). */
export async function listSnapshots(
  workspaceDir: string,
  registered: string[] = [],
): Promise<Array<{ relPath: string; snapshot: ContractSnapshot }>> {
  const seen = new Set<string>(registered);
  try {
    const entries = await readdir(join(workspaceDir, SNAPSHOT_DIR));
    for (const f of entries) {
      if (f.endsWith('.contract.json')) seen.add(join(SNAPSHOT_DIR, f));
    }
  } catch { /* no contracts dir yet */ }

  const out: Array<{ relPath: string; snapshot: ContractSnapshot }> = [];
  for (const relPath of seen) {
    try {
      const snapshot = await loadSnapshot(workspaceDir, relPath);
      out.push({ relPath, snapshot });
    } catch { /* skip malformed */ }
  }
  out.sort((a, b) => b.snapshot.capturedAt.localeCompare(a.snapshot.capturedAt));
  return out;
}

export async function deleteSnapshot(workspaceDir: string, relPath: string): Promise<void> {
  try { await unlink(resolve(workspaceDir, relPath)); }
  catch { /* already gone — treat as success so callers can remove the manifest entry */ }
}
