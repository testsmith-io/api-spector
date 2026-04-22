// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useStore } from '../../store';
import type { GitStatus, GitCommit, GitBranch, GitRemote, GitFile, CiPlatform } from '../../../../shared/types';

const { electron } = window;

type Tab = 'changes' | 'log' | 'branches' | 'ci';

// ─── Toast ────────────────────────────────────────────────────────────────────

function useToast() {
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function show(msg: string, ok: boolean) {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, ok });
    timer.current = setTimeout(() => setToast(null), 3000);
  }
  return { toast, show };
}

function Toast({ toast }: { toast: { msg: string; ok: boolean } | null }) {
  if (!toast) return null;
  return (
    <div className={`mx-3 mb-2 px-2 py-1.5 rounded text-[11px] flex-shrink-0 ${
      toast.ok ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-800/50'
               : 'bg-red-900/50 text-red-300 border border-red-800/50'
    }`}>
      {toast.msg}
    </div>
  );
}

// ─── File status badge ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: GitFile['status'] }) {
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

// ─── Diff viewer ─────────────────────────────────────────────────────────────

function DiffViewer({ diff }: { diff: string }) {
  if (!diff) return <p className="text-xs text-surface-500 p-3">No changes.</p>;
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

// ─── Changes tab ─────────────────────────────────────────────────────────────

function ChangesTab({ status, onRefresh }: { status: GitStatus; onRefresh: () => void }) {
  const [message,    setMessage]    = useState('');
  const [diffFile,   setDiffFile]   = useState<string | null>(null);
  const [diff,       setDiff]       = useState('');
  const [diffStaged, setDiffStaged] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [pushing,    setPushing]    = useState(false);
  const [pulling,    setPulling]    = useState(false);
  const { toast, show: showToast }  = useToast();

  async function showDiff(file: GitFile, staged: boolean) {
    setDiffFile(file.path);
    setDiffStaged(staged);
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

  async function commit() {
    if (!message.trim()) return;
    try {
      setError(null);
      await electron.gitCommit(message.trim());
      setMessage('');
      onRefresh();
    } catch (e) { setError(String(e)); }
  }

  async function pull() {
    setPulling(true);
    try {
      await electron.gitPull();
      showToast('Pull successful', true);
      onRefresh();
    } catch (e) { showToast(String(e), false); }
    finally { setPulling(false); }
  }

  async function push() {
    setPushing(true);
    try {
      await electron.gitPush(!status.remote);
      showToast('Push successful', true);
      onRefresh();
    } catch (e) { showToast(String(e), false); }
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

  const allUnstaged = [...status.unstaged, ...status.untracked];
  const hasStaged   = status.staged.length > 0;
  const needsPush   = status.ahead > 0;
  const needsPull   = status.behind > 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Branch + sync bar */}
      <div className="px-3 py-2 border-b border-surface-800 flex items-center gap-2 flex-shrink-0">
        <span className="text-[11px] font-mono text-blue-300 truncate flex-1">⎇ {status.branch || 'no branch'}</span>
        <button
          onClick={pull}
          disabled={pulling}
          title={needsPull ? `Pull (${status.behind} behind)` : 'Pull'}
          className={`flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded transition-colors disabled:opacity-40 ${
            needsPull
              ? 'text-amber-300 bg-amber-900/30 hover:bg-amber-900/50'
              : 'text-surface-400 hover:text-white'
          }`}
        >
          ↓{needsPull ? <span className="text-[10px]">{status.behind}</span> : null}
        </button>
        <button
          onClick={push}
          disabled={pushing}
          title={needsPush ? `Push (${status.ahead} unpushed)` : status.remote ? 'Push' : 'Push & set upstream'}
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
            <span>{status.ahead} commit{status.ahead !== 1 ? 's' : ''} to push</span>
            <button
              onClick={push}
              disabled={pushing}
              className="text-blue-400 hover:text-blue-200 font-medium disabled:opacity-40"
            >Push ↑</button>
          </div>
        ) : (
          <div className="mx-3 mt-2 px-2 py-1 rounded text-[11px] text-surface-600 border border-surface-800 flex-shrink-0">
            ✓ Nothing to push
          </div>
        )
      )}

      {status.conflicted.length > 0 && (
        <div className="mx-3 mt-2 px-2 py-1.5 rounded text-[11px] bg-red-900/20 text-red-300 border border-red-800/40 flex-shrink-0">
          ⚠ {status.conflicted.length} merge conflict{status.conflicted.length !== 1 ? 's' : ''} — resolve below before committing
        </div>
      )}

      <Toast toast={toast} />

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Staged */}
        {hasStaged && (
          <section>
            <div className="px-3 py-1.5 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest text-surface-500 font-semibold">
                Staged ({status.staged.length})
              </span>
              <button
                onClick={() => unstage(status.staged.map(f => f.path))}
                className="text-[10px] text-surface-500 hover:text-white transition-colors"
              >Unstage all</button>
            </div>
            {status.staged.map(f => (
              <div
                key={f.path}
                className={`flex items-center gap-2 px-3 py-1 hover:bg-surface-800/50 cursor-pointer group text-xs ${diffFile === f.path && diffStaged ? 'bg-surface-800' : ''}`}
                onClick={() => showDiff(f, true)}
              >
                <StatusBadge status={f.status} />
                <span className="flex-1 truncate text-surface-200">{f.path}</span>
                <button
                  onClick={e => { e.stopPropagation(); unstage([f.path]); }}
                  className="opacity-0 group-hover:opacity-100 text-surface-500 hover:text-amber-400 transition-all text-[10px]"
                  title="Unstage"
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
                Changes ({allUnstaged.length})
              </span>
              <button
                onClick={stageAll}
                className="text-[10px] text-surface-500 hover:text-white transition-colors"
              >Stage all</button>
            </div>
            {allUnstaged.map(f => (
              <div
                key={f.path}
                className={`flex items-center gap-2 px-3 py-1 hover:bg-surface-800/50 cursor-pointer group text-xs ${diffFile === f.path && !diffStaged ? 'bg-surface-800' : ''}`}
                onClick={() => showDiff(f, false)}
              >
                <StatusBadge status={f.status} />
                <span className="flex-1 truncate text-surface-200">{f.path}</span>
                <button
                  onClick={e => { e.stopPropagation(); stage([f.path]); }}
                  className="opacity-0 group-hover:opacity-100 text-surface-500 hover:text-emerald-400 transition-all text-[10px]"
                  title="Stage"
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
                Conflicts ({status.conflicted.length})
              </span>
            </div>
            {status.conflicted.map(path => (
              <div
                key={path}
                className={`flex items-center gap-2 px-3 py-1 hover:bg-surface-800/50 cursor-pointer group text-xs ${diffFile === path && !diffStaged ? 'bg-surface-800' : ''}`}
                onClick={() => showDiff({ path, status: 'modified' }, false)}
              >
                <span className="font-mono text-[11px] font-bold w-4 shrink-0 text-red-400">!</span>
                <span className="flex-1 truncate text-red-300">{path}</span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button
                    onClick={e => { e.stopPropagation(); resolveConflict(path, 'ours'); }}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700 text-surface-300 hover:bg-emerald-900/50 hover:text-emerald-300 transition-colors"
                    title="Accept ours (current branch)"
                  >Ours</button>
                  <button
                    onClick={e => { e.stopPropagation(); resolveConflict(path, 'theirs'); }}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700 text-surface-300 hover:bg-blue-900/50 hover:text-blue-300 transition-colors"
                    title="Accept theirs (incoming)"
                  >Theirs</button>
                  <button
                    onClick={e => { e.stopPropagation(); resolveConflict(path, 'mark'); }}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700 text-surface-300 hover:bg-surface-600 transition-colors"
                    title="Mark as resolved (manual edit)"
                  >✓</button>
                </div>
              </div>
            ))}
          </section>
        )}

        {status.staged.length === 0 && allUnstaged.length === 0 && status.conflicted.length === 0 && (
          <p className="text-xs text-surface-500 px-3 py-4">Working tree clean.</p>
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
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit(); }}
          placeholder="Commit message… (⌘↵ to commit)"
          rows={2}
          className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-xs resize-none focus:outline-none focus:border-blue-500 placeholder-surface-600"
        />
        <button
          onClick={commit}
          disabled={!message.trim() || !hasStaged}
          className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded text-xs font-medium transition-colors"
        >
          Commit{hasStaged ? ` (${status.staged.length})` : ''}
        </button>
      </div>
    </div>
  );
}

// ─── Log tab ──────────────────────────────────────────────────────────────────

function LogTab() {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    electron.gitLog(100)
      .then(setCommits)
      .catch(() => setCommits([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-xs text-surface-500 px-3 py-4">Loading…</p>;
  if (commits.length === 0) return <p className="text-xs text-surface-500 px-3 py-4">No commits yet.</p>;

  return (
    <div className="flex-1 overflow-y-auto">
      {commits.map(c => (
        <div key={c.hash} className="px-3 py-2 border-b border-surface-800/50 hover:bg-surface-800/30">
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-mono text-surface-600 shrink-0 mt-0.5">{c.short}</span>
            <span className="text-xs text-surface-200 flex-1 line-clamp-2">{c.message}</span>
          </div>
          <div className="mt-0.5 pl-9 flex gap-2 text-[10px] text-surface-600">
            <span>{c.author}</span>
            <span>{new Date(c.date).toLocaleDateString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Branches tab ─────────────────────────────────────────────────────────────

function BranchesTab({ onRefresh }: { onRefresh: () => void }) {
  const [branches,     setBranches]     = useState<GitBranch[]>([]);
  const [remotes,      setRemotes]      = useState<GitRemote[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [newBranch,    setNewBranch]    = useState('');
  const [creating,     setCreating]     = useState(false);
  const [addingRemote, setAddingRemote] = useState(false);
  const [editingRemote, setEditingRemote] = useState<string | null>(null); // remote name being edited
  const [remoteName,   setRemoteName]   = useState('origin');
  const [remoteUrl,    setRemoteUrl]    = useState('');
  const [editUrl,      setEditUrl]      = useState('');
  const [error,        setError]        = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([electron.gitBranches(), electron.gitRemotes()])
      .then(([b, r]) => { setBranches(b); setRemotes(r); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function checkout(name: string, remote: boolean) {
    try {
      setError(null);
      const localName = remote ? name.replace(/^origin\//, '') : name;
      await electron.gitCheckout(localName, false);
      load(); onRefresh();
    } catch (e) { setError(String(e)); }
  }

  async function createBranch() {
    if (!newBranch.trim()) return;
    try {
      setError(null);
      await electron.gitCheckout(newBranch.trim(), true);
      setNewBranch(''); setCreating(false);
      load(); onRefresh();
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

  const local  = branches.filter(b => !b.remote);
  const remote = branches.filter(b => b.remote);

  if (loading) return <p className="text-xs text-surface-500 px-3 py-4">Loading…</p>;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      {error && <p className="text-[11px] text-red-400 px-3 py-1 truncate">{error}</p>}

      {/* New branch */}
      <div className="px-3 py-2 border-b border-surface-800">
        {creating ? (
          <div className="flex gap-1.5">
            <input
              autoFocus
              value={newBranch}
              onChange={e => setNewBranch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createBranch(); if (e.key === 'Escape') setCreating(false); }}
              placeholder="branch-name"
              className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500 placeholder-surface-600"
            />
            <button onClick={createBranch} className="text-xs text-blue-400 hover:text-blue-300 px-1">Create</button>
            <button onClick={() => setCreating(false)} className="text-xs text-surface-500 hover:text-white px-1">✕</button>
          </div>
        ) : (
          <button onClick={() => setCreating(true)} className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors">
            + New branch
          </button>
        )}
      </div>

      {/* Local branches */}
      {local.length > 0 && (
        <section>
          <p className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-surface-500 font-semibold">Local</p>
          {local.map(b => (
            <button
              key={b.name}
              onClick={() => !b.current && checkout(b.name, false)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                b.current ? 'text-blue-300 cursor-default' : 'text-surface-300 hover:bg-surface-800/50'
              }`}
            >
              {b.current ? <span className="text-blue-400 text-[10px]">●</span> : <span className="w-3" />}
              <span className="font-mono">{b.name}</span>
            </button>
          ))}
        </section>
      )}

      {/* Remote branches */}
      {remote.length > 0 && (
        <section>
          <p className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-surface-500 font-semibold">Remote branches</p>
          {remote.map(b => (
            <button
              key={b.name}
              onClick={() => checkout(b.name, true)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-surface-400 hover:bg-surface-800/50 hover:text-surface-200 transition-colors"
            >
              <span className="w-3" />
              <span className="font-mono">{b.name}</span>
            </button>
          ))}
        </section>
      )}

      {/* Remotes */}
      <section className="border-t border-surface-800 mt-1">
        <div className="px-3 py-1.5 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-widest text-surface-500 font-semibold">Remotes</p>
          {!addingRemote && (
            <button onClick={() => setAddingRemote(true)} className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors">
              + Add
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
                  <button onClick={() => saveRemoteUrl(r.name)} className="text-xs text-blue-400 hover:text-blue-300 px-1">Save</button>
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
                  title="Edit URL"
                >✎</button>
                <button
                  onClick={() => removeRemote(r.name)}
                  className="opacity-0 group-hover:opacity-100 text-[10px] text-surface-500 hover:text-red-400 transition-all shrink-0"
                  title="Remove remote"
                >✕</button>
              </div>
            )}
          </div>
        ))}

        {remotes.length === 0 && !addingRemote && (
          <p className="px-3 pb-2 text-[11px] text-surface-600">No remotes configured.</p>
        )}

        {addingRemote && (
          <div className="px-3 pb-3 flex flex-col gap-1.5">
            <input
              value={remoteName}
              onChange={e => setRemoteName(e.target.value)}
              placeholder="name (e.g. origin)"
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
              <button onClick={addRemote} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">Add remote</button>
              <button onClick={() => setAddingRemote(false)} className="text-xs text-surface-500 hover:text-white transition-colors">Cancel</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── CI tab ───────────────────────────────────────────────────────────────────

function detectPlatform(remotes: GitRemote[]): CiPlatform {
  const urls = remotes.map(r => r.url.toLowerCase()).join(' ');
  if (urls.includes('github.com'))                                         return 'github';
  if (urls.includes('gitlab.com') || urls.includes('gitlab.'))            return 'gitlab';
  if (urls.includes('dev.azure.com') || urls.includes('visualstudio.com')) return 'azure';
  return 'unknown';
}

const NODE_LTS = 'lts/*';

function generateCiContent(
  platform: CiPlatform,
  envName: string,
  tags: string,
  secretVars: string[],
): string {
  const runCmd = [
    'api-spector run --workspace .',
    envName ? `--environment "${envName}"` : '',
    tags    ? `--tags "${tags}"` : '',
    '--output results.html',
  ].filter(Boolean).join(' ');

  // Always include API_SPECTOR_MASTER_KEY when there are encrypted secrets
  const allSecretVars = secretVars.length ? ['API_SPECTOR_MASTER_KEY', ...secretVars] : [];

  if (platform === 'github') {
    const secretHint = allSecretVars.length
      ? `      # ⚠ Add these secrets in: Settings → Secrets and variables → Actions\n` +
        allSecretVars.map(v => `      #   ${v}`).join('\n') + '\n'
      : '';
    const envBlock = allSecretVars.length
      ? '\n        env:\n' + allSecretVars.map(v => `          ${v}: \${{ secrets.${v} }}`).join('\n')
      : '';
    return `name: API Tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  api-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '${NODE_LTS}'
      - run: npm install -g @testsmith/api-spector
${secretHint}      - name: Run API tests
        run: ${runCmd}${envBlock}
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: api-test-results
          path: results.html
`;
  }

  if (platform === 'gitlab') {
    const secretHint = allSecretVars.length
      ? `  # ⚠ Add these in: Settings → CI/CD → Variables\n` +
        allSecretVars.map(v => `  #   ${v}`).join('\n') + '\n'
      : '';
    const envBlock = allSecretVars.length
      ? '\n  variables:\n' + allSecretVars.map(v => `    ${v}: $${v}`).join('\n')
      : '';
    return `api-tests:
  image: node:${NODE_LTS}
  stage: test
  before_script:
    - npm install -g @testsmith/api-spector
${secretHint}  script:
    - ${runCmd}${envBlock}
  artifacts:
    when: always
    paths:
      - results.html
    expire_in: 30 days
`;
  }

  if (platform === 'azure') {
    const secretHint = allSecretVars.length
      ? `  # ⚠ Add these in: Pipelines → Library → Variable groups (mark as secret)\n` +
        allSecretVars.map(v => `  #   ${v}`).join('\n') + '\n'
      : '';
    const envBlock = allSecretVars.length
      ? '\n    env:\n' + allSecretVars.map(v => `      ${v}: $(${v})`).join('\n')
      : '';
    return `trigger:
  - main

pool:
  vmImage: ubuntu-latest

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '${NODE_LTS}.x'
    displayName: 'Use Node.js ${NODE_LTS}'
  - script: npm install -g @testsmith/api-spector
    displayName: 'Install API Spector'
${secretHint}  - script: ${runCmd}
    displayName: 'Run API tests'${envBlock}
  - publish: results.html
    artifact: api-test-results
    displayName: 'Upload test results'
    condition: always()
`;
  }

  return `# Unsupported platform — adapt as needed\n# ${runCmd}\n`;
}

function ciFilePath(platform: CiPlatform): string {
  if (platform === 'github') return '.github/workflows/api-tests.yml';
  if (platform === 'gitlab') return '.gitlab-ci.yml';
  if (platform === 'azure')  return 'azure-pipelines.yml';
  return 'ci.yml';
}

function CiTab() {
  const environments = useStore(s => s.environments);
  const envList = Object.values(environments);

  const [remotes,      setRemotes]      = useState<GitRemote[]>([]);
  const [platform,     setPlatform]     = useState<CiPlatform>('unknown');
  const [envId,        setEnvId]        = useState('');
  const [tags,         setTags]         = useState('');
  const [preview,      setPreview]      = useState('');
  const [written,      setWritten]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  useEffect(() => {
    electron.gitRemotes().then(r => {
      setRemotes(r);
      const detected = detectPlatform(r);
      setPlatform(detected);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const env = envList.find(e => e.data.id === envId);
    const secretVars = env
      ? env.data.variables.filter(v => v.secret && v.enabled).map(v => v.key)
      : [];
    const envName = env?.data.name ?? '';
    setPreview(generateCiContent(platform, envName, tags, secretVars));
    setWritten(false);
  }, [platform, envId, tags, environments]);

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
    unknown: 'Unknown',
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <div className="px-3 py-3 flex flex-col gap-3 border-b border-surface-800">

        {/* Platform */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-surface-500 font-semibold">Platform</label>
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
              Detected from remote: {platformLabels[detectPlatform(remotes)]}
            </span>
          )}
        </div>

        {/* Environment */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-surface-500 font-semibold">Environment</label>
          <select
            value={envId}
            onChange={e => setEnvId(e.target.value)}
            className="bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
          >
            <option value="">— none —</option>
            {envList.map(e => (
              <option key={e.data.id} value={e.data.id}>{e.data.name}</option>
            ))}
          </select>
          {envId && (() => {
            const env = envList.find(e => e.data.id === envId);
            const secrets = env?.data.variables.filter(v => v.secret && v.enabled) ?? [];
            return secrets.length > 0
              ? <span className="text-[10px] text-amber-400/80">{secrets.length} secret variable{secrets.length !== 1 ? 's' : ''} will be mapped to CI secrets</span>
              : null;
          })()}
        </div>

        {/* Tags */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-surface-500 font-semibold">Tags (optional)</label>
          <input
            value={tags}
            onChange={e => setTags(e.target.value)}
            placeholder="e.g. smoke, regression"
            className="bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 placeholder-surface-600"
          />
        </div>

        {error && <p className="text-[11px] text-red-400">{error}</p>}

        <div className="flex items-center gap-2">
          <button
            onClick={write}
            className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium transition-colors"
          >
            Write {ciFilePath(platform)}
          </button>
          {written && <span className="text-[11px] text-emerald-400">✓ Written</span>}
        </div>
      </div>

      {/* Preview */}
      <div className="flex-1 overflow-auto">
        <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-surface-600 font-semibold">Preview</p>
        <pre className="px-3 pb-3 text-[10px] font-mono text-surface-400 leading-relaxed whitespace-pre-wrap">{preview}</pre>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function GitPanel() {
  const [isRepo,  setIsRepo]  = useState<boolean | null>(null);
  const [status,  setStatus]  = useState<GitStatus | null>(null);
  const [tab,     setTab]     = useState<Tab>('changes');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const repo = await electron.gitIsRepo();
      setIsRepo(repo);
      if (repo) setStatus(await electron.gitStatus());
    } catch {
      setIsRepo(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-xs text-surface-500">Loading…</div>;
  }

  if (!isRepo) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-xs text-surface-400">Not a git repository.</p>
        <button
          onClick={async () => { await electron.gitInit(); refresh(); }}
          className="px-3 py-1.5 bg-surface-800 hover:bg-surface-700 rounded text-xs transition-colors"
        >git init</button>
      </div>
    );
  }

  const totalChanges = status
    ? status.staged.length + status.unstaged.length + status.untracked.length
    : 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex border-b border-surface-800 flex-shrink-0">
        {(['changes', 'log', 'branches', 'ci'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-[11px] capitalize transition-colors border-b-2 -mb-px ${
              tab === t ? 'border-blue-500 text-white' : 'border-transparent text-surface-400 hover:text-white'
            }`}
          >
            {t}
            {t === 'changes' && totalChanges > 0 && (
              <span className="ml-1 bg-surface-700 text-surface-300 rounded px-1 text-[9px]">{totalChanges}</span>
            )}
          </button>
        ))}
        <button
          onClick={refresh}
          title="Refresh"
          className="px-2 text-surface-600 hover:text-surface-300 transition-colors border-b-2 border-transparent -mb-px"
        >↺</button>
      </div>

      {tab === 'changes'  && status && <ChangesTab status={status} onRefresh={refresh} />}
      {tab === 'log'      && <LogTab />}
      {tab === 'branches' && <BranchesTab onRefresh={refresh} />}
      {tab === 'ci'       && <CiTab />}
    </div>
  );
}
