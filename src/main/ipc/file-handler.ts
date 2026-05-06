// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { type IpcMain, dialog, app } from 'electron';
import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises';
import { join, dirname, resolve, basename } from 'path';
import type { Collection, Environment, Workspace } from '../../shared/types';
import { loadGlobals, getGlobals, setGlobals, persistGlobals } from '../globals-store';

const LAST_WS_FILE = join(app.getPath('userData'), 'last-workspace.json');

async function saveLastWorkspacePath(wsPath: string): Promise<void> {
  await writeFile(LAST_WS_FILE, JSON.stringify({ path: wsPath }), 'utf8');
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

function atomicWrite(path: string, data: string): Promise<void> {
  return writeFile(path, data, 'utf8');
}

/** Default `.gitignore` for an API Spector workspace. Excludes:
 *  - secrets / env files (we never want these committed)
 *  - dependency installs if the user runs `npm i` inside the workspace
 *  - generated artifacts: docs from `electron.generateDocs`, run reports
 *    written by `api-spector run --output`, coverage from CI
 *  - OS / editor noise (.DS_Store, .idea — we keep `.vscode/` because
 *    `settings.json` is part of the workspace contract)
 */
export const SPECTOR_GITIGNORE = [
  '# API Spector — never commit secrets',
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
  '# OS / editor',
  '.DS_Store',
  'Thumbs.db',
  '.idea/',
  '',
].join('\n');

/** Default README for a fresh workspace. Tells anyone who clones the repo
 *  what the folder is, where things live, and how to run the tests — both
 *  in the GUI and from CI. The workspace filename is interpolated so
 *  `cd my-tests && api-spector ui` produces a README that already references
 *  `my-tests.spector` correctly. */
function readmeContents(workspaceFileName: string): string {
  return [
    `# API tests`,
    ``,
    `This folder is an [API Spector](https://github.com/testsmith-io/api-spector) workspace.`,
    `Everything here is plain JSON — diff it, commit it, review it like any other code.`,
    ``,
    `## Layout`,
    ``,
    '```',
    `${workspaceFileName}      ← workspace manifest (this is what you "open")`,
    `collections/              ← your request collections`,
    `environments/             ← per-env variable files (dev, staging, prod, …)`,
    `mocks/                    ← saved mock servers (optional)`,
    `contracts/                ← pinned OpenAPI snapshots (optional)`,
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
    `OS keychain — **not** in this folder. Environment files only reference the`,
    `keychain entry by name, so it's safe to commit them.`,
    ``,
  ].join('\n');
}

/** Write `README.md` only when absent — never overwrite an existing one. */
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

/** Write `.gitignore` only when absent — never overwrite a hand-tuned one. */
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

/** Ensure the workspace's `.vscode/settings.json` maps `*.spector` to the JSON
 *  language so VS Code (and editors that read this file) syntax-highlight the
 *  workspace manifest without the user wiring it up manually each clone.
 *
 *  Idempotent and non-destructive: if the file already exists with other keys
 *  we merge our entry in; if it has invalid JSON we leave it alone rather than
 *  trash the user's config; if it already maps `*.spector`, no-op. */
async function ensureVscodeFileAssociation(workspaceDir: string): Promise<void> {
  const dir  = join(workspaceDir, '.vscode');
  const file = join(dir, 'settings.json');

  try {
    const raw = await readFile(file, 'utf8');
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Hand-edited / commented JSON we can't safely round-trip. Bail rather
      // than overwrite — the user's existing config is more important than
      // our convenience write.
      return;
    }
    const associations = (parsed['files.associations'] as Record<string, string> | undefined) ?? {};
    if (associations['*.spector'] === 'json') return; // already set
    parsed['files.associations'] = { ...associations, '*.spector': 'json' };
    await atomicWrite(file, JSON.stringify(parsed, null, 2) + '\n');
  } catch (err) {
    // ENOENT is the common path — file/dir doesn't exist yet, create both.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('file-handler: could not read existing .vscode/settings.json', err);
      return;
    }
    await mkdir(dir, { recursive: true });
    const fresh = { 'files.associations': { '*.spector': 'json' } };
    await atomicWrite(file, JSON.stringify(fresh, null, 2) + '\n');
  }
}

/** Pick a sensible starting directory for the file dialogs. When launched from
 *  the CLI we have the user's actual cwd; that beats whatever the OS would
 *  default to. */
function dialogStartDir(): string | undefined {
  return process.env.API_SPECTOR_LAUNCH_CWD || workspaceDir || undefined;
}

/** Derive a default workspace filename from the cwd: `/tmp/my-tests` → `my-tests.spector`.
 *  Falls back to a generic name if the cwd basename isn't usable. */
function defaultWorkspaceName(): string {
  const cwd = process.env.API_SPECTOR_LAUNCH_CWD;
  if (cwd) {
    const base = cwd.split(/[\\/]/).filter(Boolean).pop();
    if (base && /^[a-zA-Z0-9._-]+$/.test(base)) return `${base}.spector`;
  }
  return 'my-workspace.spector';
}

export function registerFileHandlers(ipc: IpcMain): void {
  ipc.handle('file:openWorkspace', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Workspace',
      defaultPath: dialogStartDir(),
      filters: [{ name: 'API Spector Workspace', extensions: ['spector', 'json'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const wsPath = result.filePaths[0];
    workspaceDir = dirname(wsPath);
    workspaceFile = wsPath;
    await loadGlobals(workspaceDir);
    await saveLastWorkspacePath(wsPath);
    const raw = await readFile(wsPath, 'utf8');
    return { workspace: JSON.parse(raw) as Workspace, workspacePath: wsPath };
  });

  ipc.handle('file:newWorkspace', async () => {
    // When launched from the CLI in a specific folder, default the save
    // dialog to that folder with a workspace name derived from the folder
    // basename (e.g. /tmp/my-tests → my-tests.spector). The user can still
    // navigate elsewhere or rename — this just removes the friction of
    // every fresh workspace landing in ~/Documents.
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
    workspaceDir = dirname(result.filePath);
    workspaceFile = result.filePath;
    await loadGlobals(workspaceDir);

    // Create data dirs
    await mkdir(join(workspaceDir, 'collections'), { recursive: true });
    await mkdir(join(workspaceDir, 'environments'), { recursive: true });

    // Write .gitignore (covers secrets, generated docs, run reports, etc.)
    await ensureGitignore(workspaceDir);

    // Write .vscode/settings.json so editors treat .spector as JSON without
    // the user having to map it manually each clone. Only writes if absent —
    // we never overwrite an existing project-level VS Code config.
    await ensureVscodeFileAssociation(workspaceDir);

    // Write a README so anyone who clones the workspace immediately knows
    // what's in it and how to run the tests.
    await ensureReadme(workspaceDir, basename(result.filePath));

    const ws: Workspace = {
      version: '1.0',
      collections: [],
      environments: [],
      activeEnvironmentId: null
    };
    await atomicWrite(result.filePath, JSON.stringify(ws, null, 2));
    await saveLastWorkspacePath(result.filePath);
    return { workspace: ws, workspacePath: result.filePath };
  });

  ipc.handle('file:saveWorkspace', async (_e, ws: Workspace) => {
    if (!workspaceFile) return;
    await atomicWrite(workspaceFile, JSON.stringify(ws, null, 2));
    // Backfill the editor file-association for workspaces created before this
    // helper existed. Idempotent — no-op if the file already maps *.spector.
    if (workspaceDir) await ensureVscodeFileAssociation(workspaceDir);
  });

  ipc.handle('file:loadCollection', async (_e, relPath: string) => {
    if (!workspaceDir) throw new Error('No workspace open');
    const raw = await readFile(resolve(workspaceDir, relPath), 'utf8');
    return JSON.parse(raw) as Collection;
  });

  ipc.handle('file:saveCollection', async (_e, relPath: string, col: Collection) => {
    if (!workspaceDir) throw new Error('No workspace open');
    const fullPath = resolve(workspaceDir, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await atomicWrite(fullPath, JSON.stringify(col, null, 2));
  });

  ipc.handle('file:loadEnvironment', async (_e, relPath: string) => {
    if (!workspaceDir) throw new Error('No workspace open');
    const raw = await readFile(resolve(workspaceDir, relPath), 'utf8');
    return JSON.parse(raw) as Environment;
  });

  ipc.handle('file:saveEnvironment', async (_e, relPath: string, env: Environment) => {
    if (!workspaceDir) throw new Error('No workspace open');
    const fullPath = resolve(workspaceDir, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await atomicWrite(fullPath, JSON.stringify(env, null, 2));
  });

  /** Delete a workspace-relative file (collection, environment, mock, …).
   *  Constrained to the workspace dir so a malicious renderer can't trick us
   *  into wiping files elsewhere. Idempotent — missing files are not an error. */
  ipc.handle('file:deleteWorkspaceFile', async (_e, relPath: string) => {
    if (!workspaceDir) throw new Error('No workspace open');
    const fullPath = resolve(workspaceDir, relPath);
    // Reject any path that escapes the workspace dir (`..`, absolute paths
    // resolved into another tree, etc.).
    if (!fullPath.startsWith(resolve(workspaceDir) + (process.platform === 'win32' ? '\\' : '/'))) {
      throw new Error(`Refusing to delete file outside the workspace: ${relPath}`);
    }
    try {
      await unlink(fullPath);
    } catch (err) {
      // ENOENT is the common case (file already gone) — treat as success so
      // callers can fire-and-forget without worrying about double-deletes.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  });

  ipc.handle('dialog:pickDir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Output Directory',
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipc.handle('results:save', async (_e, content: string, defaultName: string) => {
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

  // ── Globals ──────────────────────────────────────────────────────────────
  ipc.handle('globals:get', () => getGlobals());

  ipc.handle('globals:set', async (_e, patch: Record<string, string>) => {
    setGlobals(patch);
    await persistGlobals();
  });

  ipc.handle('file:closeWorkspace', async () => {
    workspaceDir  = null;
    workspaceFile = null;
    // Clear so the app shows the welcome screen on next launch. If the user-data
    // directory is read-only the next launch will simply auto-load the previous
    // workspace again — non-fatal but log so it shows up in diagnostics.
    await writeFile(LAST_WS_FILE, JSON.stringify({ path: null }), 'utf8').catch(err => {
      console.warn('file-handler: could not clear last-workspace pointer', err);
    });
  });

  ipc.handle('file:getLastWorkspace', async () => {
    // Launch order of preference:
    //   1. The CLI's launch cwd (set by bin/cli.js as API_SPECTOR_LAUNCH_CWD).
    //      If that folder contains a `.spector` file, open it. If the folder
    //      exists but has no workspace, return null so the welcome screen
    //      shows — *do not* fall back to the previous workspace, since the
    //      user explicitly chose this directory.
    //   2. The remembered last-workspace path (regular dock/menu launch).
    //
    // This makes `cd /tmp/empty && api-spector ui` show the welcome screen
    // instead of silently re-opening whatever was last open elsewhere.
    const cwd = process.env.API_SPECTOR_LAUNCH_CWD;
    if (cwd) {
      const fromCwd = await tryOpenWorkspaceInDir(cwd);
      // Either we found a workspace and opened it, or the user is in a folder
      // they meant to be empty — either way, this is the answer.
      return fromCwd;
    }

    const wsPath = await readLastWorkspacePath();
    if (!wsPath) return null;
    try {
      const raw = await readFile(wsPath, 'utf8');
      const workspace = JSON.parse(raw) as Workspace;
      // Only set the module-level globals once the load *actually* succeeds —
      // otherwise a stale path would leave the main process pretending a
      // workspace is open.
      workspaceDir = dirname(wsPath);
      workspaceFile = wsPath;
      await loadGlobals(workspaceDir);
      return { workspace, workspacePath: wsPath };
    } catch {
      return null;
    }
  });
}

/** Look for a `*.spector` file in `dir`. If exactly one is present (or the
 *  directory is the workspace dir of one), open it and return the loaded
 *  workspace. Otherwise return null — including when the directory is empty,
 *  unreadable, or contains multiple workspace files (ambiguous, defer to
 *  welcome screen so the user picks). */
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
    return { workspace, workspacePath: wsPath };
  } catch {
    return null;
  }
}

export function getWorkspaceDir(): string | null {
  return workspaceDir;
}
