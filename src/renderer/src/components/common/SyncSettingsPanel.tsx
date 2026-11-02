// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useState } from 'react';
import { useT } from '../../i18n';
import { useWorkspaceLoader } from '../../hooks/useWorkspaceLoader';
import { cloudEnabled } from '../../lib/cloud-push';
import {
  type SyncMode, getSyncSettings, setSyncMode,
  pushWorkspace, pullWorkspace, markPulled, listCloudWorkspaces, linkToCloudWorkspace,
} from '../../lib/workspace-sync';

// The "Sync" settings section: choose how this workspace collaborates — Local,
// Git (the default, via the Git panel), or Cloud (push/pull through API Spector
// Cloud for teams without git). Cloud actions run immediately (not on Save).
export function SyncSettingsPanel() {
  const t = useT();
  const { applyWorkspace } = useWorkspaceLoader();
  const initial = getSyncSettings();
  const [mode, setMode] = useState<SyncMode>(initial.mode);
  const [linked, setLinked] = useState<boolean>(!!initial.cloudWorkspaceId);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const [remote, setRemote] = useState<{ id: number; name: string; version: number; updated_by_name: string | null }[] | null>(null);

  const cloudOn = cloudEnabled();

  async function changeMode(m: SyncMode) {
    setMode(m);
    setStatus(null);
    try { await setSyncMode(m); } catch (e) { setStatus({ msg: (e as Error).message, ok: false }); }
  }

  async function run(fn: () => Promise<string>) {
    setBusy(true); setStatus(null);
    try { setStatus({ msg: await fn(), ok: true }); }
    catch (e) { setStatus({ msg: (e as Error).message, ok: false }); }
    finally { setBusy(false); }
  }

  const doPush = () => run(async () => {
    const res = await pushWorkspace();
    if (!res.ok) throw new Error(t('Someone else pushed changes (cloud is at v:v). Pull first, then push again.', { v: res.currentVersion ?? '?' }));
    setLinked(true);
    return t('Pushed :c collection(s) and :f flow(s). Cloud is now at version :v.', { c: res.collections, f: res.flows, v: res.version });
  });

  const doPull = () => run(async () => {
    const r = await pullWorkspace();
    await applyWorkspace(r.workspace, r.workspacePath);   // load into the store FIRST
    await markPulled(r.version);                          // then persist the version
    return t('Pulled version :v: :files file(s), :c collection(s).', { v: r.version, files: r.filesWritten, c: r.collections });
  });

  const loadRemote = () => run(async () => {
    const list = await listCloudWorkspaces();
    setRemote(list);
    return t(':n cloud workspace(s) in your organization.', { n: list.length });
  });

  const joinExisting = (id: number) => run(async () => {
    await linkToCloudWorkspace(id);
    const r = await pullWorkspace();
    await applyWorkspace(r.workspace, r.workspacePath);
    await markPulled(r.version);
    setLinked(true);
    return t('Linked and pulled: :files file(s), :c collection(s).', { files: r.filesWritten, c: r.collections });
  });

  const btn = 'px-3 py-1.5 text-xs rounded border border-surface-700 text-surface-200 hover:bg-surface-800 disabled:opacity-50 transition-colors';
  const btnPrimary = 'px-3 py-1.5 text-xs rounded font-medium text-white bg-sky-700 hover:bg-sky-600 disabled:opacity-50 transition-colors';

  return (
    <div className="flex flex-col gap-5 text-sm text-surface-200">
      <div>
        <h3 className="font-semibold text-[var(--text-primary)]">{t('Workspace sync')}</h3>
        <p className="text-xs text-surface-400 mt-1">{t('How this workspace is shared with your team. Git is the default; Cloud lets teams without git collaborate.')}</p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-surface-500">{t('Mode')}</span>
        <select value={mode} onChange={e => changeMode(e.target.value as SyncMode)}
          className="rounded bg-surface-950 border border-surface-700 px-2 py-1.5 text-sm w-56">
          <option value="git">{t('Git (default) — use the Git panel')}</option>
          <option value="cloud">{t('Cloud — sync through API Spector Cloud')}</option>
          <option value="local">{t('Local only — no sync')}</option>
        </select>
      </label>

      {mode === 'git' && (
        <p className="text-xs text-surface-400">{t('This workspace syncs via Git. Use the Git panel in the sidebar to commit, pull and push.')}</p>
      )}

      {mode === 'local' && (
        <p className="text-xs text-surface-400">{t('No syncing. Changes stay on this machine.')}</p>
      )}

      {mode === 'cloud' && !cloudOn && (
        <p className="text-xs text-amber-400">{t('Connect this workspace to API Spector Cloud first (the Cloud tab), then come back to sync.')}</p>
      )}

      {mode === 'cloud' && cloudOn && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-surface-500">{t('Collections, folders, requests, flows and environments sync. Secret values are never uploaded — each member keeps their own.')}</p>

          {linked ? (
            <div className="flex items-center gap-2">
              <button className={btnPrimary} disabled={busy} onClick={doPush}>{t('Push')}</button>
              <button className={btn} disabled={busy} onClick={doPull}>{t('Pull')}</button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <button className={btnPrimary} disabled={busy} onClick={doPush}>{t('Create cloud workspace (push)')}</button>
                <button className={btn} disabled={busy} onClick={loadRemote}>{t('Join an existing one')}</button>
              </div>
              {remote && (
                <div className="rounded border border-surface-700 divide-y divide-surface-800">
                  {remote.length === 0 && <div className="px-3 py-2 text-xs text-surface-500">{t('No cloud workspaces yet.')}</div>}
                  {remote.map(w => (
                    <div key={w.id} className="flex items-center gap-2 px-3 py-2">
                      <span className="flex-1 truncate">{w.name} <span className="text-surface-500">v{w.version}</span></span>
                      <button className={btn} disabled={busy} onClick={() => joinExisting(w.id)}>{t('Join & pull')}</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {status && (
        <p className={`text-xs ${status.ok ? 'text-emerald-400' : 'text-red-400'}`}>{status.msg}</p>
      )}
    </div>
  );
}
