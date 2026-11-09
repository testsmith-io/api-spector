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

// True when a rebase is mid-flight (stopped on conflicts, or otherwise paused).
// git keeps its state in `rebase-merge` / `rebase-apply` inside the git dir;
// `rev-parse --git-path` resolves those correctly even for linked worktrees.
// `repoRoot` is the working-tree root (the enclosing repo in scoped mode).
async function isRebasing(g: SimpleGit, repoRoot: string): Promise<boolean> {
  for (const name of ['rebase-merge', 'rebase-apply']) {
    try {
      const rel = (await g.raw(['rev-parse', '--git-path', name])).trim();
      await stat(resolveFromRoot(repoRoot, rel));
      return true;
    } catch { /* not present — check the next marker */ }
  }
  return false;
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

  // Richer repo detection for the panel: distinguishes a standalone repo
  // ('own'), a workspace scoped into an enclosing repo ('scoped'), an enclosing
  // repo that scoped mode could be enabled for ('enclosing-available'), and no
  // repo ('none'). Runs no working-tree command, so it cannot wedge.
  handleIpc(ipc, IPC.git.repoInfo, async (): Promise<GitRepoInfo> => detectRepoInfo());

  handleIpc(ipc, IPC.git.init, async () => {
    const dir = getWorkspaceDir();
    if (!dir) throw new Error('No workspace open');
    // Initialize a repo in the workspace dir itself (a standalone 'own' repo).
    await simpleGit(dir).init();
    clearGitScopeCache(); // the dir just became a repo root
    // Ensure secrets / generated artifacts aren't committed when the user
    // initializes git on an existing workspace that pre-dates the auto-write.
    await ensureGitignore(dir);
  });

  handleIpc(ipc, IPC.git.status, async (): Promise<GitStatus> => {
    const { git: g, scope, repoRoot } = await resolveGitScope();
    // Scope file entries to the workspace subtree; branch/ahead/behind in the
    // porcelain header are unaffected by the pathspec (and stay repo-global,
    // which is correct — git topology is shared). Own mode passes no pathspec
    // so behavior is byte-identical to before.
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

  // Read a conflicted file's current content (with <<<<<<< / ======= / >>>>>>>
  // markers) so the conflict editor can show and resolve it in place. The path
  // is workspace-relative, so it resolves against the workspace dir in both
  // own and scoped mode.
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

  // Discard working-tree changes. Destructive and irreversible: tracked
  // files are restored to their HEAD version (`checkout -- <path>`, which
  // also brings back a deleted file), and never-committed files are removed
  // from disk (`clean -fd`, limited to the given pathspecs). The renderer
  // guards this behind a confirmation dialog.
  handleIpc(ipc, IPC.git.discard, async (_e, files: GitFile[]) => {
    const { git: g, scope } = await resolveGitScope();
    const tracked   = files.filter(f => f.status !== 'untracked').map(f => toRepoPath(scope, f.path));
    const untracked = files.filter(f => f.status === 'untracked').map(f => toRepoPath(scope, f.path));
    if (tracked.length)   await g.checkout(['--', ...tracked]);
    if (untracked.length) await g.raw(['clean', '-fd', '--', ...untracked]);
  });

  handleIpc(ipc, IPC.git.commit, async (_e, message: string) => {
    const { git: g, scope } = await resolveGitScope();
    // In scoped mode the panel only ever stages within the subtree, so the
    // only way a staged path lands outside it is external tooling. Refuse
    // rather than sweep the user's unrelated staged work into our commit.
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

  // Amend the last commit's message / staged content. Disabled in scoped mode:
  // the previous commit may span folders outside this workspace, so rewriting
  // it from here would touch the rest of the project.
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
  // tab shows only this folder's part of a (possibly repo-wide) commit.
  handleIpc(ipc, IPC.git.show, async (_e, sha: string): Promise<string> => {
    const { git: g, scope } = await resolveGitScope();
    const args = ['show', '--format=fuller', sha];
    if (scope) args.push('--', scope);
    return g.raw(args);
  });

  // Read the configured author identity (nearest scope wins). Empty strings
  // when unset — that is what blocks a commit, and the panel prompts to fix it.
  handleIpc(ipc, IPC.git.getIdentity, async (): Promise<GitIdentity> => {
    const { git: g } = await resolveGitScope();
    const read = async (key: string): Promise<string> => {
      try { return (await g.raw(['config', '--get', key])).trim(); }
      catch { return ''; }
    };
    return { name: await read('user.name'), email: await read('user.email') };
  });

  // Set the author identity for this repository (local scope, not global).
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
    // The previous implementation passed a `--format=…` arg but then read
    // `result.all` (which simple-git doesn't honor when --format is set),
    // so upstream/ahead/behind were silently dropped. Run the format flag
    // via `raw` and parse line-by-line so we get the real metadata.
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

    // If `branch` looks like a remote ref (e.g. "origin/feature-x") and no
    // local branch with that name exists, create a tracking branch instead
    // of erroring out. Matches the user expectation of clicking a remote
    // branch in the sidebar to "switch to it".
    const m = /^([^/]+)\/(.+)$/.exec(branch);
    if (m) {
      const remote     = m[1];
      const localName  = m[2];
      const localList  = await g.branchLocal();
      if (!localList.all.includes(localName)) {
        await g.checkoutBranch(localName, `${remote}/${localName}`);
        return;
      }
      // local exists with the same name — fall through to plain checkout of
      // the local one, which is what users almost always want.
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

  // Rename the current branch (`git branch -m <newName>`).
  handleIpc(ipc, IPC.git.renameBranch, async (_e, newName: string) => {
    const { git: g } = await resolveGitScope();
    await g.raw(['branch', '-m', newName]);
  });

  // Rebase the current branch onto `onto` (another local or remote branch).
  // A clean rebase returns { conflict: false }. When it stops on conflicts we
  // return { conflict: true } instead of throwing, so the panel can send the
  // user to the Changes tab to resolve and then continue. Any other failure
  // (unknown branch, unexpected git error) propagates so it surfaces as an error.
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

  // Merge another branch into the current one. Like rebase, a conflict is
  // reported as { conflict: true } (not thrown) so the panel can route the user
  // to the Changes tab. Merge is repo-wide (git has no per-subtree merge); the
  // panel labels this in scoped mode.
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
    // `--format` with NUL-ish separators we can split safely. The branch name
    // lives inside the subject ("WIP on <branch>: …" / "On <branch>: …"), so
    // parse it out rather than relying on a dedicated field git doesn't expose.
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
    // `-u` includes untracked files so switching branches afterwards can't be
    // blocked by an untracked path the target branch tracks. In scoped mode a
    // trailing pathspec parks only this subtree, leaving the rest of the
    // project's working tree alone.
    const { git: g, scope } = await resolveGitScope();
    const args = ['stash', 'push', '-u'];
    if (message && message.trim()) args.push('-m', message.trim());
    if (scope) args.push('--', scope);
    await g.raw(args);
  });

  handleIpc(ipc, IPC.git.stashPop, async (_e, ref?: string) => {
    // No ref → most recent (stash@{0}). git refuses to pop onto a dirty path it
    // would clobber; the error propagates to the panel so the user can resolve.
    const { git: g } = await resolveGitScope();
    await g.raw(['stash', 'pop', ...(ref ? [ref] : [])]);
  });

  handleIpc(ipc, IPC.git.stashApply, async (_e, ref?: string) => {
    // Like pop, but keeps the stash in the list so it can be applied again or
    // dropped later.
    const { git: g } = await resolveGitScope();
    await g.raw(['stash', 'apply', ...(ref ? [ref] : [])]);
  });

  // The diff a stash holds. `git stash show` does not accept a pathspec, so to
  // scope to the subtree we diff the stash commit against its first parent
  // (which is exactly what `stash show -p` does) and apply the pathspec there.
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
    // Update remote-tracking refs (so ahead/behind is accurate) without merging.
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
    // --force-with-lease refuses to overwrite remote commits the local repo
    // has never seen, so a force push after a rebase/amend can't clobber a
    // teammate's work the way a bare --force would.
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

  // Delete a branch on the remote (`git push <remote> --delete <name>`).
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
    // CI workflows must live at the repository root (e.g. `.github/workflows/`)
    // so the provider actually runs them — that is the enclosing repo root in
    // scoped mode, the workspace dir otherwise. Fall back to the workspace dir
    // when there is no repo yet.
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
    if (result.renamed.some(r => r.to === filePath || r.from === filePath)) return 'renamed';
    return 'modified';
  }
  if (result.deleted.includes(filePath)) return 'deleted';
  return 'modified';
}
