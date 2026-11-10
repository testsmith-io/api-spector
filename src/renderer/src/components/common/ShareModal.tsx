// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { useT } from '../../i18n';
import { lookupShare, restrictShare, revokeShare, type ShareResult } from '../../lib/cloud-push';

type Live = { token: string; url: string; deep_link: string; expires_at: string | null };

// Create / view / restrict / revoke a public share link for a collection or
// request. The cloud is the source of truth (looked up by the item's id), so
// the link is always recoverable here and no token is stored in the file.
export function ShareModal({
  title,
  type,
  sourceId,
  onCreate,
  onClose,
}: {
  readonly title: string
  readonly type: 'collection' | 'request' | 'folder'
  readonly sourceId: string
  /** Mint (or refresh) the link - wraps shareCollectionToCloud/shareRequestToCloud. */
  readonly onCreate: () => Promise<ShareResult>
  readonly onClose: () => void
}) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [expiryDays, setExpiryDays] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await lookupShare(type, sourceId);
        if (!cancelled && res.exists && res.token && res.url && res.deep_link) {
          setLive({ token: res.token, url: res.url, deep_link: res.deep_link, expires_at: res.expires_at ?? null });
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [type, sourceId]);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const create = () => run(async () => {
    const r = await onCreate();
    setLive({ token: r.token, url: r.url, deep_link: r.deep_link, expires_at: r.expires_at ?? null });
  });

  const applyExpiry = () => run(async () => {
    if (!live) return;
    const r = await restrictShare(live.token, expiryDays);
    setLive({ ...live, expires_at: r.expires_at ?? null });
  });

  const revoke = () => run(async () => {
    if (!live) return;
    await revokeShare(live.token);
    setLive(null);
  });

  const copy = async () => {
    if (!live) return;
    try { await navigator.clipboard.writeText(live.url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard may be blocked */ }
  };

  return (
    <Modal
      onClose={onClose}
      title={t('Share: :name', { name: title })}
      overlayClassName="bg-black/50 z-[300] flex items-center justify-center"
      panelClassName="bg-surface-900 border border-surface-700 rounded-lg shadow-2xl w-[32rem] max-w-[92vw] flex flex-col"
    >
      <div className="p-5 flex flex-col gap-4">
        {error && <p className="text-xs text-red-400 bg-red-900/30 border border-red-800/40 rounded px-2 py-1.5">{error}</p>}

        {loading ? (
          <p className="text-sm text-surface-400">{t('Checking share status…')}</p>
        ) : !live ? (
          <>
            <p className="text-sm text-surface-300 leading-relaxed">
              {type === 'request'
                ? t('Create a public read-only link to this request. Anyone with the link can view it or import it into their own app.')
                : type === 'folder'
                  ? t('Create a public read-only link to this folder. Anyone with the link can view its requests or import them into their own app.')
                  : t('Create a public read-only link to this collection. Anyone with the link can view it or import it into their own app.')}
            </p>
            <p className="text-xs text-surface-500">{t('Only request definitions with {{variables}} are shared. Secrets and environment values are never uploaded.')}</p>
            <div className="flex justify-end">
              <button onClick={create} disabled={busy}
                className="px-3 py-1.5 text-xs font-medium text-white bg-sky-700 hover:bg-sky-600 disabled:opacity-50 rounded transition-colors">
                {busy ? t('Creating…') : t('Create public link')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-surface-500">{t('Public link')}</label>
              <div className="mt-1 flex items-center gap-2">
                <input readOnly value={live.url} onClick={e => (e.target as HTMLInputElement).select()}
                  className="flex-1 rounded bg-surface-950 border border-surface-700 px-2 py-1.5 text-xs font-mono text-surface-200" />
                <button onClick={copy} className="px-3 py-1.5 text-xs border border-surface-700 rounded text-surface-300 hover:text-white transition-colors">
                  {copied ? t('Copied') : t('Copy')}
                </button>
              </div>
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-[11px] uppercase tracking-wide text-surface-500">{t('Restrict')}</label>
                <p className="text-xs text-surface-400 mt-1">
                  {live.expires_at
                    ? t('Expires :date', { date: new Date(live.expires_at).toLocaleString() })
                    : t('Never expires')}
                </p>
              </div>
              <select value={expiryDays} onChange={e => setExpiryDays(Number(e.target.value))}
                className="rounded bg-surface-950 border border-surface-700 px-2 py-1.5 text-xs text-surface-200">
                <option value={0}>{t('No expiry')}</option>
                <option value={1}>{t('1 day')}</option>
                <option value={7}>{t('7 days')}</option>
                <option value={30}>{t('30 days')}</option>
              </select>
              <button onClick={applyExpiry} disabled={busy}
                className="px-3 py-1.5 text-xs border border-surface-700 rounded text-surface-300 hover:text-white disabled:opacity-50 transition-colors">
                {t('Apply')}
              </button>
            </div>

            <p className="text-xs text-surface-500">{t('Only request definitions with {{variables}} are shared. Secrets and environment values are never uploaded.')}</p>

            <div className="flex justify-between items-center pt-2 border-t border-surface-800">
              <button onClick={revoke} disabled={busy}
                className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors">
                {t('Revoke link')}
              </button>
              <button onClick={onClose} className="px-3 py-1.5 text-xs text-surface-400 hover:text-white transition-colors">
                {t('Done')}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
