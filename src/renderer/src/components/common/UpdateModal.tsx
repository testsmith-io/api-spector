// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { useT } from '../../i18n';

// One-shot "a newer release is on npm" popup, shown at startup on any screen
// (the WelcomeScreen banner only appears when no workspace is open). The check
// is best-effort — offline/timeout shows nothing. "Skip this version" is
// remembered so the same release never nags again; "Later" reappears next start.

const { electron } = window;
const DISMISS_KEY = 'apiSpectorUpdateSkipped';

interface UpdateInfo { current: string; latest: string; updateAvailable: boolean; command: string }

export function UpdateModal() {
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
    <Modal
      onClose={later}
      title={t('Update available')}
      panelClassName="bg-surface-900 border border-surface-800 rounded-lg shadow-2xl flex flex-col w-[26rem]"
    >
      <div className="p-4 flex flex-col gap-3 text-sm">
        <p className="text-surface-200">
          {t('API Spector :latest is available. You have :current.', { latest: info.latest, current: info.current })}
        </p>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-surface-500 mb-1">{t('Update with')}</div>
          <div className="flex items-center gap-1">
            <code className="flex-1 text-[11px] font-mono text-blue-300 bg-black/40 border border-surface-800 rounded px-2 py-1.5 select-all break-all">{info.command}</code>
            <button onClick={copy} className="px-2 py-1.5 text-xs rounded bg-surface-700 hover:bg-surface-600 transition-colors">
              {copied ? t('Copied') : t('Copy')}
            </button>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={skip} className="px-3 py-1.5 text-xs rounded border border-surface-700 text-surface-300 hover:bg-surface-800 transition-colors">
            {t('Skip this version')}
          </button>
          <button onClick={later} className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors">
            {t('Later')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
