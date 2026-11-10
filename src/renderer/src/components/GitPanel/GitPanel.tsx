// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store';
import type { GitStatus, GitRepoInfo, GitCommit, GitBranch, GitRemote, GitStash, GitTag, GitFile, CiPlatform } from '../../../../shared/types';
import { Toast, useToast } from '../common/Toast';
import { useConfirm } from '../common/useConfirm';
import { detectPlatform, generateCiContent, ciFilePath, secretManagerOf, requestSecretManagers, type SecretManagerKind } from '../../lib/ci-templates';
import { ConflictEditor } from './ConflictEditor';
import { STORAGE_KEYS } from '../../lib/storage-keys';
import { onActivateKey } from '../../lib/a11y';
import { useWorkspaceLoader } from '../../hooks/useWorkspaceLoader';
import { useT } from '../../i18n';

const { electron } = window;

type Tab = 'changes' | 'log' | 'branches' | 'ci';

// File status badge

function StatusBadge({ status }: { readonly status: GitFile['status'] }) {
  const map: Record<GitFile['status'], { label: string; color: string }> = {
    modified:  { label: 'M', color: 'text-amber-400' },
    added:     { label: 'A', color: 'text-emerald-400' },
    deleted:   { label: 'D', color: 'text-red-400' },
    renamed:   { label: 'R', color: 'text-blue-400' },
    untracked: { label: '?', color: 'text-surface-500' },
  };
  const { label, color } = map[status] ?? { label: '?', color: 'text-surface-500' };
  return <span className={`font-mono text-[11px] font-bold w-4 shrink-0 ${color}`}>{label}</span>;
}

// Diff viewer

export function DiffViewer({ diff }: { readonly diff: string }) {
  const t = useT();
  if (!diff) return <p className="text-xs text-surface-500 p-3">{t('No changes.')}</p>;
  return (
    <pre className="text-[11px] font-mono overflow-auto p-3 leading-relaxed">
      {diff.split('\n').map((line, i) => {
        const cls =
          line.startsWith('<<<<<<<') ? 'text-red-400 font-bold bg-red-900/20' :
          line.startsWith('=======') ? 'text-amber-400 font-bold bg-amber-900/20' :
          line.startsWith('>>>>>>>') ? 'text-blue-400 font-bold bg-blue-900/20' :
          line.startsWith('+') && !line.startsWith('+++') ? 'text-emerald-400' :
          line.startsWith('-') && !line.startsWith('---') ? 'text-red-400' :
          line.startsWith('@@') ? 'text-blue-400' :
          'text-surface-400';
        return <div key={i} className={cls}>{line || ' '}</div>;
      })}
    </pre>
  );
}

// Changes tab

function ChangesTab({ status, onRefresh, reloadWorkspace, scoped }: { readonly status: GitStatus; readonly onRefresh: () => void; readonly reloadWorkspace: () => Promise<void>; readonly scoped: boolean }) {
  const t = useT();
  const [message,    setMessage]    = useState('');
  const [diffFile,   setDiffFile]   = useState<string | null>(null);
  const [diff,       setDiff]       = useState('');
  const [diffStaged, setDiffStaged] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [pushing,    setPushing]    = useState(false);
  const [pulling,    setPulling]    = useState(false);
  const [fetching,   setFetching]   = useState(false);
  const [amend,      setAmend]      = useState(false);
  const [pushRejected, setPushRejected] = useState(false);
  // Non-null while the git author identity is missing: shows an inline form to set it.
  const [identity,   setIdentity]   = useState<{ name: string; email: string } | null>(null);
  const [conflictFile, setConflictFile] = useState<string | null>(null);
  const [pullRebase, setPullRebase] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEYS.gitPullRebase) === '1'; } catch { return false; }
  });
  const { toast, show: showToast }  = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();

  function toggleRebase() {
    setPullRebase(v => {
      const next = !v;
      try { localStorage.setItem(STORAGE_KEYS.gitPullRebase, next ? '1' : '0'); } catch { /* private mode */ }
      return next;
    });
  }

  async function showDiff(file: GitFile, staged: boolean) {
    setDiffFile(file.path);
    setDiffStaged(staged);
    // Surface the diff in the main pane (full-width). The sidebar still
    // shows a small inline diff so users with the panel collapsed can peek.
    useStore.getState().setActiveGitDiff({ path: file.path, staged });
    try {
      const d = staged
        ? await electron.gitDiffStaged(file.path)
        : await electron.gitDiff(file.path);
      setDiff(d);
    } catch { setDiff(''); }
  }

  async function stage(paths: string[]) {
    try { await electron.gitStage(paths); onRefresh(); } catch (e) { setError(String(e)); }
  }

  async function unstage(paths: string[]) {
    try { await electron.gitUnstage(paths); onRefresh(); } catch (e) { setError(String(e)); }
  }

  async function stageAll() {
    try { await electron.gitStageAll(); onRefresh(); } catch (e) { setError(String(e)); }
  }

  // Discard working-tree changes (irreversible, always confirmed): tracked files
  // revert to HEAD, untracked are deleted. Reload the workspace so the UI isn't stale.
  function discard(files: GitFile[]) {
    if (files.length === 0) return;
    const message = files.length === 1
      ? t('Discard changes to :file? This cannot be undone.', { file: files[0].path })
      : t('Discard changes to :count files? This cannot be undone.', { count: files.length });
    confirm(message, async () => {
      try {
        setError(null);
        await electron.gitDiscard(files);
        // Clear any diff of a file we just reverted so the pane is not stale.
        if (diffFile && files.some(f => f.path === diffFile)) {
          setDiffFile(null);
          setDiff('');
          useStore.getState().setActiveGitDiff(null);
        }
        await reloadWorkspace();
        onRefresh();
      } catch (e) { setError(String(e)); }
    }, t('Discard'));
  }

  async function commit() {
    if (!message.trim()) return;
    try {
      setError(null);
      if (amend && !scoped) await electron.gitAmend(message.trim());
      else await electron.gitCommit(message.trim());
      setMessage('');
      setAmend(false);
      onRefresh();
    } catch (e) {
      const msg = String(e);
      // git refuses to commit without an author identity - show an inline form to set it.
      if (/please tell me who you are|user\.name|user\.email|empty ident|auto-detect/i.test(msg)) {
        const cur = await electron.gitGetIdentity().catch(() => ({ name: '', email: '' }));
        setIdentity(cur);
      } else {
        setError(msg);
      }
    }
  }

  async function toggleAmend() {
    const next = !amend;
    setAmend(next);
    // Prefill the last commit message when turning amend on (if the box is empty).
    if (next && !message.trim()) {
      try {
        const [last] = await electron.gitLog(1);
        if (last) setMessage(last.message);
      } catch { /* leave empty */ }
    }
  }

  async function saveIdentity() {
    if (!identity || !identity.name.trim() || !identity.email.trim()) return;
    try {
      setError(null);
      await electron.gitSetIdentity(identity.name.trim(), identity.email.trim());
      setIdentity(null);
      await commit(); // retry now that the identity is set
    } catch (e) { setError(String(e)); }
  }

  async function stash() {
    try {
      setError(null);
      await electron.gitStash();
      showToast(t('Changes stashed - restore them from the Branches tab'), true);
      onRefresh();
    } catch (e) { setError(String(e)); }
  }

  async function fetch() {
    setFetching(true);
    try {
      await electron.gitFetch();
      showToast(t('Fetched from remote'), true);
      onRefresh();
    } catch (e) { showToast(String(e), false); }
    finally { setFetching(false); }
  }

  async function pull() {
    setPulling(true);
    try {
      await electron.gitPull(pullRebase);
      showToast(pullRebase ? t('Pulled (rebased)') : t('Pull successful'), true);
      onRefresh();
    } catch (e) {
      const msg = String(e);
      // A pull that stops on conflicts leaves them in the working tree.
      showToast(/conflict/i.test(msg) ? t('Pull stopped on conflicts - resolve them below') : msg, false);
      onRefresh();
    }
    finally { setPulling(false); }
  }

  async function push(force = false) {
    setPushing(true);
    try {
      await electron.gitPush(!status.remote, force);
      setPushRejected(false);
      showToast(force ? t('Force pushed (with lease)') : t('Push successful'), true);
      onRefresh();
    } catch (e) {
      const msg = String(e);
      // Remote moved ahead: offer a pull, or a lease-guarded force push for the
      // rebase/amend case (where the local history legitimately diverged).
      if (/non-fast-forward|rejected|fetch first|stale info/i.test(msg)) {
        setPushRejected(true);
        showToast(t('Push rejected - the remote has new commits. Pull first, or force push if you rebased.'), false);
      } else {
        showToast(msg, false);
      }
    }
    finally { setPushing(false); }
  }

  async function resolveConflict(path: string, mode: 'ours' | 'theirs' | 'mark') {
    try {
      if (mode === 'ours')   await electron.gitResolveOurs(path);
      else if (mode === 'theirs') await electron.gitResolveTheirs(path);
      else                   await electron.gitMarkResolved(path);
      if (diffFile === path) setDiffFile(null);
      onRefresh();
    } catch (e) { setError(String(e)); }
  }

  // Continue a rebase that stopped on conflicts (once they are staged/resolved).
  // A rebase rewrites the working tree, so the workspace is reloaded on success.
  async function rebaseContinue() {
    try {
      setError(null);
      const r = await electron.gitRebaseContinue();
      if (r.conflict) { showToast(t('Still conflicts - resolve the files below, then continue'), false); onRefresh(); return; }
      await reloadWorkspace();
      showToast(t('Rebase complete'), true);
      onRefresh();
    } catch (e) { setError(String(e)); }
  }

  async function rebaseAbort() {
    try {
      setError(null);
      await electron.gitRebaseAbort();
      await reloadWorkspace();
      showToast(t('Rebase aborted'), true);
      onRefresh();
    } catch (e) { setError(String(e)); }
  }

  const allUnstaged = [...status.unstaged, ...status.untracked];
  const hasStaged   = status.staged.length > 0;
  // Anything git would park: staged, unstaged, or untracked (stash runs -u).
  const isDirty     = hasStaged || status.unstaged.length > 0 || status.untracked.length > 0;
  const needsPush   = status.ahead > 0;
  const needsPull   = status.behind > 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Branch + sync bar */}
      <div className="px-3 py-2 border-b border-surface-800 flex items-center gap-2 flex-shrink-0">
        <span className="text-[11px] font-mono text-blue-300 truncate flex-1">⎇ {status.branch || t('no branch')}</span>
        <button
          onClick={toggleRebase}
          aria-pressed={pullRebase}
          title={pullRebase ? t('Pull uses rebase (click for merge)') : t('Pull uses merge (click for rebase)')}
          className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${pullRebase ? 'text-blue-300 bg-blue-900/30' : 'text-surface-500 hover:text-surface-300'}`}
        >
          {t('rebase')}
        </button>
        <button
          onClick={fetch}
          disabled={fetching}
          title={t('Fetch from remote (update ahead/behind, no merge)')}
          className="text-xs px-1.5 py-0.5 rounded text-surface-400 hover:text-white transition-colors disabled:opacity-40"
        >
          {fetching ? '…' : '⟳'}
        </button>
        <button
          onClick={pull}
          disabled={pulling}
          title={needsPull ? t('Pull (:count behind)', { count: status.behind }) : t('Pull')}
          className={`flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded transition-colors disabled:opacity-40 ${
            needsPull
              ? 'text-amber-300 bg-amber-900/30 hover:bg-amber-900/50'
              : 'text-surface-400 hover:text-white'
          }`}
        >
          ↓{needsPull ? <span className="text-[10px]">{status.behind}</span> : null}
        </button>
        <button
          onClick={() => push()}
          disabled={pushing}
          title={needsPush ? t('Push (:count unpushed)', { count: status.ahead }) : status.remote ? t('Push') : t('Push & set upstream')}
          className={`flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded transition-colors disabled:opacity-40 ${
            needsPush
              ? 'text-blue-300 bg-blue-900/30 hover:bg-blue-900/50'
              : 'text-surface-400 hover:text-white'
          }`}
        >
          ↑{needsPush ? <span className="text-[10px]">{status.ahead}</span> : null}
        </button>
      </div>

      {/* Push status banner */}
      {status.remote && (
        needsPush ? (
          <div className="mx-3 mt-2 px-2 py-1.5 rounded text-[11px] bg-blue-900/20 text-blue-300 border border-blue-800/40 flex items-center justify-between flex-shrink-0">
            <span>{t(':count commit to push|:count commits to push', { count: status.ahead })}</span>
            <button
              onClick={() => push()}
              disabled={pushing}
              className="text-blue-400 hover:text-blue-200 font-medium disabled:opacity-40"
            >{t('Push')} ↑</button>
          </div>
        ) : (
          <div className="mx-3 mt-2 px-2 py-1 rounded text-[11px] text-surface-600 border border-surface-800 flex-shrink-0">
            ✓ {t('Nothing to push')}
          </div>
        )
      )}

      {pushRejected && (
        <div className="mx-3 mt-2 px-2 py-1.5 rounded text-[11px] bg-amber-900/20 text-amber-200 border border-amber-800/40 flex items-center justify-between gap-2 flex-shrink-0">
          <span>{t('Remote diverged.')}</span>
          <button
            onClick={() => push(true)}
            disabled={pushing}
            title={t('Overwrite the remote branch with yours, but only if no new commits arrived since (--force-with-lease)')}
            className="text-amber-300 hover:text-amber-100 font-medium disabled:opacity-40 flex-shrink-0"
          >{t('Force push (lease)')}</button>
        </div>
      )}

      {status.rebasing && (
        <div className="mx-3 mt-2 px-2 py-1.5 rounded text-[11px] bg-amber-900/20 text-amber-200 border border-amber-800/40 flex items-center justify-between gap-2 flex-shrink-0">
          <span>⟳ {status.conflicted.length > 0 ? t('Rebase paused - resolve conflicts below, then continue') : t('Rebase in progress')}</span>
          <span className="flex gap-1 flex-shrink-0">
            <button
              onClick={rebaseContinue}
              disabled={status.conflicted.length > 0}
              title={status.conflicted.length > 0 ? t('Resolve all conflicts first') : t('Continue the rebase')}
              className="px-1.5 py-0.5 rounded bg-amber-800/40 hover:bg-amber-700/50 text-amber-100 disabled:opacity-40 disabled:cursor-default"
            >{t('Continue')}</button>
            <button
              onClick={rebaseAbort}
              title={t('Abort the rebase and restore the branch')}
              className="px-1.5 py-0.5 rounded border border-surface-600 text-surface-300 hover:bg-surface-800"
            >{t('Abort')}</button>
          </span>
        </div>
      )}

      {status.conflicted.length > 0 && (
        <div className="mx-3 mt-2 px-2 py-1.5 rounded text-[11px] bg-red-900/20 text-red-300 border border-red-800/40 flex-shrink-0">
          ⚠ {t(':count merge conflict - resolve below before committing|:count merge conflicts - resolve below before committing', { count: status.conflicted.length })}
        </div>
      )}

      <Toast toast={toast} />
      {confirmDialog}

      {conflictFile && (
        <ConflictEditor
          path={conflictFile}
          onClose={() => setConflictFile(null)}
          onResolved={onRefresh}
        />
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Staged */}
        {hasStaged && (
          <section>
            <div className="px-3 py-1.5 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest text-surface-500 font-semibold">
                {t('Staged (:count)', { count: status.staged.length })}
              </span>
              <button
                onClick={() => unstage(status.staged.map(f => f.path))}
                className="text-[10px] text-surface-500 hover:text-white transition-colors"
              >{t('Unstage all')}</button>
            </div>
            {status.staged.map(f => (
              <div
                key={f.path}
                className={`flex items-center gap-2 px-3 py-1 hover:bg-surface-800/50 cursor-pointer group text-xs ${diffFile === f.path && diffStaged ? 'bg-surface-800' : ''}`}
                tabIndex={0}
                onClick={() => showDiff(f, true)}
                onKeyDown={onActivateKey(() => showDiff(f, true))}
              >
                <StatusBadge status={f.status} />
                <span className="flex-1 truncate text-surface-200">{f.path}</span>
                <button
                  onClick={e => { e.stopPropagation(); unstage([f.path]); }}
                  className="opacity-0 group-hover:opacity-100 text-surface-500 hover:text-amber-400 transition-all text-[10px]"
                  title={t('Unstage')}
                >−</button>
              </div>
            ))}
          </section>
        )}

        {/* Unstaged + untracked */}
        {allUnstaged.length > 0 && (
          <section>
            <div className="px-3 py-1.5 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest text-surface-500 font-semibold">
                {t('Changes (:count)', { count: allUnstaged.length })}
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => discard(allUnstaged)}
                  className="text-[10px] text-surface-500 hover:text-red-400 transition-colors"
                >{t('Discard all')}</button>
                <button
                  onClick={stageAll}
                  className="text-[10px] text-surface-500 hover:text-white transition-colors"
                >{t('Stage all')}</button>
              </div>
            </div>
            {allUnstaged.map(f => (
              <div
                key={f.path}
                className={`flex items-center gap-2 px-3 py-1 hover:bg-surface-800/50 cursor-pointer group text-xs ${diffFile === f.path && !diffStaged ? 'bg-surface-800' : ''}`}
                tabIndex={0}
                onClick={() => showDiff(f, false)}
                onKeyDown={onActivateKey(() => showDiff(f, false))}
              >
                <StatusBadge status={f.status} />
                <span className="flex-1 truncate text-surface-200">{f.path}</span>
                <button
                  onClick={e => { e.stopPropagation(); discard([f]); }}
                  className="opacity-0 group-hover:opacity-100 text-surface-500 hover:text-red-400 transition-all text-xs leading-none"
                  title={f.status === 'untracked' ? t('Discard (delete file)') : t('Discard changes')}
                >↩</button>
                <button
                  onClick={e => { e.stopPropagation(); stage([f.path]); }}
                  className="opacity-0 group-hover:opacity-100 text-surface-500 hover:text-emerald-400 transition-all text-[10px]"
                  title={t('Stage')}
                >+</button>
              </div>
            ))}
          </section>
        )}

        {/* Conflicts */}
        {status.conflicted.length > 0 && (
          <section>
            <div className="px-3 py-1.5">
              <span className="text-[10px] uppercase tracking-widest text-red-400 font-semibold">
                {t('Conflicts (:count)', { count: status.conflicted.length })}
              </span>
            </div>
            {status.conflicted.map(path => (
              <div
                key={path}
                className={`flex items-center gap-2 px-3 py-1 hover:bg-surface-800/50 cursor-pointer group text-xs ${diffFile === path && !diffStaged ? 'bg-surface-800' : ''}`}
                tabIndex={0}
                onClick={() => showDiff({ path, status: 'modified' }, false)}
                onKeyDown={onActivateKey(() => showDiff({ path, status: 'modified' }, false))}
              >
                <span className="font-mono text-[11px] font-bold w-4 shrink-0 text-red-400">!</span>
                <span className="flex-1 truncate text-red-300">{path}</span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button
                    onClick={e => { e.stopPropagation(); setConflictFile(path); }}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700 text-surface-300 hover:bg-surface-600 transition-colors"
                    title={t('Open the conflict editor')}
                  >{t('Edit')}</button>
                  <button
                    onClick={e => { e.stopPropagation(); resolveConflict(path, 'ours'); }}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700 text-surface-300 hover:bg-emerald-900/50 hover:text-emerald-300 transition-colors"
                    title={t('Accept ours (current branch)')}
                  >{t('Ours')}</button>
                  <button
                    onClick={e => { e.stopPropagation(); resolveConflict(path, 'theirs'); }}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700 text-surface-300 hover:bg-blue-900/50 hover:text-blue-300 transition-colors"
                    title={t('Accept theirs (incoming)')}
                  >{t('Theirs')}</button>
                  <button
                    onClick={e => { e.stopPropagation(); resolveConflict(path, 'mark'); }}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700 text-surface-300 hover:bg-surface-600 transition-colors"
                    title={t('Mark as resolved (manual edit)')}
                  >✓</button>
                </div>
              </div>
            ))}
          </section>
        )}

        {status.staged.length === 0 && allUnstaged.length === 0 && status.conflicted.length === 0 && (
          <p className="text-xs text-surface-500 px-3 py-4">{t('Working tree clean.')}</p>
        )}
      </div>

      {/* Diff */}
      {diffFile && (
        <div className="border-t border-surface-800 flex flex-col max-h-48 min-h-0">
          <div className="px-3 py-1 flex items-center justify-between flex-shrink-0 border-b border-surface-800">
            <span className="text-[10px] font-mono text-surface-400 truncate">{diffFile}</span>
            <button onClick={() => setDiffFile(null)} className="text-surface-600 hover:text-white text-xs ml-2">✕</button>
          </div>
          <div className="overflow-auto flex-1 min-h-0">
            <DiffViewer diff={diff} />
          </div>
        </div>
      )}

      {/* Commit */}
      <div className="border-t border-surface-800 p-3 flex-shrink-0 flex flex-col gap-2">
        {error && <p className="text-[11px] text-red-400 truncate" title={error}>{error}</p>}
        {identity && (
          <div className="flex flex-col gap-1.5 p-2 rounded bg-surface-800/60 border border-surface-700">
            <p className="text-[11px] text-surface-300">{t('Set your git identity to commit:')}</p>
            <input
              type="text"
              value={identity.name}
              onChange={e => setIdentity({ ...identity, name: e.target.value })}
              placeholder={t('Your name')}
              className="w-full bg-surface-900 border border-surface-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
            />
            <input
              type="email"
              value={identity.email}
              onChange={e => setIdentity({ ...identity, email: e.target.value })}
              placeholder={t('you@example.com')}
              className="w-full bg-surface-900 border border-surface-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setIdentity(null)} className="text-[11px] text-surface-400 hover:text-white px-2 py-1">{t('Cancel')}</button>
              <button
                onClick={saveIdentity}
                disabled={!identity.name.trim() || !identity.email.trim()}
                className="text-[11px] bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded px-2 py-1"
              >{t('Save & commit')}</button>
            </div>
          </div>
        )}
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit(); }}
          placeholder={t('Commit message… (⌘↵ to commit)')}
          rows={2}
          className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-xs resize-none focus:outline-none focus:border-blue-500 placeholder-surface-600"
        />
        {!scoped && (
          <label className="flex items-center gap-1.5 text-[11px] text-surface-400 select-none cursor-pointer">
            <input type="checkbox" checked={amend} onChange={toggleAmend} className="accent-blue-500" />
            {t('Amend last commit')}
          </label>
        )}
        <div className="flex gap-2">
          <button
            onClick={commit}
            disabled={!message.trim() || (!hasStaged && !amend)}
            className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded text-xs font-medium transition-colors"
          >
            {amend ? t('Amend') : hasStaged ? t('Commit (:count)', { count: status.staged.length }) : t('Commit')}
          </button>
          <button
            onClick={stash}
            disabled={!isDirty}
            title={t('Park all uncommitted changes - restore them later from the Branches tab')}
            className="px-3 py-1.5 bg-surface-800 hover:bg-surface-700 border border-surface-700 disabled:opacity-40 disabled:cursor-not-allowed rounded text-xs font-medium text-surface-200 transition-colors"
          >
            {t('Stash')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Log tab

function LogTab({ onRefresh, scoped }: { readonly onRefresh: () => void; readonly scoped: boolean }) {
  const t = useT();
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [openHash, setOpenHash] = useState<string | null>(null);
  const [diff, setDiff] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(() => {
    setLoading(true);
    electron.gitLog(100)
      .then(setCommits)
      .catch(() => setCommits([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleCommit(c: GitCommit) {
    if (openHash === c.hash) { setOpenHash(null); setDiff(''); return; }
    setOpenHash(c.hash);
    setDiff('');
    try { setDiff(await electron.gitShow(c.hash)); } catch (e) { setDiff(String(e)); }
  }

  function undoLast() {
    // reset --soft HEAD~1 keeps the changes staged, so it is recoverable; still
    // confirm since it rewrites the branch tip. Repo-wide, so scoped mode hides it.
    confirm(t('Undo the last commit? Its changes stay staged.'), async () => {
      try {
        setError(null);
        await electron.gitUncommit();
        load();
        onRefresh();
      } catch (e) { setError(String(e)); }
    }, t('Undo commit'));
  }

  if (loading) return <p className="text-xs text-surface-500 px-3 py-4">{t('Loading…')}</p>;
  if (commits.length === 0) return <p className="text-xs text-surface-500 px-3 py-4">{t('No commits yet.')}</p>;

  return (
    <div className="flex-1 overflow-y-auto">
      {error && <p className="text-[11px] text-red-400 px-3 py-1">{error}</p>}
      {!scoped && (
        <div className="px-3 py-1.5 flex justify-end border-b border-surface-800/50">
          <button
            onClick={undoLast}
            className="text-[10px] text-surface-500 hover:text-amber-400 transition-colors"
            title={t('Soft-reset HEAD~1 (keeps changes staged)')}
          >{t('Undo last commit')}</button>
        </div>
      )}
      {commits.map(c => (
        <div key={c.hash} className="border-b border-surface-800/50">
          <div
            className="px-3 py-2 hover:bg-surface-800/30 cursor-pointer"
            role="button"
            tabIndex={0}
            aria-expanded={openHash === c.hash}
            onClick={() => toggleCommit(c)}
            onKeyDown={onActivateKey(() => toggleCommit(c))}
          >
            <div className="flex items-start gap-2">
              <span className="text-[10px] font-mono text-surface-600 shrink-0 mt-0.5">{c.short}</span>
              <span className="text-xs text-surface-200 flex-1 line-clamp-2">{c.message}</span>
            </div>
            <div className="mt-0.5 pl-9 flex gap-2 text-[10px] text-surface-600">
              <span>{c.author}</span>
              <span>{new Date(c.date).toLocaleDateString()}</span>
            </div>
          </div>
          {openHash === c.hash && (
            <div className="max-h-80 overflow-auto border-t border-surface-800/50 bg-surface-900/40">
              {diff ? <DiffViewer diff={diff} /> : <p className="text-[11px] text-surface-500 px-3 py-2">{t('Loading…')}</p>}
            </div>
          )}
        </div>
      ))}
      {dialog}
    </div>
  );
}

// Branches tab

function BranchesTab({ onRefresh, reloadWorkspace }: { readonly onRefresh: () => void; readonly reloadWorkspace: () => Promise<void> }) {
  const t = useT();
  const [branches,     setBranches]     = useState<GitBranch[]>([]);
  const [remotes,      setRemotes]      = useState<GitRemote[]>([]);
  const [stashes,      setStashes]      = useState<GitStash[]>([]);
  const [tags,         setTags]         = useState<GitTag[]>([]);
  const [info,         setInfo]         = useState<string | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [newBranch,    setNewBranch]    = useState('');
  const [creating,     setCreating]     = useState(false);
  const [renaming,     setRenaming]     = useState(false);
  const [renameValue,  setRenameValue]  = useState('');
  const [addingRemote, setAddingRemote] = useState(false);
  const [editingRemote, setEditingRemote] = useState<string | null>(null); // remote name being edited
  const [remoteName,   setRemoteName]   = useState('origin');
  const [remoteUrl,    setRemoteUrl]    = useState('');
  const [editUrl,      setEditUrl]      = useState('');
  const [addingTag,    setAddingTag]    = useState(false);
  const [tagName,      setTagName]      = useState('');
  const [tagMessage,   setTagMessage]   = useState('');
  const [openStash,    setOpenStash]    = useState<string | null>(null);
  const [stashDiff,    setStashDiff]    = useState('');
  const [error,        setError]        = useState<string | null>(null);
  const [loadError,    setLoadError]    = useState<string | null>(null);
  const [filter,       setFilter]       = useState('');

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([electron.gitBranches(), electron.gitRemotes(), electron.gitStashList(), electron.gitTagList()])
      .then(([b, r, s, tg]) => { setBranches(b); setRemotes(r); setStashes(s); setTags(tg); })
      .catch(err => {
        console.warn('GitPanel: failed to load branches/remotes', err);
        setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // git aborts a checkout that would clobber uncommitted work (wording varies).
  // On that failure, offer to stash and retry; any other error propagates.
  function isDirtyTreeError(msg: string): boolean {
    return /overwritten by (checkout|merge)|commit your changes or stash/i.test(msg);
  }

  async function checkoutOrStash(localName: string, create: boolean): Promise<boolean> {
    try {
      await electron.gitCheckout(localName, create);
      return true;
    } catch (e) {
      const msg = String(e);
      if (!isDirtyTreeError(msg)) throw e;
      if (!confirm(t('You have uncommitted changes that would be lost switching to ":name". Stash them and switch?', { name: localName }))) {
        return false;
      }
      await electron.gitStash(t('Auto-stash before switching to :name', { name: localName }));
      await electron.gitCheckout(localName, create);
      setInfo(t('Your changes were stashed. Restore them from the Stashes list below when you return.'));
      return true;
    }
  }

  async function checkout(name: string, remote: boolean) {
    try {
      setError(null); setInfo(null);
      const localName = remote ? name.replace(/^origin\//, '') : name;
      // A checkout swaps the working-tree files, so the in-memory workspace is
      // stale - reload it from disk before refreshing the git views.
      if (await checkoutOrStash(localName, false)) { await reloadWorkspace(); load(); onRefresh(); }
    } catch (e) { setError(String(e)); }
  }

  async function createBranch() {
    if (!newBranch.trim()) return;
    try {
      setError(null); setInfo(null);
      if (await checkoutOrStash(newBranch.trim(), true)) {
        setNewBranch(''); setCreating(false);
        // Creating a branch keeps the same files, but checkoutOrStash may have
        // auto-stashed dirty work (removing it from the tree), so reload to match.
        await reloadWorkspace(); load(); onRefresh();
      }
    } catch (e) { setError(String(e)); }
  }

  // Rebase the current branch onto `onto`. Rewrites the working tree, so reload
  // the workspace after; on conflicts, leave the user in the Changes tab.
  async function rebaseOnto(onto: string) {
    if (!confirm(t('Rebase the current branch onto ":name"? Your commits are replayed on top of it.', { name: onto }))) return;
    try {
      setError(null); setInfo(null);
      const r = await electron.gitRebase(onto);
      await reloadWorkspace();
      setInfo(r.conflict
        ? t('Rebase paused on conflicts. Open the Changes tab to resolve them, then Continue.')
        : t('Rebased onto :name.', { name: onto }));
      load(); onRefresh();
    } catch (e) { setError(String(e)); }
  }

  async function popStash(ref: string) {
    try {
      setError(null); setInfo(null);
      await electron.gitStashPop(ref);
      // Popping writes the parked changes back to the working tree - reload the store.
      await reloadWorkspace(); load(); onRefresh();
    } catch (e) { setError(String(e)); }
  }

  async function dropStash(ref: string) {
    if (!confirm(t('Discard stashed changes (:ref)? This cannot be undone.', { ref }))) return;
    try {
      setError(null); setInfo(null);
      await electron.gitStashDrop(ref);
      load();
    } catch (e) { setError(String(e)); }
  }

  async function addRemote() {
    if (!remoteName.trim() || !remoteUrl.trim()) return;
    try {
      setError(null);
      await electron.gitAddRemote(remoteName.trim(), remoteUrl.trim());
      setRemoteName('origin'); setRemoteUrl(''); setAddingRemote(false);
      load();
    } catch (e) { setError(String(e)); }
  }

  function startEdit(r: GitRemote) {
    setEditingRemote(r.name);
    setEditUrl(r.url);
  }

  async function saveRemoteUrl(name: string) {
    if (!editUrl.trim()) return;
    try {
      setError(null);
      await electron.gitSetRemoteUrl(name, editUrl.trim());
      setEditingRemote(null);
      load();
    } catch (e) { setError(String(e)); }
  }

  async function removeRemote(name: string) {
    try {
      setError(null);
      await electron.gitRemoveRemote(name);
      load();
    } catch (e) { setError(String(e)); }
  }

  async function deleteBranch(name: string) {
    if (!confirm(t('Delete branch ":name"?', { name }))) return;
    try {
      setError(null);
      try {
        await electron.gitDeleteBranch(name, false);
      } catch {
        // -d refuses if branch isn't fully merged; offer force-delete.
        if (!confirm(t('":name" isn\'t fully merged. Force delete?', { name }))) return;
        await electron.gitDeleteBranch(name, true);
      }
      load(); onRefresh();
    } catch (e) { setError(String(e)); }
  }

  async function renameCurrent() {
    const name = renameValue.trim();
    if (!name) return;
    try {
      setError(null); setInfo(null);
      await electron.gitRenameBranch(name);
      setRenaming(false); setRenameValue('');
      load(); onRefresh();
    } catch (e) { setError(String(e)); }
  }

  // Merge another branch into the current one. Rewrites the working tree, so
  // reload the workspace after; a conflict routes to Changes.
  async function mergeBranch(name: string) {
    if (!confirm(t('Merge ":name" into the current branch?', { name }))) return;
    try {
      setError(null); setInfo(null);
      const r = await electron.gitMerge(name);
      await reloadWorkspace();
      setInfo(r.conflict
        ? t('Merge stopped on conflicts. Open the Changes tab to resolve them.')
        : t('Merged :name.', { name }));
      load(); onRefresh();
    } catch (e) { setError(String(e)); }
  }

  async function deleteRemoteBranch(fullName: string) {
    // fullName is like "origin/feature-x"; split into remote + branch.
    const slash = fullName.indexOf('/');
    if (slash < 0) return;
    const remoteName = fullName.slice(0, slash);
    const branchName = fullName.slice(slash + 1);
    if (!confirm(t('Delete ":branch" on remote ":remote"? This cannot be undone.', { branch: branchName, remote: remoteName }))) return;
    try {
      setError(null);
      await electron.gitDeleteRemoteBranch(remoteName, branchName);
      load(); onRefresh();
    } catch (e) { setError(String(e)); }
  }

  async function applyStash(ref: string) {
    try {
      setError(null); setInfo(null);
      await electron.gitStashApply(ref);
      // Applying writes the parked changes back without removing the stash.
      await reloadWorkspace(); load(); onRefresh();
    } catch (e) { setError(String(e)); }
  }

  async function toggleStashDiff(ref: string) {
    if (openStash === ref) { setOpenStash(null); setStashDiff(''); return; }
    setOpenStash(ref);
    setStashDiff('');
    try { setStashDiff(await electron.gitStashShow(ref)); } catch (e) { setStashDiff(String(e)); }
  }

  async function createTag() {
    const name = tagName.trim();
    if (!name) return;
    try {
      setError(null);
      await electron.gitCreateTag(name, tagMessage.trim() || undefined);
      setTagName(''); setTagMessage(''); setAddingTag(false);
      load();
    } catch (e) { setError(String(e)); }
  }

  async function deleteTag(name: string) {
    if (!confirm(t('Delete tag ":name"?', { name }))) return;
    try {
      setError(null);
      await electron.gitDeleteTag(name);
      load();
    } catch (e) { setError(String(e)); }
  }

  async function pushTags() {
    try {
      setError(null); setInfo(null);
      await electron.gitPushTags();
      setInfo(t('Tags pushed to remote.'));
    } catch (e) { setError(String(e)); }
  }

  const q = filter.trim().toLowerCase();
  const local  = branches.filter(b => !b.remote && (!q || b.name.toLowerCase().includes(q)));
  const remote = branches.filter(b => b.remote  && (!q || b.name.toLowerCase().includes(q)));

  if (loading) return <p className="text-xs text-surface-500 px-3 py-4">{t('Loading…')}</p>;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      {error && <p className="text-[11px] text-red-400 px-3 py-1 truncate" title={error}>{error}</p>}
      {info && (
        <p className="text-[11px] text-blue-300 px-3 py-1 bg-blue-900/20 border-b border-surface-800">{info}</p>
      )}
      {loadError && (
        <p className="text-[11px] text-amber-400 px-3 py-1 truncate" title={loadError}>
          {t('Couldn\'t load git state:')} {loadError}
        </p>
      )}

      {/* Filter + new branch */}
      <div className="px-3 py-2 border-b border-surface-800 flex flex-col gap-1.5">
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder={t('Filter branches…')}
          className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500 placeholder-surface-600"
        />
        {creating ? (
          <div className="flex gap-1.5">
            <input
              autoFocus
              value={newBranch}
              onChange={e => setNewBranch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createBranch(); if (e.key === 'Escape') setCreating(false); }}
              placeholder={t('branch-name')}
              className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500 placeholder-surface-600"
            />
            <button onClick={createBranch} className="text-xs text-blue-400 hover:text-blue-300 px-1">{t('Create')}</button>
            <button onClick={() => setCreating(false)} className="text-xs text-surface-500 hover:text-white px-1">✕</button>
          </div>
        ) : (
          <button onClick={() => setCreating(true)} className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors text-left">
            {t('+ New branch (from :name)', { name: branches.find(b => b.current)?.name ?? 'HEAD' })}
          </button>
        )}
      </div>

      {/* Local branches */}
      {local.length > 0 && (
        <section>
          <p className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-surface-500 font-semibold">{t('Local')}</p>
          {renaming && (
            <div className="flex gap-1.5 px-3 py-1.5 bg-blue-900/20">
              <input
                autoFocus
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') renameCurrent(); if (e.key === 'Escape') setRenaming(false); }}
                placeholder={t('new branch name')}
                className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-500"
              />
              <button onClick={renameCurrent} className="text-xs text-blue-400 hover:text-blue-300 px-1">{t('Rename')}</button>
              <button onClick={() => setRenaming(false)} className="text-xs text-surface-500 hover:text-white px-1">✕</button>
            </div>
          )}
          {local.map(b => (
            <div
              key={b.name}
              className={`group w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                b.current ? 'bg-blue-900/30 text-blue-200' : 'text-surface-300 hover:bg-surface-800/50'
              }`}
            >
              {b.current
                ? <span className="text-blue-400 text-[10px]">●</span>
                : <span className="w-3" />}
              <button
                onClick={() => !b.current && checkout(b.name, false)}
                disabled={b.current}
                className="flex-1 text-left font-mono truncate disabled:cursor-default"
                title={b.upstream ? t('tracks :upstream', { upstream: b.upstream }) : t('no upstream')}
              >
                {b.name}
              </button>
              {b.current && (
                <button
                  onClick={() => { setRenaming(true); setRenameValue(b.name); }}
                  className="opacity-0 group-hover:opacity-100 text-surface-500 hover:text-blue-300 transition-all text-[10px] leading-none"
                  title={t('Rename this branch')}
                >
                  {t('rename')}
                </button>
              )}
              {/* Sync chips: ahead/behind at a glance. */}
              {b.behind ? (
                <span className="text-[10px] px-1 rounded bg-amber-900/40 text-amber-300" title={t(':count commit behind :upstream|:count commits behind :upstream', { count: b.behind, upstream: b.upstream })}>
                  ↓{b.behind}
                </span>
              ) : null}
              {b.ahead ? (
                <span className="text-[10px] px-1 rounded bg-emerald-900/40 text-emerald-300" title={t(':count commit ahead of :upstream|:count commits ahead of :upstream', { count: b.ahead, upstream: b.upstream })}>
                  ↑{b.ahead}
                </span>
              ) : null}
              {!b.current && (
                <button
                  onClick={() => mergeBranch(b.name)}
                  className="opacity-0 group-hover:opacity-100 text-surface-500 hover:text-emerald-300 transition-all text-[10px] leading-none"
                  title={t('Merge :name into the current branch', { name: b.name })}
                >
                  {t('merge')}
                </button>
              )}
              {!b.current && (
                <button
                  onClick={() => rebaseOnto(b.name)}
                  className="opacity-0 group-hover:opacity-100 text-surface-500 hover:text-blue-300 transition-all text-[10px] leading-none"
                  title={t('Rebase the current branch onto :name', { name: b.name })}
                >
                  {t('rebase')}
                </button>
              )}
              {!b.current && (
                <button
                  onClick={() => deleteBranch(b.name)}
                  className="opacity-0 group-hover:opacity-100 text-surface-500 hover:text-red-400 transition-all text-xs leading-none"
                  title={t('Delete :name', { name: b.name })}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Remote branches */}
      {remote.length > 0 && (
        <section>
          <p className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-surface-500 font-semibold">{t('Remote')}</p>
          {remote.map(b => (
            <div
              key={b.name}
              className="group w-full flex items-center gap-2 px-3 py-1.5 text-xs text-surface-400 hover:bg-surface-800/50 transition-colors"
            >
              <span className="w-3" />
              <button
                onClick={() => checkout(b.name, false)}
                className="flex-1 text-left font-mono truncate hover:text-surface-200"
                title={t('Click to check out - creates a local tracking branch if needed')}
              >
                {b.name}
              </button>
              <button
                onClick={() => mergeBranch(b.name)}
                className="opacity-0 group-hover:opacity-100 text-surface-500 hover:text-emerald-300 transition-all text-[10px] leading-none"
                title={t('Merge :name into the current branch', { name: b.name })}
              >
                {t('merge')}
              </button>
              <button
                onClick={() => deleteRemoteBranch(b.name)}
                className="opacity-0 group-hover:opacity-100 text-surface-500 hover:text-red-400 transition-all text-xs leading-none"
                title={t('Delete :name on the remote', { name: b.name })}
              >
                ✕
              </button>
            </div>
          ))}
        </section>
      )}

      {/* Empty filter result */}
      {q && local.length === 0 && remote.length === 0 && (
        <p className="px-3 py-3 text-[11px] text-surface-500">{t('No branches match ":filter".', { filter })}</p>
      )}

      {/* Stashes - parked working-tree snapshots. Pop restores onto the current
          branch; drop discards permanently. */}
      {stashes.length > 0 && (
        <section className="border-t border-surface-800 mt-1">
          <p className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-surface-500 font-semibold">{t('Stashes')}</p>
          {stashes.map(s => (
            <div key={s.ref}>
              <div className="group flex items-center gap-2 px-3 py-1.5 text-xs text-surface-300 hover:bg-surface-800/50">
                <span className="font-mono text-[10px] text-surface-500 shrink-0">{s.ref}</span>
                <span className="truncate flex-1" title={s.branch ? t('on :branch: :message', { branch: s.branch, message: s.message }) : s.message}>
                  {s.message}
                  {s.branch && <span className="text-surface-600"> {t('(on :branch)', { branch: s.branch })}</span>}
                </span>
                <button
                  onClick={() => toggleStashDiff(s.ref)}
                  className="opacity-0 group-hover:opacity-100 text-[10px] text-surface-500 hover:text-surface-200 transition-all shrink-0"
                  title={t('Show what this stash changed')}
                >
                  {t('Diff')}
                </button>
                <button
                  onClick={() => applyStash(s.ref)}
                  className="opacity-0 group-hover:opacity-100 text-[10px] text-surface-500 hover:text-surface-200 transition-all shrink-0"
                  title={t('Restore these changes and keep the stash')}
                >
                  {t('Apply')}
                </button>
                <button
                  onClick={() => popStash(s.ref)}
                  className="opacity-0 group-hover:opacity-100 text-[10px] text-blue-400 hover:text-blue-300 transition-all shrink-0"
                  title={t('Restore these changes onto the current branch and drop the stash')}
                >
                  {t('Pop')}
                </button>
                <button
                  onClick={() => dropStash(s.ref)}
                  className="opacity-0 group-hover:opacity-100 text-[10px] text-surface-500 hover:text-red-400 transition-all shrink-0"
                  title={t('Discard this stash')}
                >
                  ✕
                </button>
              </div>
              {openStash === s.ref && (
                <div className="max-h-72 overflow-auto border-y border-surface-800/50 bg-surface-900/40">
                  {stashDiff ? <DiffViewer diff={stashDiff} /> : <p className="text-[11px] text-surface-500 px-3 py-2">{t('Loading…')}</p>}
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Tags */}
      <section className="border-t border-surface-800 mt-1">
        <div className="px-3 py-1.5 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-widest text-surface-500 font-semibold">{t('Tags')}</p>
          <div className="flex items-center gap-3">
            {tags.length > 0 && (
              <button onClick={pushTags} className="text-[10px] text-surface-500 hover:text-blue-300 transition-colors" title={t('Push all tags to the remote')}>
                {t('Push tags')}
              </button>
            )}
            {!addingTag && (
              <button onClick={() => setAddingTag(true)} className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors">
                {t('+ Add')}
              </button>
            )}
          </div>
        </div>

        {addingTag && (
          <div className="px-3 pb-2 flex flex-col gap-1.5">
            <input
              autoFocus
              value={tagName}
              onChange={e => setTagName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createTag(); if (e.key === 'Escape') setAddingTag(false); }}
              placeholder={t('tag name (e.g. v1.2.0)')}
              className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-500 placeholder-surface-600"
            />
            <input
              value={tagMessage}
              onChange={e => setTagMessage(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createTag(); if (e.key === 'Escape') setAddingTag(false); }}
              placeholder={t('message (optional - creates an annotated tag)')}
              className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500 placeholder-surface-600"
            />
            <div className="flex gap-2">
              <button onClick={createTag} disabled={!tagName.trim()} className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40 transition-colors">{t('Create tag')}</button>
              <button onClick={() => setAddingTag(false)} className="text-xs text-surface-500 hover:text-white transition-colors">{t('Cancel')}</button>
            </div>
          </div>
        )}

        {tags.map(tag => (
          <div key={tag.name} className="group flex items-center gap-2 px-3 py-1 text-xs text-surface-300 hover:bg-surface-800/50">
            <span className="font-mono text-blue-300 shrink-0">{tag.name}</span>
            <span className="truncate flex-1 text-surface-600" title={tag.subject}>{tag.subject}</span>
            <button
              onClick={() => deleteTag(tag.name)}
              className="opacity-0 group-hover:opacity-100 text-[10px] text-surface-500 hover:text-red-400 transition-all shrink-0"
              title={t('Delete tag :name', { name: tag.name })}
            >✕</button>
          </div>
        ))}

        {tags.length === 0 && !addingTag && (
          <p className="px-3 pb-2 text-[11px] text-surface-600">{t('No tags yet.')}</p>
        )}
      </section>

      {/* Remotes */}
      <section className="border-t border-surface-800 mt-1">
        <div className="px-3 py-1.5 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-widest text-surface-500 font-semibold">{t('Remotes')}</p>
          {!addingRemote && (
            <button onClick={() => setAddingRemote(true)} className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors">
              {t('+ Add')}
            </button>
          )}
        </div>

        {remotes.map(r => (
          <div key={r.name} className="px-3 py-1 group">
            {editingRemote === r.name ? (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-mono text-surface-400">{r.name}</span>
                <div className="flex gap-1.5">
                  <input
                    autoFocus
                    value={editUrl}
                    onChange={e => setEditUrl(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveRemoteUrl(r.name); if (e.key === 'Escape') setEditingRemote(null); }}
                    className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                  />
                  <button onClick={() => saveRemoteUrl(r.name)} className="text-xs text-blue-400 hover:text-blue-300 px-1">{t('Save')}</button>
                  <button onClick={() => setEditingRemote(null)} className="text-xs text-surface-500 hover:text-white px-1">✕</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-surface-300 shrink-0">{r.name}</span>
                <span className="text-[10px] font-mono text-surface-600 truncate flex-1">{r.url}</span>
                <button
                  onClick={() => startEdit(r)}
                  className="opacity-0 group-hover:opacity-100 text-[10px] text-surface-500 hover:text-blue-400 transition-all shrink-0"
                  title={t('Edit URL')}
                >✎</button>
                <button
                  onClick={() => removeRemote(r.name)}
                  className="opacity-0 group-hover:opacity-100 text-[10px] text-surface-500 hover:text-red-400 transition-all shrink-0"
                  title={t('Remove remote')}
                >✕</button>
              </div>
            )}
          </div>
        ))}

        {remotes.length === 0 && !addingRemote && (
          <p className="px-3 pb-2 text-[11px] text-surface-600">{t('No remotes configured.')}</p>
        )}

        {addingRemote && (
          <div className="px-3 pb-3 flex flex-col gap-1.5">
            <input
              value={remoteName}
              onChange={e => setRemoteName(e.target.value)}
              placeholder={t('name (e.g. origin)')}
              className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500 placeholder-surface-600"
            />
            <input
              autoFocus
              value={remoteUrl}
              onChange={e => setRemoteUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addRemote(); if (e.key === 'Escape') setAddingRemote(false); }}
              placeholder="git@github.com:user/repo.git"
              className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500 placeholder-surface-600"
            />
            <div className="flex gap-2">
              <button onClick={addRemote} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">{t('Add remote')}</button>
              <button onClick={() => setAddingRemote(false)} className="text-xs text-surface-500 hover:text-white transition-colors">{t('Cancel')}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// CI tab

function CiTab() {
  const t = useT();
  const environments = useStore(s => s.environments);
  const envList = Object.values(environments);
  const collections = useStore(s => s.collections);

  const [remotes,      setRemotes]      = useState<GitRemote[]>([]);
  const [platform,     setPlatform]     = useState<CiPlatform>('unknown');
  const [envId,        setEnvId]        = useState('');
  const [tags,         setTags]         = useState('');
  const [preview,      setPreview]      = useState('');
  const [edited,       setEdited]       = useState(false);
  const [written,      setWritten]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  useEffect(() => {
    electron.gitRemotes().then(r => {
      setRemotes(r);
      const detected = detectPlatform(r);
      setPlatform(detected);
    }).catch(err => {
      // No git remote is normal for fresh workspaces - log but don't surface a
      // UI error; the platform picker defaults to 'unknown'.
      console.warn('GitPanel: failed to read git remotes', err);
    });
  }, []);

  // Build the pipeline from the current platform/env/tags + detected secrets.
  // A callable (not an effect) so a deliberate change or "Regenerate" rebuilds
  // it without clobbering manual edits on unrelated re-renders.
  const buildGenerated = useCallback(() => {
    const env = Object.values(environments).find(e => e.data.id === envId);
    const secretVars = env
      ? env.data.variables.filter(v => v.secret && v.enabled).map(v => v.key)
      : [];
    // Detect which external secret managers this run references, so the pipeline
    // wires up their credentials. Two sources: env-var secretRefs, and inline
    // {{vault:...}} anywhere in a request.
    const envRefManagers = env
      ? env.data.variables
          .filter(v => v.enabled && v.secretRef)
          .map(v => secretManagerOf(v.secretRef!))
          .filter((k): k is SecretManagerKind => k !== null)
      : [];
    const inlineManagers = Object.values(collections).flatMap(c =>
      Object.values(c.data.requests).flatMap(requestSecretManagers));
    const secretManagers = [...new Set([...envRefManagers, ...inlineManagers])];
    const envName = env?.data.name ?? '';
    return generateCiContent(platform, envName, tags, secretVars, secretManagers);
  }, [platform, envId, tags, environments, collections]);

  // Regenerate only when a setting changes (platform/env/tags), which discards
  // manual edits. Incidental store updates don't overwrite what the user typed.
  useEffect(() => {
    setPreview(buildGenerated());
    setEdited(false);
    setWritten(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, envId, tags]);

  // Sync the pipeline with background changes only while the user hasn't edited
  // it by hand - manual edits are never silently overwritten.
  useEffect(() => {
    if (!edited) { setPreview(buildGenerated()); setWritten(false); }
  }, [buildGenerated, edited]);

  function regenerate() {
    setPreview(buildGenerated());
    setEdited(false);
    setWritten(false);
  }

  function editPreview(value: string) {
    setPreview(value);
    setEdited(true);
    setWritten(false);
  }

  async function write() {
    try {
      setError(null);
      await electron.gitWriteCiFile(ciFilePath(platform), preview);
      setWritten(true);
    } catch (e) { setError(String(e)); }
  }

  const platformLabels: Record<CiPlatform, string> = {
    github:  'GitHub Actions',
    gitlab:  'GitLab CI',
    azure:   'Azure Pipelines',
    unknown: t('Unknown'),
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <div className="px-3 py-3 flex flex-col gap-3 border-b border-surface-800">

        {/* Platform */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-surface-500 font-semibold">{t('Platform')}</label>
          <select
            value={platform}
            onChange={e => setPlatform(e.target.value as CiPlatform)}
            className="bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
          >
            {(['github', 'gitlab', 'azure'] as CiPlatform[]).map(p => (
              <option key={p} value={p}>{platformLabels[p]}</option>
            ))}
          </select>
          {remotes.length > 0 && (
            <span className="text-[10px] text-surface-600">
              {t('Detected from remote: :platform', { platform: platformLabels[detectPlatform(remotes)] })}
            </span>
          )}
        </div>

        {/* Environment */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-surface-500 font-semibold">{t('Environment')}</label>
          <select
            value={envId}
            onChange={e => setEnvId(e.target.value)}
            className="bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
          >
            <option value="">{t('(none)')}</option>
            {envList.map(e => (
              <option key={e.data.id} value={e.data.id}>{e.data.name}</option>
            ))}
          </select>
          {envId && (() => {
            const env = envList.find(e => e.data.id === envId);
            const secrets = env?.data.variables.filter(v => v.secret && v.enabled) ?? [];
            return secrets.length > 0
              ? <span className="text-[10px] text-amber-400/80">{t(':count secret variable will be mapped to CI secrets|:count secret variables will be mapped to CI secrets', { count: secrets.length })}</span>
              : null;
          })()}
        </div>

        {/* Tags */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-surface-500 font-semibold">{t('Tags (optional)')}</label>
          <input
            value={tags}
            onChange={e => setTags(e.target.value)}
            placeholder={t('e.g. smoke, regression')}
            className="bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 placeholder-surface-600"
          />
        </div>

        {error && <p className="text-[11px] text-red-400">{error}</p>}

        <div className="flex items-center gap-2">
          <button
            onClick={write}
            className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium transition-colors"
          >
            {t('Write :path', { path: ciFilePath(platform) })}
          </button>
          {written && <span className="text-[11px] text-emerald-400">✓ {t('Written')}</span>}
        </div>
      </div>

      {/* Pipeline (editable). Edits are written to disk as-is; changing a
          setting above regenerates and discards them. */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 pt-2 pb-1 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-widest text-surface-600 font-semibold">
            {t('Pipeline')}
            {edited && <span className="ml-2 text-amber-400/80 normal-case tracking-normal font-normal">{t('(edited)')}</span>}
          </p>
          <button
            onClick={regenerate}
            disabled={!edited}
            title={t('Discard edits and regenerate from the settings above')}
            className="text-[10px] text-surface-400 hover:text-white disabled:opacity-40 disabled:cursor-default transition-colors"
          >
            {t('↺ Regenerate')}
          </button>
        </div>
        <textarea
          value={preview}
          onChange={e => editPreview(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label={t('Pipeline file contents')}
          className="flex-1 min-h-0 mx-3 mb-3 resize-none bg-surface-900 border border-surface-800 rounded px-3 py-2 text-[10px] font-mono text-surface-300 leading-relaxed focus:outline-none focus:border-blue-500 whitespace-pre"
        />
      </div>
    </div>
  );
}

// Root

export function GitPanel() {
  const t = useT();
  const { reloadWorkspace } = useWorkspaceLoader();
  const [info,    setInfo]    = useState<GitRepoInfo | null>(null);
  const [status,  setStatus]  = useState<GitStatus | null>(null);
  const [tab,     setTab]     = useState<Tab>('changes');
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);

  const refresh = useCallback(async () => {
    try {
      const repoInfo = await electron.gitRepoInfo();
      setInfo(repoInfo);
      // Only run a working-tree command once there's a repo we operate on;
      // otherwise show an offer instead.
      setStatus(repoInfo.state === 'own' || repoInfo.state === 'scoped'
        ? await electron.gitStatus()
        : null);
    } catch {
      setInfo({ state: 'none' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Opt the workspace into scoped mode (version only this subtree of the
  // enclosing repo). Persisted in the manifest so it survives reloads.
  async function enableScoped() {
    setBusy(true);
    try {
      const ws = useStore.getState().workspace;
      if (ws) {
        useStore.getState().updateWorkspaceSettings({
          ...ws.settings,
          git: { ...ws.settings?.git, useEnclosingRepo: true },
        });
        const updated = useStore.getState().workspace;
        if (updated) await electron.saveWorkspace(updated);
      }
      await refresh();
    } finally { setBusy(false); }
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-xs text-surface-500">{t('Loading…')}</div>;
  }

  const state = info?.state ?? 'none';

  if (state === 'none') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-xs text-surface-400">{t('Not a git repository.')}</p>
        <button
          onClick={async () => { await electron.gitInit(); refresh(); }}
          className="px-3 py-1.5 bg-surface-800 hover:bg-surface-700 rounded text-xs transition-colors"
        >git init</button>
      </div>
    );
  }

  if (state === 'enclosing-available') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-xs text-surface-300">
          {t('This workspace is inside the :repo repository (folder :scope/).', { repo: info?.repoName ?? '', scope: info?.scope ?? '' })}
        </p>
        <p className="text-[11px] text-surface-500">
          {t('Version just this folder as part of that repository, or set up a separate repo here.')}
        </p>
        <div className="flex flex-col gap-2 w-full max-w-[240px]">
          <button
            onClick={enableScoped}
            disabled={busy}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white transition-colors disabled:opacity-50"
          >{t('Use :repo (scoped)', { repo: info?.repoName ?? '' })}</button>
          <button
            onClick={async () => { await electron.gitInit(); refresh(); }}
            disabled={busy}
            className="px-3 py-1.5 bg-surface-800 hover:bg-surface-700 rounded text-xs transition-colors disabled:opacity-50"
          >{t('Initialize a separate repo here')}</button>
        </div>
      </div>
    );
  }

  const totalChanges = status
    ? status.staged.length + status.unstaged.length + status.untracked.length
    : 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {state === 'scoped' && (
        <div
          className="px-3 py-1 bg-surface-800/50 border-b border-surface-800 text-[10px] text-surface-400 flex items-center gap-1 flex-shrink-0"
          title={t('Branch and sync operations affect the whole :repo repository.', { repo: info?.repoName ?? '' })}
        >
          <span aria-hidden="true" className="text-blue-300">⬡</span>
          <span className="truncate">{t('scoped to :scope/ in :repo', { scope: info?.scope ?? '', repo: info?.repoName ?? '' })}</span>
        </div>
      )}
      <div className="flex border-b border-surface-800 flex-shrink-0">
        {(['changes', 'log', 'branches', 'ci'] as Tab[]).map(item => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={`flex-1 py-1.5 text-[11px] capitalize transition-colors border-b-2 -mb-px ${
              tab === item ? 'border-blue-500 text-white' : 'border-transparent text-surface-400 hover:text-white'
            }`}
          >
            {item === 'ci' ? 'CI' : item}
            {item === 'changes' && totalChanges > 0 && (
              <span className="ml-1 bg-surface-700 text-surface-300 rounded px-1 text-[9px]">{totalChanges}</span>
            )}
          </button>
        ))}
        <button
          onClick={refresh}
          title={t('Refresh')}
          className="px-2 text-surface-600 hover:text-surface-300 transition-colors border-b-2 border-transparent -mb-px"
        >↺</button>
      </div>

      {tab === 'changes'  && status && <ChangesTab status={status} onRefresh={refresh} reloadWorkspace={reloadWorkspace} scoped={state === 'scoped'} />}
      {tab === 'log'      && <LogTab onRefresh={refresh} scoped={state === 'scoped'} />}
      {tab === 'branches' && <BranchesTab onRefresh={refresh} reloadWorkspace={reloadWorkspace} />}
      {tab === 'ci'       && <CiTab />}
    </div>
  );
}
