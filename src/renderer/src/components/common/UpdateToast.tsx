// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { STORAGE_KEYS } from '../../lib/storage-keys';
import { useCopyFeedback } from '../../hooks/useCopyFeedback';

// Unobtrusive "a newer release is available" corner toast, shown at startup.
//
// Two modes, decided by how the app is running:
//  • 'auto'  — packaged desktop app. electron-updater downloads the signed
//    installer in-app (no browser, no admin) with a progress bar, then offers
//    "Restart to update". If the download fails, a dismissible error with a
//    manual-download link is shown (never a stuck "Downloading…").
//  • 'npm'   — run from the npm package. The app can't self-update, so we show
//    the "npm update -g" command to copy.
//
// Best-effort: an update *check* that fails (offline/blocked) stays silent.

const { electron } = window;
const DISMISS_KEY = STORAGE_KEYS.updateSkipped;
const RELEASES_URL = 'https://github.com/testsmith-io/api-spector/releases/latest';

interface NpmUpdate { current: string; latest: string; updateAvailable: boolean; command: string }
type Phase = 'idle' | 'downloading' | 'ready' | 'error';

const shellCls = 'fixed bottom-4 right-4 z-[80] w-80 bg-surface-900 border border-surface-700 rounded-lg shadow-2xl overflow-hidden';

export function UpdateToast() {
  const t = useT();
  const [npm, setNpm] = useState<NpmUpdate | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [version, setVersion] = useState('');
  const [percent, setPercent] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const { copied, copy: doCopy } = useCopyFeedback(1500);

  useEffect(() => {
    let cancelled = false;
    electron.getUpdateMode().then(mode => {
      if (cancelled) return;
      if (mode === 'auto') {
        electron.onUpdateAvailable(({ version }) => {
          if (cancelled) return;
          setVersion(version); setPercent(0); setPhase('downloading');
        });
        electron.onUpdateProgress(({ percent }) => {
          if (!cancelled) setPercent(Math.max(0, Math.min(100, Math.round(percent))));
        });
        electron.onUpdateDownloaded(({ version }) => {
          if (cancelled) return;
          setVersion(version); setPhase('ready');
        });
        electron.onUpdateError(({ message }) => {
          if (cancelled) return;
          console.error('Auto-update error:', message);
          setErrorMsg(message);
          // Only surface as an error if a download was actually in progress; a
          // failed *check* (offline/blocked) shouldn't nag, and don't clobber a
          // ready-to-install state.
          setPhase(prev => (prev === 'downloading' ? 'error' : prev));
        });
        return;
      }
      // npm: registry check + copyable command.
      electron.checkForUpdate()
        .then((u) => {
          if (cancelled || !u?.updateAvailable) return;
          let skipped = '';
          try { skipped = localStorage.getItem(DISMISS_KEY) ?? ''; } catch { /* storage disabled */ }
          if (u.latest !== skipped) setNpm(u);
        })
        .catch(() => { /* offline / rate-limited — say nothing */ });
    }).catch(() => { /* no update mode — say nothing */ });
    return () => { cancelled = true; };
  }, []);

  // ── Packaged: downloading, with progress bar ──────────────────────────────
  if (phase === 'downloading') {
    return (
      <div className={shellCls}>
        <div className="flex items-center gap-2 px-3 pt-3">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
          <p className="text-xs text-surface-300 flex-1 min-w-0">
            {t('Downloading API Spector :latest…', { latest: version })}
          </p>
          <span className="text-[11px] font-mono text-surface-400 tabular-nums">{percent}%</span>
        </div>
        <div className="px-3 pt-2 pb-3">
          <div className="h-1.5 w-full rounded-full bg-surface-800 overflow-hidden">
            <div className="h-full bg-blue-500 transition-[width] duration-300 ease-out" style={{ width: `${percent}%` }} />
          </div>
        </div>
      </div>
    );
  }

  // ── Packaged: downloaded, ready to install ────────────────────────────────
  if (phase === 'ready') {
    return (
      <div className={shellCls}>
        <div className="flex items-start gap-2 px-3 pt-3">
          <span className="mt-1 w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white">{t('Update ready')}</div>
            <p className="text-xs text-surface-300 mt-0.5">
              {t('API Spector :latest has been downloaded. Restart to install it.', { latest: version })}
            </p>
          </div>
          <button onClick={() => setPhase('idle')} title={t('Later')} className="text-surface-500 hover:text-surface-300 text-base leading-none px-0.5">×</button>
        </div>
        <div className="flex justify-end gap-2 px-3 py-2.5">
          <button onClick={() => setPhase('idle')} className="px-2.5 py-1 text-[11px] rounded text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors">
            {t('Later')}
          </button>
          <button onClick={() => { void electron.installUpdate(); }} className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors">
            {t('Restart to update')}
          </button>
        </div>
      </div>
    );
  }

  // ── Packaged: download failed — show why + a manual fallback ──────────────
  if (phase === 'error') {
    return (
      <div className={shellCls}>
        <div className="flex items-start gap-2 px-3 pt-3">
          <span className="mt-1 w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white">{t('Update failed')}</div>
            <p className="text-xs text-surface-300 mt-0.5">
              {t("The update couldn't be downloaded. You can download it manually instead.")}
            </p>
            {errorMsg && <p className="text-[10px] font-mono text-surface-500 mt-1 break-all line-clamp-3">{errorMsg}</p>}
          </div>
          <button onClick={() => setPhase('idle')} title={t('Later')} className="text-surface-500 hover:text-surface-300 text-base leading-none px-0.5">×</button>
        </div>
        <div className="flex justify-end gap-2 px-3 py-2.5">
          <button onClick={() => setPhase('idle')} className="px-2.5 py-1 text-[11px] rounded text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors">
            {t('Dismiss')}
          </button>
          <button onClick={() => { void electron.openExternal(RELEASES_URL); }} className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors">
            {t('Download manually')}
          </button>
        </div>
      </div>
    );
  }

  // ── npm: copyable update command ──────────────────────────────────────────
  if (!npm) return null;

  const later = (): void => setNpm(null);
  const skip = (): void => {
    try { localStorage.setItem(DISMISS_KEY, npm.latest); } catch { /* storage disabled */ }
    setNpm(null);
  };
  const copy = (): void => { void doCopy(npm.command); };

  return (
    <div className={shellCls}>
      <div className="flex items-start gap-2 px-3 pt-3">
        <span className="mt-1 w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white">{t('Update available')}</div>
          <p className="text-xs text-surface-300 mt-0.5">
            {t('API Spector :latest is available. You have :current.', { latest: npm.latest, current: npm.current })}
          </p>
        </div>
        <button onClick={later} title={t('Later')} className="text-surface-500 hover:text-surface-300 text-base leading-none px-0.5">×</button>
      </div>
      <div className="px-3 pt-2">
        <div className="text-[10px] uppercase tracking-wider text-surface-500 mb-1">{t('Update with')}</div>
        <div className="flex items-center gap-1">
          <code className="flex-1 text-[11px] font-mono text-blue-300 bg-surface-950 border border-surface-800 rounded px-2 py-1.5 select-all break-all">{npm.command}</code>
          <button onClick={copy} className="px-2 py-1.5 text-xs rounded bg-surface-700 hover:bg-surface-600 transition-colors">
            {copied ? t('Copied') : t('Copy')}
          </button>
        </div>
      </div>
      <div className="flex justify-end px-3 py-2">
        <button onClick={skip} className="px-2.5 py-1 text-[11px] rounded text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors">
          {t('Skip this version')}
        </button>
      </div>
    </div>
  );
}
