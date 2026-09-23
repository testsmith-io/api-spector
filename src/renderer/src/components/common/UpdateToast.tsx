// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react';
import { useT } from '../../i18n';

// Unobtrusive "a newer release is on npm" corner toast, shown at startup on any
// screen. Unlike the WelcomeScreen banner (which only shows while no workspace
// is open, and can flash by as the last workspace auto-loads), this stays put
// until dismissed. Best-effort: offline/timeout shows nothing. "Skip this
// version" is remembered so the same release never nags again; the close button
// ("Later") reappears next start.

const { electron } = window;
const DISMISS_KEY = 'apiSpectorUpdateSkipped';

interface UpdateInfo { current: string; latest: string; updateAvailable: boolean; command: string }

export function UpdateToast() {
  const t = useT();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    electron.checkForUpdate()
      .then((u: UpdateInfo | null) => {
        if (cancelled || !u?.updateAvailable) return;
        let skipped = '';
        try { skipped = localStorage.getItem(DISMISS_KEY) ?? ''; } catch { /* storage disabled */ }
        if (u.latest !== skipped) setInfo(u);
      })
      .catch(() => { /* offline / rate-limited — say nothing */ });
    return () => { cancelled = true; };
  }, []);

  if (!info) return null;

  const later = (): void => setInfo(null);
  const skip = (): void => {
    try { localStorage.setItem(DISMISS_KEY, info.latest); } catch { /* storage disabled */ }
    setInfo(null);
  };
  const copy = (): void => {
    navigator.clipboard.writeText(info.command)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => { /* clipboard blocked */ });
  };

  return (
    <div className="fixed bottom-4 right-4 z-[80] w-80 bg-surface-900 border border-surface-700 rounded-lg shadow-2xl overflow-hidden">
      <div className="flex items-start gap-2 px-3 pt-3">
        <span className="mt-1 w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white">{t('Update available')}</div>
          <p className="text-xs text-surface-300 mt-0.5">
            {t('API Spector :latest is available. You have :current.', { latest: info.latest, current: info.current })}
          </p>
        </div>
        <button onClick={later} title={t('Later')} className="text-surface-500 hover:text-surface-300 text-base leading-none px-0.5">×</button>
      </div>
      <div className="px-3 pt-2">
        <div className="text-[10px] uppercase tracking-wider text-surface-500 mb-1">{t('Update with')}</div>
        <div className="flex items-center gap-1">
          <code className="flex-1 text-[11px] font-mono text-blue-300 bg-surface-950 border border-surface-800 rounded px-2 py-1.5 select-all break-all">{info.command}</code>
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
