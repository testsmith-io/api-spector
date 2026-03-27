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

import { type IpcMain } from 'electron';
import { simpleGit } from 'simple-git';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import type { GitStatus, GitCommit, GitBranch, GitRemote } from '../../shared/types';
import { getWorkspaceDir } from './file-handler';

function git() {
  const dir = getWorkspaceDir();
  if (!dir) throw new Error('No workspace open');
  return simpleGit(dir);
}

export function registerGitHandlers(ipc: IpcMain): void {

  ipc.handle('git:isRepo', async () => {
    try {
      await git().revparse(['--git-dir']);
      return true;
    } catch {
      return false;
    }
  });

  ipc.handle('git:init', async () => {
    await git().init();
  });

  ipc.handle('git:status', async (): Promise<GitStatus> => {
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

  ipc.handle('git:resolveOurs', async (_e, filePath: string) => {
    const g = git();
    await g.checkout(['--ours', '--', filePath]);
    await g.add([filePath]);
  });

  ipc.handle('git:resolveTheirs', async (_e, filePath: string) => {
    const g = git();
    await g.checkout(['--theirs', '--', filePath]);
    await g.add([filePath]);
  });

  ipc.handle('git:markResolved', async (_e, filePath: string) => {
    await git().add([filePath]);
  });

  ipc.handle('git:diff', async (_e, filePath?: string): Promise<string> => {
    if (filePath) return git().diff(['--', filePath]);
    return git().diff();
  });

  ipc.handle('git:diffStaged', async (_e, filePath?: string): Promise<string> => {
    if (filePath) return git().diff(['--cached', '--', filePath]);
    return git().diff(['--cached']);
  });

  ipc.handle('git:stage', async (_e, paths: string[]) => {
    await git().add(paths);
  });

  ipc.handle('git:unstage', async (_e, paths: string[]) => {
    await git().reset(['HEAD', '--', ...paths]);
  });

  ipc.handle('git:stageAll', async () => {
    await git().add(['.']);
  });

  ipc.handle('git:commit', async (_e, message: string) => {
    await git().commit(message);
  });

  ipc.handle('git:log', async (_e, limit = 50): Promise<GitCommit[]> => {
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

  ipc.handle('git:branches', async (): Promise<GitBranch[]> => {
    const result = await git().branch(['-a', '--format=%(refname:short)|%(objectname:short)|%(upstream:short)|%(upstream:track)']);
    return result.all
      .filter(name => !name.includes('HEAD'))
      .map(name => ({
        name:    name.replace(/^remotes\//, ''),
        current: name === result.current,
        remote:  name.startsWith('remotes/'),
      }));
  });

  ipc.handle('git:checkout', async (_e, branch: string, create: boolean) => {
    if (create) await git().checkoutLocalBranch(branch);
    else        await git().checkout(branch);
  });

  ipc.handle('git:pull', async () => {
    await git().pull();
  });

  ipc.handle('git:push', async (_e, setUpstream: boolean) => {
    if (setUpstream) {
      const status = await git().status();
      await git().push(['--set-upstream', 'origin', status.current ?? 'main']);
    } else {
      await git().push();
    }
  });

  ipc.handle('git:remotes', async (): Promise<GitRemote[]> => {
    const result = await git().getRemotes(true);
    return result.map(r => ({ name: r.name, url: r.refs.fetch || r.refs.push || '' }));
  });

  ipc.handle('git:addRemote', async (_e, name: string, url: string) => {
    await git().addRemote(name, url);
  });

  ipc.handle('git:setRemoteUrl', async (_e, name: string, url: string) => {
    await git().remote(['set-url', name, url]);
  });

  ipc.handle('git:removeRemote', async (_e, name: string) => {
    await git().removeRemote(name);
  });

  ipc.handle('git:writeCiFile', async (_e, relPath: string, content: string) => {
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
