// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react';
import { useWorkspaceLoader } from '../../hooks/useWorkspaceLoader';

const { electron } = window;

interface Recent { path: string; name: string; lastOpened: number }
interface UpdateInfo { current: string; latest: string; updateAvailable: boolean; command: string }

export function WelcomeScreen() {
  const { applyWorkspace } = useWorkspaceLoader();
  const [recents, setRecents] = useState<Recent[]>([]);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    electron.getRecentWorkspaces().then(setRecents).catch(() => setRecents([]));
    // Non-blocking, best-effort: stays null (nothing shown) if offline or current.
    electron.checkForUpdate().then(info => { if (info?.updateAvailable) setUpdate(info); }).catch(() => {});
  }, []);

  async function openWorkspace() {
    const result = await electron.openWorkspace();
    if (!result) return;
    await applyWorkspace(result.workspace, result.workspacePath);
  }

  async function newWorkspace() {
    const result = await electron.newWorkspace();
    if (!result) return;
    await applyWorkspace(result.workspace, result.workspacePath);
  }

  async function openRecent(path: string) {
    const result = await electron.openWorkspacePath(path);
    if (!result) {
      // File vanished or is no longer a workspace: drop it from the list.
      setRecents(prev => prev.filter(r => r.path !== path));
      return;
    }
    await applyWorkspace(result.workspace, result.workspacePath);
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center p-8">
      {update && (
        <div className="flex flex-col items-center gap-1 px-4 py-2 rounded-lg border border-blue-800 bg-blue-950/40 text-xs">
          <span className="text-blue-200">New version available (v{update.latest}, you have v{update.current})</span>
          <code className="text-[11px] text-blue-300 bg-surface-900 px-2 py-0.5 rounded select-all">{update.command}</code>
        </div>
      )}
      <div>
        <h1 className="text-2xl font-semibold mb-1">
          <span style={{ color: 'var(--wordmark-muted)' }}>API</span>{' '}
          <span style={{ color: '#6aa3c8' }}>Spector</span>
        </h1>
        <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
          by{' '}
          <button
            onClick={() => window.electron.openExternal('https://testsmith.io')}
            className="hover:underline focus:outline-none"
            style={{ color: '#6aa3c8' }}
          >
            Testsmith
          </button>
        </p>
        <p className="text-surface-400 text-sm max-w-sm">
          Local-first API testing with Robot Framework &amp; Playwright code generation.
          Secrets stay on your machine.
        </p>
        {__APP_VERSION__ && (
          <p className="text-[11px] mt-3" style={{ color: 'var(--text-muted)' }}>
            version {__APP_VERSION__}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 w-64">
        <button
          onClick={openWorkspace}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors"
        >
          Open Workspace
        </button>
        <button
          onClick={newWorkspace}
          className="px-4 py-2 bg-surface-800 hover:bg-surface-700 rounded text-sm font-medium transition-colors"
        >
          New Workspace
        </button>
      </div>

      {recents.length > 0 && (
        <div className="flex flex-col gap-1 w-72 text-left">
          <p className="text-[10px] uppercase tracking-wider font-semibold px-1" style={{ color: 'var(--text-muted)' }}>
            Recent workspaces
          </p>
          {recents.map(r => (
            <button
              key={r.path}
              onClick={() => openRecent(r.path)}
              title={r.path}
              className="flex flex-col items-start px-2 py-1.5 rounded hover:bg-surface-800 transition-colors text-left group"
            >
              <span className="text-xs text-surface-200 group-hover:text-white truncate max-w-full">{r.name}</span>
              <span className="text-[10px] text-surface-500 truncate max-w-full">{r.path}</span>
            </button>
          ))}
        </div>
      )}

      <p className="text-surface-400 text-xs max-w-xs">
        A workspace is a <code className="text-surface-500">.spector</code> file.
        Commit it and your collections to Git - secrets are stored in your OS keychain, never on disk.
      </p>
    </div>
  );
}
