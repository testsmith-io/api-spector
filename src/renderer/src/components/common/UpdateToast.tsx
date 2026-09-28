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
//    installer in-app (no browser, no admin); we show "Restart to update",
//    which applies it. This is what works on locked-down machines.
//  • 'npm'   — run from the npm package. The app can't self-update, so we show
//    the "npm update -g" command to copy (as before).
//
// Best-effort throughout: offline / blocked network simply shows nothing.

const { electron } = window;
const DISMISS_KEY = STORAGE_KEYS.updateSkipped;

interface NpmUpdate { current: string; latest: string; updateAvailable: boolean; command: string }

export function UpdateToast() {
  const t = useT();
  const [npm, setNpm] = useState<NpmUpdate | null>(null);
  const [ready, setReady] = useState<string | null>(null);   // auto: downloaded version, ready to install
  const [downloading, setDownloading] = useState<string | null>(null); // auto: update-available version
  const { copied, copy: doCopy } = useCopyFeedback(1500);

  useEffect(() => {
    let cancelled = false;
    electron.getUpdateMode().then(mode => {
      if (cancelled) return;
      if (mode === 'auto') {
        // Packaged: electron-updater already kicked off a check at launch.
        electron.onUpdateAvailable(({ version }) => { if (!cancelled) setDownloading(version); });
        electron.onUpdateDownloaded(({ version }) => { if (!cancelled) { setDownloading(null); setReady(version); } });
        // Errors are silent — a failed/blocked update check shouldn't nag.
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

  // ── Packaged: update downloaded and ready to install ──────────────────────
  if (ready) {
    return (
      <div className="fixed bottom-4 right-4 z-[80] w-80 bg-surface-900 border border-surface-700 rounded-lg shadow-2xl overflow-hidden">
        <div className="flex items-start gap-2 px-3 pt-3">
          <span className="mt-1 w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white">{t('Update ready')}</div>
            <p className="text-xs text-surface-300 mt-0.5">
              {t('API Spector :latest has been downloaded. Restart to install it.', { latest: ready })}
            </p>
          </div>
          <button onClick={() => setReady(null)} title={t('Later')} className="text-surface-500 hover:text-surface-300 text-base leading-none px-0.5">×</button>
        </div>
        <div className="flex justify-end gap-2 px-3 py-2.5">
          <button onClick={() => setReady(null)} className="px-2.5 py-1 text-[11px] rounded text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors">
            {t('Later')}
          </button>
          <button onClick={() => { void electron.installUpdate(); }} className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors">
            {t('Restart to update')}
          </button>
        </div>
      </div>
    );
  }

  // ── Packaged: update is downloading in the background ─────────────────────
  if (downloading) {
    return (
      <div className="fixed bottom-4 right-4 z-[80] w-80 bg-surface-900 border border-surface-700 rounded-lg shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-3">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
          <p className="text-xs text-surface-300 flex-1 min-w-0">
            {t('Downloading API Spector :latest…', { latest: downloading })}
          </p>
          <button onClick={() => setDownloading(null)} title={t('Later')} className="text-surface-500 hover:text-surface-300 text-base leading-none px-0.5">×</button>
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
    <div className="fixed bottom-4 right-4 z-[80] w-80 bg-surface-900 border border-surface-700 rounded-lg shadow-2xl overflow-hidden">
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
