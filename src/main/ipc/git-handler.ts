// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { type IpcMain } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import { simpleGit } from 'simple-git';
import { writeFile, mkdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import type { GitStatus, GitCommit, GitBranch, GitRemote } from '../../shared/types';
import { getWorkspaceDir, ensureGitignore } from './file-handler';

function git() {
  const dir = getWorkspaceDir();
  if (!dir) throw new Error('No workspace open');
  return simpleGit(dir);
}

export function registerGitHandlers(ipc: IpcMain): void {

  handleIpc(ipc, IPC.git.isRepo, async () => {
    // Check the workspace directory itself — NOT `git rev-parse --git-dir`,
    // which walks up the directory tree and may pick up an ancestor repo
    // (e.g. a `~/.git` dotfiles repo). When that happens, every subsequent
    // git command in the panel ends up running against the ancestor's
    // working tree (the entire home directory), which is what caused the
    // panel to wedge on Loading… while `git status` walked huge subtrees.
    const dir = getWorkspaceDir();
    if (!dir) return false;
    try {
      const s = await stat(join(dir, '.git'));
      return s.isDirectory() || s.isFile();  // file = worktree pointer
    } catch {
      return false;
    }
  });

  handleIpc(ipc, IPC.git.init, async () => {
    await git().init();
    // Ensure secrets / generated artifacts aren't committed when the user
    // initializes git on an existing workspace that pre-dates the auto-write.
    const dir = getWorkspaceDir();
    if (dir) await ensureGitignore(dir);
  });

  handleIpc(ipc, IPC.git.status, async (): Promise<GitStatus> => {
    const result = await git().status();
    return {
      staged:     result.staged.map(f => ({ path: f, status: resolveStatus(result, f, true) })),
      unstaged:   result.modified.filter(f => !result.staged.includes(f))
                    .concat(result.deleted.filter(f => !result.staged.includes(f)))
                    .map(f => ({ path: f, status: resolveStatus(result, f, false) })),
      untracked:  result.not_added.map(f => ({ path: f, status: 'untracked' as const })),
      conflicted: result.conflicted,
      branch:     result.current ?? '',
      ahead:      result.ahead,
      behind:     result.behind,
      remote:     result.tracking ?? null,
    };
  });

  handleIpc(ipc, IPC.git.resolveOurs, async (_e, filePath: string) => {
    const g = git();
    await g.checkout(['--ours', '--', filePath]);
    await g.add([filePath]);
  });

  handleIpc(ipc, IPC.git.resolveTheirs, async (_e, filePath: string) => {
    const g = git();
    await g.checkout(['--theirs', '--', filePath]);
    await g.add([filePath]);
  });

  handleIpc(ipc, IPC.git.markResolved, async (_e, filePath: string) => {
    await git().add([filePath]);
  });

  handleIpc(ipc, IPC.git.diff, async (_e, filePath?: string): Promise<string> => {
    if (filePath) return git().diff(['--', filePath]);
    return git().diff();
  });

  handleIpc(ipc, IPC.git.diffStaged, async (_e, filePath?: string): Promise<string> => {
    if (filePath) return git().diff(['--cached', '--', filePath]);
    return git().diff(['--cached']);
  });

  handleIpc(ipc, IPC.git.stage, async (_e, paths: string[]) => {
    await git().add(paths);
  });

  handleIpc(ipc, IPC.git.unstage, async (_e, paths: string[]) => {
    await git().reset(['HEAD', '--', ...paths]);
  });

  handleIpc(ipc, IPC.git.stageAll, async () => {
    await git().add(['.']);
  });

  handleIpc(ipc, IPC.git.commit, async (_e, message: string) => {
    await git().commit(message);
  });

  handleIpc(ipc, IPC.git.log, async (_e, limit: number = 50): Promise<GitCommit[]> => {
    const result = await git().log({ maxCount: limit });
    return result.all.map(c => ({
      hash:    c.hash,
      short:   c.hash.slice(0, 7),
      message: c.message,
      author:  c.author_name,
      email:   c.author_email,
      date:    c.date,
    }));
  });

  handleIpc(ipc, IPC.git.branches, async (): Promise<GitBranch[]> => {
    // The previous implementation passed a `--format=…` arg but then read
    // `result.all` (which simple-git doesn't honor when --format is set),
    // so upstream/ahead/behind were silently dropped. Run the format flag
    // via `raw` and parse line-by-line so we get the real metadata.
    const raw = await git().raw([
      'for-each-ref',
      '--format=%(refname:short)|%(HEAD)|%(upstream:short)|%(upstream:track)',
      'refs/heads', 'refs/remotes',
    ]);
    const current = (await git().branch()).current;

    const branches: GitBranch[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const [shortName, head, upstream, track] = line.split('|');
      if (!shortName || shortName.endsWith('/HEAD')) continue;
      const isRemote = shortName.startsWith('origin/') || shortName.includes('/');
      const looksLocal = !isRemote;

      // `--format=%(upstream:track)` → "[ahead 1, behind 2]" or empty
      let ahead: number | undefined;
      let behind: number | undefined;
      const aheadM  = track?.match(/ahead (\d+)/);
      const behindM = track?.match(/behind (\d+)/);
      if (aheadM)  ahead  = Number(aheadM[1]);
      if (behindM) behind = Number(behindM[1]);

      branches.push({
        name:     shortName,
        current:  looksLocal && (head === '*' || shortName === current),
        remote:   isRemote,
        upstream: upstream || undefined,
        ahead, behind,
      });
    }
    return branches;
  });

  handleIpc(ipc, IPC.git.checkout, async (_e, branch: string, create: boolean) => {
    if (create) {
      await git().checkoutLocalBranch(branch);
      return;
    }

    // If `branch` looks like a remote ref (e.g. "origin/feature-x") and no
    // local branch with that name exists, create a tracking branch instead
    // of erroring out. Matches the user expectation of clicking a remote
    // branch in the sidebar to "switch to it".
    const m = /^([^/]+)\/(.+)$/.exec(branch);
    if (m) {
      const remote     = m[1];
      const localName  = m[2];
      const localList  = await git().branchLocal();
      if (!localList.all.includes(localName)) {
        await git().checkoutBranch(localName, `${remote}/${localName}`);
        return;
      }
      // local exists with the same name — fall through to plain checkout of
      // the local one, which is what users almost always want.
      await git().checkout(localName);
      return;
    }

    await git().checkout(branch);
  });

  handleIpc(ipc, IPC.git.deleteBranch, async (_e, name: string, force: boolean = false) => {
    // simple-git's deleteLocalBranch wraps `git branch -d` (-D when force).
    await git().deleteLocalBranch(name, force);
  });

  handleIpc(ipc, IPC.git.pull, async () => {
    await git().pull();
  });

  handleIpc(ipc, IPC.git.push, async (_e, setUpstream: boolean) => {
    if (setUpstream) {
      const status = await git().status();
      await git().push(['--set-upstream', 'origin', status.current ?? 'main']);
    } else {
      await git().push();
    }
  });

  handleIpc(ipc, IPC.git.remotes, async (): Promise<GitRemote[]> => {
    const result = await git().getRemotes(true);
    return result.map(r => ({ name: r.name, url: r.refs.fetch || r.refs.push || '' }));
  });

  handleIpc(ipc, IPC.git.addRemote, async (_e, name: string, url: string) => {
    await git().addRemote(name, url);
  });

  handleIpc(ipc, IPC.git.setRemoteUrl, async (_e, name: string, url: string) => {
    await git().remote(['set-url', name, url]);
  });

  handleIpc(ipc, IPC.git.removeRemote, async (_e, name: string) => {
    await git().removeRemote(name);
  });

  handleIpc(ipc, IPC.git.writeCiFile, async (_e, relPath: string, content: string) => {
    const wsDir = getWorkspaceDir();
    if (!wsDir) throw new Error('No workspace open');
    const fullPath = join(wsDir, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';

function resolveStatus(
  result: Awaited<ReturnType<ReturnType<typeof simpleGit>['status']>>,
  filePath: string,
  staged: boolean,
): FileStatus {
  if (staged) {
    if (result.created.includes(filePath))  return 'added';
    if (result.deleted.includes(filePath))  return 'deleted';
    if (result.renamed.find(r => r.to === filePath || r.from === filePath)) return 'renamed';
    return 'modified';
  }
  if (result.deleted.includes(filePath)) return 'deleted';
  return 'modified';
}
