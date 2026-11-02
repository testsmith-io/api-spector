// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { Modal } from './Modal';
import { useT } from '../../i18n';

// Shown when a cloud-only action (e.g. creating a public share link) is used in
// a workspace that has not connected to API Spector Cloud yet. Instead of hiding
// the action or throwing a raw error, we invite the user to set cloud up.
export function CloudRequiredModal({
  action,
  onConnect,
  onClose,
}: {
  /** A short phrase naming what needs cloud, e.g. "share this collection". */
  readonly action?: string
  readonly onConnect: () => void
  readonly onClose: () => void
}) {
  const t = useT();
  return (
    <Modal
      onClose={onClose}
      closeOnBackdrop
      overlayClassName="bg-black/50 z-[300] flex items-center justify-center"
      panelClassName="bg-surface-900 border border-surface-700 rounded-lg shadow-2xl p-5 w-96 flex flex-col gap-4"
    >
      <div className="flex items-center gap-3">
        <div className="shrink-0 w-10 h-10 rounded-full bg-sky-900/40 border border-sky-700/40 flex items-center justify-center text-sky-300" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">{t('Connect to API Spector Cloud')}</h2>
          <p className="text-xs text-surface-400 mt-0.5">{t('Sharing needs the cloud')}</p>
        </div>
      </div>

      <p className="text-sm text-surface-300 leading-relaxed">
        {action
          ? t('To :action you need to connect this workspace to API Spector Cloud, which hosts the public link.', { action })
          : t('Public share links are hosted in API Spector Cloud. Connect this workspace to the cloud to create one.')}
      </p>
      <p className="text-xs text-surface-500">
        {t('Only request definitions with {{variables}} are shared. Secrets and environment values are never uploaded.')}
      </p>

      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs text-surface-400 hover:text-white transition-colors"
        >
          {t('Not now')}
        </button>
        <button
          onClick={onConnect}
          className="px-3 py-1.5 text-xs font-medium text-white bg-sky-700 hover:bg-sky-600 rounded transition-colors"
        >
          {t('Open Cloud settings')}
        </button>
      </div>
    </Modal>
  );
}
