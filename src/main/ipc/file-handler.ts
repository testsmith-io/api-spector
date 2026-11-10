// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { type IpcMain, dialog, app } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import { readFile, writeFile, mkdir, readdir, unlink, cp } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, dirname, resolve, relative, basename, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { simpleGit } from 'simple-git';
import type { Collection, Environment, Workspace, Flow } from '../../shared/types';
import { externalizeDataSets, inlineDataSets } from '../data-files';
import { stripEphemeralAuth } from '../../shared/request-collection';
import { loadGlobals, getGlobals, setGlobals, persistGlobals } from '../globals-store';
import { setSecretsConfig } from '../secrets';
import { clearGitScopeCache } from './git-scope';

const LAST_WS_FILE = join(app.getPath('userData'), 'last-workspace.json');
const RECENTS_FILE = join(app.getPath('userData'), 'recent-workspaces.json');
const MAX_RECENTS = 10;

interface RecentWorkspace { path: string; name: string; lastOpened: number }

async function readRecentWorkspaces(): Promise<RecentWorkspace[]> {
  try {
    const list = JSON.parse(await readFile(RECENTS_FILE, 'utf8')) as RecentWorkspace[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Move `wsPath` to the front of the MRU list (dedup, capped). */
async function pushRecentWorkspace(wsPath: string): Promise<void> {
  const name = basename(wsPath).replace(/\.(spector|json)$/i, '');
  const list = (await readRecentWorkspaces()).filter(r => r.path !== wsPath);
  list.unshift({ path: wsPath, name, lastOpened: Date.now() });
  try {
    await writeFile(RECENTS_FILE, JSON.stringify(list.slice(0, MAX_RECENTS), null, 2), 'utf8');
  } catch (err) {
    console.warn('file-handler: could not update recent-workspaces', err);
  }
}

async function saveLastWorkspacePath(wsPath: string): Promise<void> {
  await writeFile(LAST_WS_FILE, JSON.stringify({ path: wsPath }), 'utf8');
  await pushRecentWorkspace(wsPath);
}

async function readLastWorkspacePath(): Promise<string | null> {
  try {
    const raw = await readFile(LAST_WS_FILE, 'utf8');
    return (JSON.parse(raw) as { path: string }).path ?? null;
  } catch {
    return null;
  }
}

let workspaceDir: string | null = null;
let workspaceFile: string | null = null;

// Mirror of settings.git.useEnclosingRepo (see git-scope.ts), so git handlers
// can read it synchronously without the manifest in hand.
let gitScopePref = false;
export function getGitScopePref(): boolean { return gitScopePref; }

/** Apply a workspace's git preference and drop the cached repo-root lookup. */
function applyGitPref(ws: Workspace | null | undefined): void {
  gitScopePref = ws?.settings?.git?.useEnclosingRepo === true;
  clearGitScopeCache();
}

async function atomicWrite(path: string, data: string): Promise<void> {
  // Skip the write when unchanged, so re-serializing doesn't show up as a
  // phantom git modification.
  try {
    if (await readFile(path, 'utf8') === data) return;
  } catch { /* file does not exist yet */ }
  await writeFile(path, data, 'utf8');
}

/** Pretty JSON with a trailing newline, so a save never fights an editor's
 *  "insert final newline". */
function writeJson(path: string, value: unknown): Promise<void> {
  return atomicWrite(path, JSON.stringify(value, null, 2) + '\n');
}

/** Default `.gitignore` for a workspace: excludes secrets, dependencies,
 *  generated docs/reports, and OS/editor noise. `.vscode/` is kept (its
 *  settings.json is part of the workspace contract). */
export const SPECTOR_GITIGNORE = [
  '# API Spector - never commit secrets',
  '*.secrets',
  '.env',
  '.env.local',
  '.env.*.local',
  '',
  '# Dependencies',
  'node_modules/',
  '',
  '# Generated API docs',
  'api-docs.html',
  'api-docs.md',
  'docs/',
  '',
  '# Run reports (api-spector run --output)',
  'reports/',
  '*-report.json',
  '*-report.xml',
  '*-report.html',
  'results.json',
  'results.xml',
  'results.html',
  'coverage/',
  '',
  '# Local session history (opt-in persistence)',
  'history.json',
  '',
  '# OS / editor',
  '.DS_Store',
  'Thumbs.db',
  '.idea/',
  '',
].join('\n');

/** Default README for a fresh workspace. The workspace filename is interpolated
 *  so the README references the right `.spector` file. */
function readmeContents(workspaceFileName: string): string {
  return [
    `# API tests`,
    ``,
    `This folder is an [API Spector](https://github.com/testsmith-io/api-spector) workspace.`,
    `Everything here is plain JSON - diff it, commit it, review it like any other code.`,
    ``,
    `## Layout`,
    ``,
    '```',
    `${workspaceFileName}      ← workspace manifest (this is what you "open")`,
    `collections/              ← your request collections`,
    `environments/             ← per-env variable files (dev, staging, prod, …)`,
    `mocks/                    ← saved mock servers (optional)`,
    `contracts/                ← pinned OpenAPI snapshots (optional)`,
    `flows/                    ← visual flows chaining saved requests (optional)`,
    `.gitignore                ← excludes secrets, generated docs, run reports`,
    `.vscode/settings.json     ← maps *.spector to JSON for editor highlighting`,
    '```',
    ``,
    `## Open the workspace`,
    ``,
    '```bash',
    `# launches the GUI in this folder`,
    `npx -y @testsmith/api-spector ui`,
    '```',
    ``,
    `## Run the tests from CI`,
    ``,
    '```bash',
    `npx -y @testsmith/api-spector run \\`,
    `  --workspace ./${workspaceFileName} \\`,
    `  --environment ci \\`,
    `  --output reports/results.xml --format junit`,
    '```',
    ``,
    `Other useful commands:`,
    ``,
    `| Command | What it does |`,
    `|---|---|`,
    `| \`api-spector run\`       | Execute requests / assertions |`,
    `| \`api-spector mock\`      | Start mock servers from this workspace |`,
    `| \`api-spector contract\`  | Manage and run pinned contract snapshots |`,
    `| \`api-spector wsdl\`      | Inspect a WSDL or import as collection / mock |`,
    ``,
    `## A note on secrets`,
    ``,
    `Secret values (passwords, OAuth client secrets, API keys) are stored in your`,
    `OS keychain - **not** in this folder. Environment files only reference the`,
    `keychain entry by name, so it's safe to commit them.`,
    ``,
  ].join('\n');
}

/** Write `README.md` only when absent - never overwrite an existing one. */
export async function ensureReadme(workspaceDir: string, workspaceFileName: string): Promise<void> {
  const path = join(workspaceDir, 'README.md');
  try {
    await readFile(path, 'utf8');
    return; // already present, leave alone
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('file-handler: could not check README.md', err);
      return;
    }
    await atomicWrite(path, readmeContents(workspaceFileName));
  }
}

/** Write `.gitignore` only when absent - never overwrite a hand-tuned one. */
export async function ensureGitignore(workspaceDir: string): Promise<void> {
  const path = join(workspaceDir, '.gitignore');
  try {
    await readFile(path, 'utf8');
    return; // already present, leave alone
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('file-handler: could not check .gitignore', err);
      return;
    }
    await atomicWrite(path, SPECTOR_GITIGNORE);
  }
}

/** Map `*.spector` to JSON in the workspace's `.vscode/settings.json` so editors
 *  highlight the manifest. Idempotent and non-destructive: merges into existing
 *  keys, leaves invalid JSON alone. */
async function ensureVscodeFileAssociation(workspaceDir: string): Promise<void> {
  const dir  = join(workspaceDir, '.vscode');
  const file = join(dir, 'settings.json');

  try {
    const raw = await readFile(file, 'utf8');
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Can't safely round-trip hand-edited/commented JSON; bail rather than
      // overwrite the user's config.
      return;
    }
    const associations = (parsed['files.associations'] as Record<string, string> | undefined) ?? {};
    if (associations['*.spector'] === 'json') return; // already set
    parsed['files.associations'] = { ...associations, '*.spector': 'json' };
    await atomicWrite(file, JSON.stringify(parsed, null, 2) + '\n');
  } catch (err) {
    // ENOENT: file/dir doesn't exist yet, create both.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('file-handler: could not read existing .vscode/settings.json', err);
      return;
    }
    await mkdir(dir, { recursive: true });
    const fresh = { 'files.associations': { '*.spector': 'json' } };
    await atomicWrite(file, JSON.stringify(fresh, null, 2) + '\n');
  }
}

/** Starting directory for file dialogs: the CLI launch cwd when present. */
function dialogStartDir(): string | undefined {
  return process.env.API_SPECTOR_LAUNCH_CWD || workspaceDir || undefined;
}

/** Default workspace filename from the cwd basename, or a generic name. */
function defaultWorkspaceName(): string {
  const cwd = process.env.API_SPECTOR_LAUNCH_CWD;
  if (cwd) {
    const base = cwd.split(/[\\/]/).findLast(Boolean);
    if (base && /^[a-zA-Z0-9._-]+$/.test(base)) return `${base}.spector`;
  }
  return 'my-workspace.spector';
}

// Cloud workspace sync: serialize / apply helpers

const SYNC_SKIP_DIRS = new Set(['.git', 'node_modules']);
const SYNC_SKIP_FILES = new Set(['history.json']);

/** Strip resolved secret material before an environment leaves the machine:
 *  drop the encrypted blob/salt/iv/hash and blank secret values. Plain values
 *  and references are kept. */
function stripEnvSecrets(text: string): string {
  try {
    const env = JSON.parse(text) as { variables?: Record<string, unknown>[] };
    if (Array.isArray(env.variables)) {
      env.variables = env.variables.map(v => {
        const rest: Record<string, unknown> = { ...v };
        delete rest['secretEncrypted'];
        delete rest['secretSalt'];
        delete rest['secretIv'];
        delete rest['secretHash'];
        if (rest['secret']) rest['value'] = '';
        return rest;
      });
    }
    return JSON.stringify(env, null, 2);
  } catch {
    return text;
  }
}

/** Merge local secret values (matched by key) into a pulled environment so a
 *  pull never wipes them. Structure/order come from the remote. */
function mergeEnvSecrets(remoteText: string, localText: string | null): string {
  if (!localText) return remoteText;
  try {
    const remote = JSON.parse(remoteText) as { variables?: Record<string, unknown>[] };
    const local = JSON.parse(localText) as { variables?: Record<string, unknown>[] };
    const byKey = new Map<string, Record<string, unknown>>();
    for (const lv of local.variables ?? []) byKey.set(String(lv['key']), lv);
    remote.variables = (remote.variables ?? []).map(rv => {
      const lv = byKey.get(String(rv['key']));
      if (!lv) return rv;
      const merged: Record<string, unknown> = { ...rv };
      for (const f of ['secretEncrypted', 'secretSalt', 'secretIv', 'secretHash']) {
        if (lv[f] !== undefined) merged[f] = lv[f];
      }
      if (rv['secret'] && lv['value']) merged['value'] = lv['value'];
      return merged;
    });
    return JSON.stringify(remote, null, 2);
  } catch {
    return remoteText;
  }
}

/** Recursively list workspace files (relative path, forward-slash), skipping
 *  git / node_modules and the gitignored session history. */
async function walkWorkspaceFiles(dir: string, base: string, out: Record<string, string>): Promise<void> {
  const entries: Dirent[] = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SYNC_SKIP_DIRS.has(entry.name)) continue;
      await walkWorkspaceFiles(join(dir, entry.name), base, out);
    } else if (entry.isFile()) {
      if (SYNC_SKIP_FILES.has(entry.name)) continue;
      const full = join(dir, entry.name);
      out[full.slice(base.length + 1).split(sep).join('/')] = await readFile(full, 'utf8');
    }
  }
}

export function registerFileHandlers(ipc: IpcMain): void {
  handleIpc(ipc, IPC.file.openWorkspace, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Workspace',
      defaultPath: dialogStartDir(),
      filters: [{ name: 'API Spector Workspace', extensions: ['spector', 'json'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const wsPath = result.filePaths[0];
    const raw = await readFile(wsPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;

    // A collection saved with a .spector extension: offer to wrap it in a
    // workspace rather than failing to open.
    if (looksLikeCollection(parsed)) {
      const { response } = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Create Workspace', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        message: 'This is a collection, not a workspace.',
        detail: `API Spector opens workspaces, which contain collections.\n\nCreate a workspace in this folder and add "${basename(wsPath)}" to it? The collection is moved into a collections/ folder and this file becomes the workspace.`,
      });
      if (response !== 0) return null;
      return wrapCollectionAsWorkspace(wsPath, parsed as Collection);
    }

    workspaceDir = dirname(wsPath);
    workspaceFile = wsPath;
    await loadGlobals(workspaceDir);
    await saveLastWorkspacePath(wsPath);
    setSecretsConfig((parsed as Workspace).settings?.secrets);
    applyGitPref(parsed as Workspace);
    return { workspace: parsed as Workspace, workspacePath: wsPath };
  });

  handleIpc(ipc, IPC.file.newWorkspace, async () => {
    // Default the save dialog to the CLI launch folder with a name from its
    // basename, so a fresh workspace doesn't land in ~/Documents.
    const startDir = dialogStartDir();
    const defaultPath = startDir
      ? join(startDir, defaultWorkspaceName())
      : defaultWorkspaceName();
    const result = await dialog.showSaveDialog({
      title: 'Create Workspace',
      defaultPath,
      filters: [{ name: 'API Spector Workspace', extensions: ['spector', 'json'] }]
    });
    if (result.canceled || !result.filePath) return null;
    // Inside an existing repo: auto-enable scoped git mode so the panel versions
    // only this folder (see git-scope.ts). A repo root or no repo scaffolds a
    // standalone workspace.
    const dir = dirname(result.filePath);
    const enclosing = await detectEnclosingRepo(dir);
    return scaffoldWorkspace(dir, basename(result.filePath), enclosing ?? undefined);
  });

  handleIpc(ipc, IPC.file.saveWorkspace, async (_e, ws: Workspace) => {
    if (!workspaceFile) return;
    setSecretsConfig(ws.settings?.secrets); // apply edited connection config at once
    applyGitPref(ws); // pick up a scoped-mode toggle saved from the panel
    await writeJson(workspaceFile, ws);
    // Backfill the file-association for pre-existing workspaces. Idempotent.
    if (workspaceDir) await ensureVscodeFileAssociation(workspaceDir);
  });

  handleIpc(ipc, IPC.file.loadCollection, async (_e, relPath: string) => {
    if (!workspaceDir) throw new Error('No workspace open');
    const fullPath = resolve(workspaceDir, relPath);
    const raw = await readFile(fullPath, 'utf8');
    // Resolve any externalized data tables (data/*.csv) back into `dataSet`.
    return inlineDataSets(JSON.parse(raw) as Collection, dirname(fullPath));
  });

  handleIpc(ipc, IPC.file.saveCollection, async (_e, relPath: string, col: Collection) => {
    if (!workspaceDir) throw new Error('No workspace open');
    const fullPath = resolve(workspaceDir, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    // Data tables go to separate CSVs under data/. externalizeDataSets returns a
    // deep clone, so stripping its OAuth token cache keeps tokens out of the
    // .spector file without clearing the live session cache.
    const toWrite = await externalizeDataSets(col, dirname(fullPath));
    stripEphemeralAuth(toWrite);
    await writeJson(fullPath, toWrite);
  });

  handleIpc(ipc, IPC.file.loadEnvironment, async (_e, relPath: string) => {
    if (!workspaceDir) throw new Error('No workspace open');
    const raw = await readFile(resolve(workspaceDir, relPath), 'utf8');
    return JSON.parse(raw) as Environment;
  });

  handleIpc(ipc, IPC.file.saveEnvironment, async (_e, relPath: string, env: Environment) => {
    if (!workspaceDir) throw new Error('No workspace open');
    const fullPath = resolve(workspaceDir, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeJson(fullPath, env);
  });

  handleIpc(ipc, IPC.file.loadFlow, async (_e, relPath: string) => {
    if (!workspaceDir) throw new Error('No workspace open');
    const raw = await readFile(resolve(workspaceDir, relPath), 'utf8');
    return JSON.parse(raw) as Flow;
  });

  handleIpc(ipc, IPC.file.saveFlow, async (_e, relPath: string, flow: Flow) => {
    if (!workspaceDir) throw new Error('No workspace open');
    const fullPath = resolve(workspaceDir, relPath);
    // Older workspaces predate the flows/ dir; create it on first save.
    await mkdir(dirname(fullPath), { recursive: true });
    await writeJson(fullPath, flow);
  });

  /** Delete a workspace-relative file, constrained to the workspace dir.
   *  Idempotent (missing files are not an error). */
  handleIpc(ipc, IPC.file.deleteWorkspaceFile, async (_e, relPath: string) => {
    if (!workspaceDir) throw new Error('No workspace open');
    const fullPath = resolve(workspaceDir, relPath);
    // Reject any path that escapes the workspace dir.
    if (!fullPath.startsWith(resolve(workspaceDir) + (process.platform === 'win32' ? '\\' : '/'))) {
      throw new Error(`Refusing to delete file outside the workspace: ${relPath}`);
    }
    try {
      await unlink(fullPath);
    } catch (err) {
      // ENOENT (already gone): treat as success so callers can fire-and-forget.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  });

  // Secret-free snapshot for cloud sync: the manifest (minus machine-local
  // cloud/sync settings) and every workspace file, env secrets stripped.
  handleIpc(ipc, IPC.file.serializeWorkspace, async () => {
    if (!workspaceDir || !workspaceFile) throw new Error('No workspace open');
    const manifest = JSON.parse(await readFile(workspaceFile, 'utf8')) as Workspace;
    const files: Record<string, string> = {};
    await walkWorkspaceFiles(workspaceDir, workspaceDir, files);
    const manifestName = basename(workspaceFile);
    delete files[manifestName];                       // the manifest travels separately
    for (const rel of Object.keys(files)) {
      if (rel.startsWith('environments/')) files[rel] = stripEnvSecrets(files[rel]);
    }
    const sharedSettings: Record<string, unknown> = { ...(manifest.settings ?? {}) };
    delete sharedSettings['cloud'];
    delete sharedSettings['sync'];
    return { manifest: { ...manifest, settings: sharedSettings }, manifestName, files };
  });

  // Apply a pulled snapshot: back up, write files (merging local env secrets),
  // then merge the manifest keeping local cloud/sync settings.
  handleIpc(ipc, IPC.file.applyWorkspaceSnapshot, async (_e, snap: { manifest: Workspace; files: Record<string, string> }) => {
    if (!workspaceDir || !workspaceFile) throw new Error('No workspace open');

    // Restore point (excludes .git / node_modules).
    try {
      const backupDir = join(app.getPath('userData'), 'sync-backups', basename(workspaceDir) + '-' + Date.now());
      await cp(workspaceDir, backupDir, {
        recursive: true,
        filter: (src) => {
          const rel = src.slice(workspaceDir!.length);
          return !/[\\/](\.git|node_modules)([\\/]|$)/.test(rel);
        },
      });
    } catch (err) {
      console.warn('sync: workspace backup failed (continuing):', err);
    }

    const guard = resolve(workspaceDir) + (process.platform === 'win32' ? '\\' : '/');
    let filesWritten = 0;
    for (const [rel, content] of Object.entries(snap.files ?? {})) {
      const full = resolve(workspaceDir, rel);
      if (!full.startsWith(guard)) continue;          // never write outside the workspace
      let out = content;
      if (rel.startsWith('environments/')) {
        let localText: string | null = null;
        try { localText = await readFile(full, 'utf8'); } catch { /* new environment */ }
        out = mergeEnvSecrets(content, localText);
      }
      await mkdir(dirname(full), { recursive: true });
      await atomicWrite(full, out);
      filesWritten++;
    }

    // Structural arrays come from remote; machine-local settings stay local.
    const local = JSON.parse(await readFile(workspaceFile, 'utf8')) as Workspace;
    const merged: Workspace = {
      ...local,
      ...snap.manifest,
      settings: { ...(snap.manifest.settings ?? {}), ...(local.settings ?? {}) },
    };
    await writeJson(workspaceFile, merged);
    return {
      ok: true,
      filesWritten,
      collections: Array.isArray(merged.collections) ? merged.collections.length : 0,
      workspace: merged,
      workspacePath: workspaceFile,
    };
  });

  // Opt-in session-history persistence: a plain JSON array in the workspace
  // dir (gitignored). Load returns [] when the file is absent or unreadable.
  handleIpc(ipc, IPC.file.loadHistory, async (): Promise<unknown[]> => {
    if (!workspaceDir) return [];
    try {
      const raw = await readFile(join(workspaceDir, 'history.json'), 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  handleIpc(ipc, IPC.file.saveHistory, async (_e, entries: unknown[]): Promise<void> => {
    if (!workspaceDir) return;
    await writeFile(join(workspaceDir, 'history.json'), JSON.stringify(entries, null, 2), 'utf8');
  });

  handleIpc(ipc, IPC.dialog.pickDir, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Output Directory',
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  handleIpc(ipc, IPC.dialog.pickFile, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select File',
      properties: ['openFile']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  handleIpc(ipc, IPC.results.save, async (_e, content: string, defaultName: string) => {
    const ext = defaultName.endsWith('.xml') ? 'xml' : defaultName.endsWith('.html') ? 'html' : 'json';
    const allFilters = [
      { name: 'JSON',     extensions: ['json'] },
      { name: 'JUnit XML', extensions: ['xml'] },
      { name: 'HTML',     extensions: ['html'] },
    ];
    const result = await dialog.showSaveDialog({
      title: 'Save Test Results',
      defaultPath: defaultName,
      filters: ext === 'xml'   ? [allFilters[1], allFilters[0], allFilters[2]]
              : ext === 'html' ? [allFilters[2], allFilters[0], allFilters[1]]
              :                  [allFilters[0], allFilters[1], allFilters[2]],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, content, 'utf8');
    return true;
  });

  // Globals
  handleIpc(ipc, IPC.globals.get, () => getGlobals());

  handleIpc(ipc, IPC.globals.set, async (_e, patch: Record<string, string>) => {
    setGlobals(patch);
    await persistGlobals();
  });

  handleIpc(ipc, IPC.file.closeWorkspace, async () => {
    workspaceDir  = null;
    workspaceFile = null;
    applyGitPref(null);
    // Clear so the next launch shows the welcome screen. If user-data is
    // read-only this logs and the previous workspace reloads instead.
    await writeFile(LAST_WS_FILE, JSON.stringify({ path: null }), 'utf8').catch(err => {
      console.warn('file-handler: could not clear last-workspace pointer', err);
    });
  });

  handleIpc(ipc, IPC.file.getLastWorkspace, async () => {
    // Launch order: 1) CLI launch cwd (API_SPECTOR_LAUNCH_CWD) opens its .spector, else null for
    //    the welcome screen (no fallback to the previous workspace - the user chose this dir);
    //    2) otherwise the remembered last-workspace path (dock/menu launch).
    const cwd = process.env.API_SPECTOR_LAUNCH_CWD;
    if (cwd) {
      const fromCwd = await tryOpenWorkspaceInDir(cwd);
      // Whether or not a workspace was found, this is the answer.
      return fromCwd;
    }

    const wsPath = await readLastWorkspacePath();
    if (!wsPath) return null;
    try {
      const raw = await readFile(wsPath, 'utf8');
      const workspace = JSON.parse(raw) as Workspace;
      // Set the module globals only after the load succeeds, so a stale path
      // doesn't leave the main process pretending a workspace is open.
      workspaceDir = dirname(wsPath);
      workspaceFile = wsPath;
      await loadGlobals(workspaceDir);
      setSecretsConfig(workspace.settings?.secrets);
      applyGitPref(workspace);
      return { workspace, workspacePath: wsPath };
    } catch {
      return null;
    }
  });

  // Recent-workspaces list, pruned of entries whose file no longer exists.
  handleIpc(ipc, IPC.file.getRecentWorkspaces, async () => {
    const list = await readRecentWorkspaces();
    const alive = await Promise.all(list.map(async r => {
      try { await readFile(r.path, 'utf8'); return r; } catch { return null; }
    }));
    return alive.filter((r): r is RecentWorkspace => r !== null);
  });

  // Open a workspace by path (no dialog) - used by the recent-workspaces list.
  handleIpc(ipc, IPC.file.openWorkspacePath, async (_e, wsPath: string) => {
    let raw: string;
    try {
      raw = await readFile(wsPath, 'utf8');
    } catch {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (looksLikeCollection(parsed)) return null; // not a workspace
    workspaceDir = dirname(wsPath);
    workspaceFile = wsPath;
    await loadGlobals(workspaceDir);
    await saveLastWorkspacePath(wsPath);
    setSecretsConfig((parsed as Workspace).settings?.secrets);
    applyGitPref(parsed as Workspace);
    return { workspace: parsed as Workspace, workspacePath: wsPath };
  });

  // Open a Git repository: pick a destination folder, clone it (zip download
  // fallback for public repos when git is absent), and open the workspace it
  // contains. Returns null if the user cancels; throws on other failures.
  handleIpc(ipc, IPC.file.openFromGit, async (_e, repoUrl: string) => {
    const url = repoUrl.trim();
    if (!url) throw new Error('Enter a repository URL');

    const pick = await dialog.showOpenDialog({
      title: 'Choose a folder to clone the repository into',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Clone here',
    });
    if (pick.canceled || pick.filePaths.length === 0) return null;
    const parent = pick.filePaths[0];

    // Folder name from the repo URL; refuse to overwrite existing content.
    const repoName =
      ((/[/:]([^/:]+?)(?:\.git)?\/?$/.exec(url))?.[1] ?? 'repository')
        .replaceAll(/[^a-zA-Z0-9._-]+/g, '-') || 'repository';
    const destDir = join(parent, repoName);
    try {
      const existing = await readdir(destDir);
      if (existing.length > 0) {
        throw new Error(`"${repoName}" already exists in that folder and is not empty`);
      }
    } catch (err) {
      // ENOENT is expected (folder doesn't exist yet); rethrow the not-empty error.
      if (err instanceof Error && err.message.includes('already exists')) throw err;
    }

    // Prefer `git clone`: supports private repos, keeps history, and wires up
    // `origin` for the Git panel. Fall back to a zip download for public repos
    // when the git binary isn't available.
    try {
      await simpleGit(parent).clone(url, destDir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const gitMissing = /not found|ENOENT|not recognized|command not found|spawn git/i.test(msg);
      const archiveUrl = gitMissing ? await resolveArchiveUrl(url).catch(() => null) : null;
      if (gitMissing && archiveUrl) {
        await mkdir(destDir, { recursive: true });
        const buf = await downloadArchive(archiveUrl);
        await extractZip(buf, destDir);
      } else {
        throw new Error(`git clone failed: ${msg}`);
      }
    }

    const found = await findWorkspaceSpectors(destDir);
    if (found.length === 0) {
      // No workspace yet: let the user pick or create a subfolder and scaffold
      // one there.
      return addWorkspaceIntoProject(destDir);
    }
    if (found.length > 1) throw new Error('multiple workspace files found — open the folder and pick one');
    const wsPath = found[0];
    const parsed = JSON.parse(await readFile(wsPath, 'utf8')) as Workspace;
    workspaceDir = dirname(wsPath);
    workspaceFile = wsPath;
    await loadGlobals(workspaceDir);
    await saveLastWorkspacePath(wsPath);
    setSecretsConfig(parsed.settings?.secrets);
    applyGitPref(parsed);
    return { workspace: parsed, workspacePath: wsPath };
  });

  // Add tests to an existing local project: pick the project folder, then a
  // subfolder for the tests, and scaffold a workspace there (scoped git mode
  // when inside a repo).
  handleIpc(ipc, IPC.file.addToProject, async () => {
    const projPick = await dialog.showOpenDialog({
      title: 'Select the project to add API Spector tests to',
      properties: ['openDirectory'],
      buttonLabel: 'Select project',
    });
    if (projPick.canceled || projPick.filePaths.length === 0) return null;
    return addWorkspaceIntoProject(projPick.filePaths[0]);
  });
}

/** Open the single `*.spector` in `dir` and return it. Null when the dir is
 *  empty, unreadable, or holds multiple workspaces (ambiguous). */
async function tryOpenWorkspaceInDir(dir: string): Promise<{ workspace: Workspace; workspacePath: string } | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const candidates = entries.filter(f => f.endsWith('.spector'));
  if (candidates.length !== 1) return null;
  const wsPath = join(dir, candidates[0]);
  try {
    const raw = await readFile(wsPath, 'utf8');
    const workspace = JSON.parse(raw) as Workspace;
    workspaceDir = dir;
    workspaceFile = wsPath;
    await loadGlobals(workspaceDir);
    setSecretsConfig(workspace.settings?.secrets);
    applyGitPref(workspace);
    return { workspace, workspacePath: wsPath };
  } catch {
    return null;
  }
}

export function getWorkspaceDir(): string | null {
  return workspaceDir;
}

/** True when the JSON is a Collection, not a Workspace manifest (rootFolder/
 *  requests but no `collections` list). */
function looksLikeCollection(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return !Array.isArray(o['collections']) && (!!o['rootFolder'] || !!o['requests']);
}

// Open from Git (public repos, download + extract, no git binary)

/** Cap the download so a hostile or mistyped URL can't fill the disk. */
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024; // 100 MB

/** Map a public repo URL to a downloadable .zip URL: GitHub repo URLs (optional
 *  `/tree/<branch>`, default branch resolved via the API) or any `.zip` link.
 *  Null for anything else. */
async function resolveArchiveUrl(input: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  // Already a zip archive - download it directly.
  if (url.pathname.toLowerCase().endsWith('.zip')) return url.toString();

  // GitHub repository URL: https://github.com/<owner>/<repo>[/tree/<branch>]
  if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
    const parts = url.pathname.replaceAll(/^\/+|\/+$/g, '').split('/');
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, '');
    let branch: string | null = null;
    if (parts[2] === 'tree' && parts[3]) branch = parts.slice(3).join('/');
    if (!branch) {
      // Ask the API for the repo's default branch. Needs a User-Agent header.
      try {
        const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: { 'User-Agent': 'API-Spector', Accept: 'application/vnd.github+json' },
        });
        if (!resp.ok) return null;
        const meta = (await resp.json()) as { default_branch?: string };
        branch = meta.default_branch ?? 'main';
      } catch {
        return null;
      }
    }
    return `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${branch}`;
  }

  return null;
}

/** Download an archive to memory, enforcing the size cap. */
async function downloadArchive(archiveUrl: string): Promise<Buffer> {
  const resp = await fetch(archiveUrl, { headers: { 'User-Agent': 'API-Spector' } });
  if (!resp.ok) throw new Error(`download failed (HTTP ${resp.status})`);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.byteLength > MAX_ARCHIVE_BYTES) throw new Error('archive is too large');
  return buf;
}

/** Extract a zip into `destDir`, stripping the single top-level folder that
 *  GitHub (and most `git archive` zips) wrap every entry in. Guards against
 *  path traversal by resolving each entry under destDir. */
async function extractZip(buf: Buffer, destDir: string): Promise<void> {
  const zip = await JSZip.loadAsync(buf);
  const paths = Object.keys(zip.files);

  // Detect a common single root folder to strip.
  let root: string | null = null;
  for (const p of paths) {
    const top = p.split('/')[0];
    if (root === null) root = top;
    else if (root !== top) { root = null; break; }
  }
  const prefix = root ? `${root}/` : '';

  for (const p of paths) {
    const entry = zip.files[p];
    const rel = prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p;
    if (!rel) continue;
    const outPath = resolve(destDir, rel);
    if (outPath !== destDir && !outPath.startsWith(destDir + sep)) {
      throw new Error('archive contains an unsafe path');
    }
    if (entry.dir) {
      await mkdir(outPath, { recursive: true });
    } else {
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, Buffer.from(await entry.async('nodebuffer')));
    }
  }
}

/** Find every workspace (`*.spector`, not a bare collection) under `dir`,
 *  skipping node_modules and .git. */
async function findWorkspaceSpectors(dir: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        await walk(full);
      } else if (e.isFile() && e.name.endsWith('.spector')) {
        try {
          const parsed = JSON.parse(await readFile(full, 'utf8')) as unknown;
          if (!looksLikeCollection(parsed)) found.push(full);
        } catch { /* skip unparseable */ }
      }
    }
  }
  await walk(dir);
  return found;
}

/** Describe the enclosing repo when `dir` is a subfolder of a repo (not the
 *  root). Null when `dir` is the repo root or not in a repo. */
async function detectEnclosingRepo(
  dir: string,
): Promise<{ name: string; scope: string } | null> {
  try {
    const top = (await simpleGit(dir).revparse(['--show-toplevel'])).trim();
    if (!top) return null;
    const rel = relative(top, dir);
    if (rel === '' || rel.startsWith('..')) return null;
    return { name: basename(top), scope: rel.split(sep).join('/') };
  } catch {
    return null;
  }
}

/** Scaffold a new workspace in `dir` (folders, .gitignore, .vscode, README,
 *  manifest), make it active, and return it. `enclosing` opts the manifest into
 *  scoped git mode and is echoed back for renderer confirmation. */
async function scaffoldWorkspace(
  dir: string,
  wsFileName: string,
  enclosing?: { name: string; scope: string },
): Promise<{ workspace: Workspace; workspacePath: string; enclosingRepo?: { name: string; scope: string } }> {
  await mkdir(join(dir, 'collections'), { recursive: true });
  await mkdir(join(dir, 'environments'), { recursive: true });
  await mkdir(join(dir, 'flows'), { recursive: true });
  await ensureGitignore(dir);
  await ensureVscodeFileAssociation(dir);
  await ensureReadme(dir, wsFileName);

  const ws: Workspace = {
    version: '1.0',
    collections: [],
    environments: [],
    activeEnvironmentId: null,
    ...(enclosing ? { settings: { git: { useEnclosingRepo: true } } } : {}),
  };
  const wsPath = join(dir, wsFileName);
  await writeJson(wsPath, ws);

  workspaceDir = dir;
  workspaceFile = wsPath;
  await loadGlobals(dir);
  await saveLastWorkspacePath(wsPath);
  setSecretsConfig(ws.settings?.secrets);
  applyGitPref(ws);
  return { workspace: ws, workspacePath: wsPath, enclosingRepo: enclosing };
}

/** Shared by "Open from Git" (when the clone has no workspace) and "Add to a
 *  project folder": pick or create a subfolder inside `projectDir`, then
 *  scaffold a workspace there. Returns null if the user cancels the picker. */
async function addWorkspaceIntoProject(
  projectDir: string,
): Promise<{ workspace: Workspace; workspacePath: string; enclosingRepo?: { name: string; scope: string } } | null> {
  const sub = await dialog.showOpenDialog({
    title: 'Choose or create a folder for API Spector tests',
    defaultPath: projectDir,
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Add here',
  });
  if (sub.canceled || sub.filePaths.length === 0) return null;
  const targetDir = sub.filePaths[0];
  const within = targetDir === projectDir || targetDir.startsWith(projectDir + sep);
  if (!within) throw new Error('Choose a folder inside the selected project');

  const enclosing = await detectEnclosingRepo(targetDir);
  const name = `${basename(targetDir) || 'api-tests'}.spector`;
  return scaffoldWorkspace(targetDir, name, enclosing ?? undefined);
}

/** Turn a collection file into a proper workspace: write the collection under
 *  collections/, then replace the picked file with a workspace manifest that
 *  references it. The collection content is preserved, just relocated. */
async function wrapCollectionAsWorkspace(
  collFilePath: string,
  collection: Collection,
): Promise<{ workspace: Workspace; workspacePath: string }> {
  const dir = dirname(collFilePath);
  const base = basename(collFilePath).replace(/\.(spector|json)$/i, '');
  const safe = base.replaceAll(/[^a-zA-Z0-9._-]+/g, '-').replaceAll(/^-+|-+$/g, '') || 'collection';
  const collRel = `collections/${safe}.json`;

  if (!collection.id) collection.id = randomUUID();
  await mkdir(join(dir, 'collections'), { recursive: true });
  await writeJson(join(dir, collRel), collection);

  const ws: Workspace = { version: '1.0', collections: [collRel], environments: [], activeEnvironmentId: null };
  await ensureGitignore(dir);
  await ensureVscodeFileAssociation(dir);
  await ensureReadme(dir, basename(collFilePath));
  // Replace the picked file with the manifest; its content now lives in
  // collections/.
  await writeJson(collFilePath, ws);

  workspaceDir = dir;
  workspaceFile = collFilePath;
  await loadGlobals(dir);
  await saveLastWorkspacePath(collFilePath);
  applyGitPref(ws);
  return { workspace: ws, workspacePath: collFilePath };
}
