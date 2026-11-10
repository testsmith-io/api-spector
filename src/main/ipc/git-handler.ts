// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { type IpcMain } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import { simpleGit, type SimpleGit } from 'simple-git';
import { writeFile, readFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { GitStatus, GitCommit, GitBranch, GitRemote, GitStash, GitTag, GitIdentity, GitFile, GitRepoInfo } from '../../shared/types';
import { getWorkspaceDir, ensureGitignore } from './file-handler';
import {
  resolveGitScope, detectRepoInfo, clearGitScopeCache,
  toRepoPath, fromRepoPath, scopePathspec, isWithinScope, resolveFromRoot,
} from './git-scope';
import { BRANCH_REF_FORMAT, parseBranchRefs } from '../git-branch-parse';

// True when a rebase is mid-flight. State lives in `rebase-merge`/`rebase-apply`;
// `rev-parse --git-path` resolves those even for linked worktrees.
async function isRebasing(g: SimpleGit, repoRoot: string): Promise<boolean> {
  for (const name of ['rebase-merge', 'rebase-apply']) {
    try {
      const rel = (await g.raw(['rev-parse', '--git-path', name])).trim();
      await stat(resolveFromRoot(repoRoot, rel));
      return true;
    } catch { /* not present */ }
  }
  return false;
}

export function registerGitHandlers(ipc: IpcMain): void {

  handleIpc(ipc, IPC.git.isRepo, async () => {
    // Check the workspace dir itself, NOT `git rev-parse --git-dir`, which walks
    // up and may pick up an ancestor repo (a `~/.git` dotfiles repo); every git
    // command then runs against its working tree and wedges the panel on Loading.
    const dir = getWorkspaceDir();
    if (!dir) return false;
    try {
      const s = await stat(join(dir, '.git'));
      return s.isDirectory() || s.isFile();  // file = worktree pointer
    } catch {
      return false;
    }
  });

  // Repo detection for the panel: 'own' | 'scoped' | 'enclosing-available' |
  // 'none'. Runs no working-tree command, so it cannot wedge.
  handleIpc(ipc, IPC.git.repoInfo, async (): Promise<GitRepoInfo> => detectRepoInfo());

  handleIpc(ipc, IPC.git.init, async () => {
    const dir = getWorkspaceDir();
    if (!dir) throw new Error('No workspace open');
    // Initialize a repo in the workspace dir itself (a standalone 'own' repo).
    await simpleGit(dir).init();
    clearGitScopeCache(); // the dir just became a repo root
    // Keep secrets / generated artifacts out of git on a pre-existing workspace.
    await ensureGitignore(dir);
  });

  handleIpc(ipc, IPC.git.status, async (): Promise<GitStatus> => {
    const { git: g, scope, repoRoot } = await resolveGitScope();
    // Scope file entries to the workspace subtree; branch/ahead/behind stay
    // repo-global (git topology is shared). Own mode passes no pathspec.
    const result = await g.status(scope ? ['--', scope] : []);
    return {
      staged:     result.staged.map(f => ({ path: fromRepoPath(scope, f), status: resolveStatus(result, f, true) })),
      unstaged:   result.modified.filter(f => !result.staged.includes(f))
                    .concat(result.deleted.filter(f => !result.staged.includes(f)))
                    .map(f => ({ path: fromRepoPath(scope, f), status: resolveStatus(result, f, false) })),
      untracked:  result.not_added.map(f => ({ path: fromRepoPath(scope, f), status: 'untracked' as const })),
      conflicted: result.conflicted.map(f => fromRepoPath(scope, f)),
      branch:     result.current ?? '',
      ahead:      result.ahead,
      behind:     result.behind,
      remote:     result.tracking ?? null,
      rebasing:   await isRebasing(g, repoRoot),
    };
  });

  handleIpc(ipc, IPC.git.resolveOurs, async (_e, filePath: string) => {
    const { git: g, scope } = await resolveGitScope();
    const p = toRepoPath(scope, filePath);
    await g.checkout(['--ours', '--', p]);
    await g.add([p]);
  });

  handleIpc(ipc, IPC.git.resolveTheirs, async (_e, filePath: string) => {
    const { git: g, scope } = await resolveGitScope();
    const p = toRepoPath(scope, filePath);
    await g.checkout(['--theirs', '--', p]);
    await g.add([p]);
  });

  handleIpc(ipc, IPC.git.markResolved, async (_e, filePath: string) => {
    const { git: g, scope } = await resolveGitScope();
    await g.add([toRepoPath(scope, filePath)]);
  });

  // Read a conflicted file's content (with conflict markers) for the editor.
  // Path is workspace-relative in both own and scoped mode.
  handleIpc(ipc, IPC.git.readConflict, async (_e, filePath: string): Promise<string> => {
    const dir = getWorkspaceDir();
    if (!dir) throw new Error('No workspace open');
    return readFile(join(dir, filePath), 'utf8');
  });

  // Write the manually-resolved content back and stage it (marks it resolved).
  handleIpc(ipc, IPC.git.writeResolved, async (_e, filePath: string, content: string) => {
    const dir = getWorkspaceDir();
    if (!dir) throw new Error('No workspace open');
    await writeFile(join(dir, filePath), content, 'utf8');
    const { git: g, scope } = await resolveGitScope();
    await g.add([toRepoPath(scope, filePath)]);
  });

  handleIpc(ipc, IPC.git.diff, async (_e, filePath?: string): Promise<string> => {
    const { git: g, scope } = await resolveGitScope();
    if (filePath) return g.diff(['--', toRepoPath(scope, filePath)]);
    return scope ? g.diff(['--', scope]) : g.diff();
  });

  handleIpc(ipc, IPC.git.diffStaged, async (_e, filePath?: string): Promise<string> => {
    const { git: g, scope } = await resolveGitScope();
    if (filePath) return g.diff(['--cached', '--', toRepoPath(scope, filePath)]);
    return scope ? g.diff(['--cached', '--', scope]) : g.diff(['--cached']);
  });

  handleIpc(ipc, IPC.git.stage, async (_e, paths: string[]) => {
    const { git: g, scope } = await resolveGitScope();
    await g.add(paths.map(p => toRepoPath(scope, p)));
  });

  handleIpc(ipc, IPC.git.unstage, async (_e, paths: string[]) => {
    const { git: g, scope } = await resolveGitScope();
    await g.reset(['HEAD', '--', ...paths.map(p => toRepoPath(scope, p))]);
  });

  handleIpc(ipc, IPC.git.stageAll, async () => {
    const { git: g, scope } = await resolveGitScope();
    await g.add([scopePathspec(scope)]);
  });

  // Discard working-tree changes. Destructive: tracked files restored to HEAD
  // (`checkout`), untracked removed from disk (`clean -fd`, scoped to pathspecs).
  handleIpc(ipc, IPC.git.discard, async (_e, files: GitFile[]) => {
    const { git: g, scope } = await resolveGitScope();
    const tracked   = files.filter(f => f.status !== 'untracked').map(f => toRepoPath(scope, f.path));
    const untracked = files.filter(f => f.status === 'untracked').map(f => toRepoPath(scope, f.path));
    if (tracked.length)   await g.checkout(['--', ...tracked]);
    if (untracked.length) await g.raw(['clean', '-fd', '--', ...untracked]);
  });

  handleIpc(ipc, IPC.git.commit, async (_e, message: string) => {
    const { git: g, scope } = await resolveGitScope();
    // In scoped mode, refuse staged paths outside the subtree (from external
    // tooling) rather than sweep unrelated work into our commit.
    if (scope) {
      const full = await g.status();
      const outside = full.staged.filter(p => !isWithinScope(scope, p));
      if (outside.length) {
        throw new Error(
          `There are staged changes outside "${scope}/" (e.g. ${outside[0]}). ` +
          `The built-in client only commits this folder - commit those with your project's git, or unstage them.`,
        );
      }
    }
    await g.commit(message);
  });

  // Amend the last commit. Disabled in scoped mode: the commit may span folders
  // outside this workspace.
  handleIpc(ipc, IPC.git.amend, async (_e, message: string) => {
    const { git: g, scope } = await resolveGitScope();
    if (scope) throw new Error('Amend is disabled in scoped mode (it would rewrite history across the whole repository).');
    await g.commit(message, ['--amend']);
  });

  // Undo the last commit, keeping its changes staged (`reset --soft HEAD~1`).
  // Disabled in scoped mode for the same reason as amend.
  handleIpc(ipc, IPC.git.uncommit, async () => {
    const { git: g, scope } = await resolveGitScope();
    if (scope) throw new Error('Undo last commit is disabled in scoped mode (it would un-commit changes across the whole repository).');
    await g.reset(['--soft', 'HEAD~1']);
  });

  // The diff a commit introduced, scoped to the workspace subtree so the Log
  // tab shows only this folder's part of the commit.
  handleIpc(ipc, IPC.git.show, async (_e, sha: string): Promise<string> => {
    const { git: g, scope } = await resolveGitScope();
    const args = ['show', '--format=fuller', sha];
    if (scope) args.push('--', scope);
    return g.raw(args);
  });

  // Read the configured author identity (nearest scope wins). Empty strings
  // when unset - that is what blocks a commit, and the panel prompts to fix it.
  handleIpc(ipc, IPC.git.getIdentity, async (): Promise<GitIdentity> => {
    const { git: g } = await resolveGitScope();
    const read = async (key: string): Promise<string> => {
      try { return (await g.raw(['config', '--get', key])).trim(); }
      catch { return ''; }
    };
    return { name: await read('user.name'), email: await read('user.email') };
  });

  // Set the author identity for this repository, local scope.
  handleIpc(ipc, IPC.git.setIdentity, async (_e, name: string, email: string) => {
    const { git: g } = await resolveGitScope();
    await g.addConfig('user.name', name);
    await g.addConfig('user.email', email);
  });

  handleIpc(ipc, IPC.git.log, async (_e, limit: number = 50): Promise<GitCommit[]> => {
    const { git: g, scope } = await resolveGitScope();
    // Scope history to commits that touched this subtree.
    const result = await g.log(scope ? { maxCount: limit, file: scope } : { maxCount: limit });
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
    // simple-git ignores `result.all` when `--format` is set, dropping
    // upstream/ahead/behind - so run the format via `raw` and parse by hand.
    const { git: g } = await resolveGitScope();
    const raw = await g.raw([
      'for-each-ref', `--format=${BRANCH_REF_FORMAT}`, 'refs/heads', 'refs/remotes',
    ]);
    const current = (await g.branch()).current;
    return parseBranchRefs(raw, current);
  });

  handleIpc(ipc, IPC.git.checkout, async (_e, branch: string, create: boolean) => {
    const { git: g } = await resolveGitScope();
    if (create) {
      await g.checkoutLocalBranch(branch);
      return;
    }

    // A remote ref ("origin/feature-x") with no matching local branch: create a
    // tracking branch instead of erroring, matching "click remote to switch".
    const m = /^([^/]+)\/(.+)$/.exec(branch);
    if (m) {
      const remote     = m[1];
      const localName  = m[2];
      const localList  = await g.branchLocal();
      if (!localList.all.includes(localName)) {
        await g.checkoutBranch(localName, `${remote}/${localName}`);
        return;
      }
      // local exists with the same name - plain checkout of the local one.
      await g.checkout(localName);
      return;
    }

    await g.checkout(branch);
  });

  handleIpc(ipc, IPC.git.deleteBranch, async (_e, name: string, force: boolean = false) => {
    // simple-git's deleteLocalBranch wraps `git branch -d` (-D when force).
    const { git: g } = await resolveGitScope();
    await g.deleteLocalBranch(name, force);
  });

  handleIpc(ipc, IPC.git.renameBranch, async (_e, newName: string) => {
    const { git: g } = await resolveGitScope();
    await g.raw(['branch', '-m', newName]);
  });

  // Rebase onto `onto`. A conflict returns { conflict: true } (not thrown) so the
  // panel can route to the Changes tab; other failures propagate.
  handleIpc(ipc, IPC.git.rebase, async (_e, onto: string): Promise<{ conflict: boolean }> => {
    const { git: g, repoRoot } = await resolveGitScope();
    try {
      await g.raw(['rebase', onto]);
      return { conflict: false };
    } catch (e) {
      if (await isRebasing(g, repoRoot)) return { conflict: true };
      throw e;
    }
  });

  // Continue a conflicted rebase once the working tree is clean / staged.
  // GIT_EDITOR=true stops git from opening an editor for the commit message.
  handleIpc(ipc, IPC.git.rebaseContinue, async (): Promise<{ conflict: boolean }> => {
    const { git: g, repoRoot } = await resolveGitScope();
    try {
      await g.env({ ...process.env, GIT_EDITOR: 'true' }).raw(['rebase', '--continue']);
      return { conflict: false };
    } catch (e) {
      if (await isRebasing(g, repoRoot)) return { conflict: true };
      throw e;
    }
  });

  handleIpc(ipc, IPC.git.rebaseAbort, async () => {
    const { git: g } = await resolveGitScope();
    await g.raw(['rebase', '--abort']);
  });

  // Merge a branch into the current one. Conflict returns { conflict: true } (not
  // thrown). Repo-wide (no per-subtree merge); the panel labels this in scoped mode.
  handleIpc(ipc, IPC.git.merge, async (_e, branch: string): Promise<{ conflict: boolean }> => {
    const { git: g } = await resolveGitScope();
    try {
      await g.raw(['merge', branch]);
      return { conflict: false };
    } catch (e) {
      const status = await g.status();
      if (status.conflicted.length > 0) return { conflict: true };
      throw e;
    }
  });

  handleIpc(ipc, IPC.git.stashList, async (): Promise<GitStash[]> => {
    // Branch name lives in the subject ("WIP on <branch>: …" / "On <branch>: …");
    // parse it out - git exposes no dedicated field.
    const { git: g } = await resolveGitScope();
    const raw = await g.raw(['stash', 'list', '--format=%gd\u001f%gs']);
    return raw.split('\n').filter(Boolean).map((line, index) => {
      const [ref = `stash@{${index}}`, subject = ''] = line.split('\u001f');
      const m = /^(?:WIP on|On) ([^:]+): (.*)$/.exec(subject);
      return {
        index,
        ref,
        branch:  m ? m[1] : '',
        message: m ? m[2] : subject,
      };
    });
  });

  handleIpc(ipc, IPC.git.stash, async (_e, message?: string) => {
    // `-u` includes untracked files so a later branch switch can't be blocked. In
    // scoped mode a trailing pathspec parks only this subtree.
    const { git: g, scope } = await resolveGitScope();
    const args = ['stash', 'push', '-u'];
    if (message && message.trim()) args.push('-m', message.trim());
    if (scope) args.push('--', scope);
    await g.raw(args);
  });

  handleIpc(ipc, IPC.git.stashPop, async (_e, ref?: string) => {
    // No ref -> most recent (stash@{0}). git refuses to pop onto a dirty path it
    // would clobber; the error propagates to the panel so the user can resolve.
    const { git: g } = await resolveGitScope();
    await g.raw(['stash', 'pop', ...(ref ? [ref] : [])]);
  });

  handleIpc(ipc, IPC.git.stashApply, async (_e, ref?: string) => {
    // Like pop, but keeps the stash in the list.
    const { git: g } = await resolveGitScope();
    await g.raw(['stash', 'apply', ...(ref ? [ref] : [])]);
  });

  // `git stash show` takes no pathspec, so to scope to the subtree we diff the
  // stash commit against its first parent and apply the pathspec there.
  handleIpc(ipc, IPC.git.stashShow, async (_e, ref?: string): Promise<string> => {
    const { git: g, scope } = await resolveGitScope();
    if (scope) {
      const r = ref ?? 'stash@{0}';
      return g.raw(['diff', `${r}^1`, r, '--', scope]);
    }
    return g.raw(['stash', 'show', '-p', ...(ref ? [ref] : [])]);
  });

  handleIpc(ipc, IPC.git.stashDrop, async (_e, ref?: string) => {
    const { git: g } = await resolveGitScope();
    await g.raw(['stash', 'drop', ...(ref ? [ref] : [])]);
  });

  handleIpc(ipc, IPC.git.fetch, async () => {
    // Update remote-tracking refs without merging; keeps ahead/behind accurate.
    const { git: g } = await resolveGitScope();
    await g.fetch(['--prune']);
  });

  handleIpc(ipc, IPC.git.pull, async (_e, rebase: boolean = false) => {
    // Rebase keeps a linear history (no merge commit); plain pull merges.
    const { git: g } = await resolveGitScope();
    await g.raw(['pull', ...(rebase ? ['--rebase'] : [])]);
  });

  handleIpc(ipc, IPC.git.push, async (_e, setUpstream: boolean, force: boolean = false) => {
    const { git: g } = await resolveGitScope();
    // --force-with-lease refuses to overwrite remote commits the local repo hasn't
    // seen, so a force push can't clobber a teammate's work like bare --force.
    const forceArgs = force ? ['--force-with-lease'] : [];
    if (setUpstream) {
      const status = await g.status();
      await g.push(['--set-upstream', ...forceArgs, 'origin', status.current ?? 'main']);
    } else if (force) {
      await g.push(forceArgs);
    } else {
      await g.push();
    }
  });

  handleIpc(ipc, IPC.git.deleteRemoteBranch, async (_e, remote: string, name: string) => {
    const { git: g } = await resolveGitScope();
    await g.push([remote, '--delete', name]);
  });

  handleIpc(ipc, IPC.git.tagList, async (): Promise<GitTag[]> => {
    const { git: g } = await resolveGitScope();
    // `%(contents:subject)` is the annotation subject for annotated tags and the
    // pointed commit's summary for lightweight ones. Sorted newest first.
    const raw = await g.raw([
      'for-each-ref', '--sort=-creatordate',
      '--format=%(refname:short)\u001f%(contents:subject)', 'refs/tags',
    ]);
    return raw.split('\n').filter(Boolean).map(line => {
      const [name = '', subject = ''] = line.split('\u001f');
      return { name, subject };
    });
  });

  // Create a lightweight tag, or an annotated one when a message is given. An
  // optional ref points the tag at a specific commit instead of HEAD.
  handleIpc(ipc, IPC.git.createTag, async (_e, name: string, message?: string, ref?: string) => {
    const { git: g } = await resolveGitScope();
    const args = ['tag'];
    if (message && message.trim()) args.push('-a', '-m', message.trim());
    args.push(name);
    if (ref) args.push(ref);
    await g.raw(args);
  });

  handleIpc(ipc, IPC.git.deleteTag, async (_e, name: string) => {
    const { git: g } = await resolveGitScope();
    await g.tag(['-d', name]);
  });

  handleIpc(ipc, IPC.git.pushTags, async () => {
    const { git: g } = await resolveGitScope();
    await g.pushTags();
  });

  handleIpc(ipc, IPC.git.remotes, async (): Promise<GitRemote[]> => {
    const { git: g } = await resolveGitScope();
    const result = await g.getRemotes(true);
    return result.map(r => ({ name: r.name, url: r.refs.fetch || r.refs.push || '' }));
  });

  handleIpc(ipc, IPC.git.addRemote, async (_e, name: string, url: string) => {
    const { git: g } = await resolveGitScope();
    await g.addRemote(name, url);
  });

  handleIpc(ipc, IPC.git.setRemoteUrl, async (_e, name: string, url: string) => {
    const { git: g } = await resolveGitScope();
    await g.remote(['set-url', name, url]);
  });

  handleIpc(ipc, IPC.git.removeRemote, async (_e, name: string) => {
    const { git: g } = await resolveGitScope();
    await g.removeRemote(name);
  });

  handleIpc(ipc, IPC.git.writeCiFile, async (_e, relPath: string, content: string) => {
    // CI workflows must live at the repo root (enclosing repo in scoped mode,
    // workspace dir otherwise) so the provider runs them; fall back to workspace dir.
    let base: string;
    try {
      base = (await resolveGitScope()).repoRoot;
    } catch {
      const dir = getWorkspaceDir();
      if (!dir) throw new Error('No workspace open');
      base = dir;
    }
    const fullPath = join(base, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  });
}

// Helpers

type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';

function resolveStatus(
  result: Awaited<ReturnType<ReturnType<typeof simpleGit>['status']>>,
  filePath: string,
  staged: boolean,
): FileStatus {
  if (staged) {
    if (result.created.includes(filePath))  return 'added';
    if (result.deleted.includes(filePath))  return 'deleted';
    if (result.renamed.some(r => r.to === filePath || r.from === filePath)) return 'renamed';
    return 'modified';
  }
  if (result.deleted.includes(filePath)) return 'deleted';
  return 'modified';
}
