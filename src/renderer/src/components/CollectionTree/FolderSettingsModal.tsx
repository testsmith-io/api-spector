// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useState } from 'react';
import type { Folder, AuthConfig, KeyValuePair } from '../../../../shared/types';
import { useStore } from '../../store';
import { KVTable } from '../RequestBuilder/KVTable';
import { Modal } from '../common/Modal';
import { AuthEditor, type AuthEditorPatch } from '../common/AuthEditor';
import { useT } from '../../i18n';

// Config only (auth + headers inherited by the folder's requests). Documentation,
// data tables and variables live in the folder panel (click the folder), mirroring
// how a collection splits its panel (content) from its settings modal (config).
type ModalTab = 'auth' | 'headers'

interface Props {
  readonly collectionId: string
  readonly folder: Folder
  readonly onClose: () => void
}

export function FolderSettingsModal({ collectionId, folder, onClose }: Props) {
  const t = useT();
  const updateFolder = useStore(s => s.updateFolder);

  const [activeTab, setActiveTab] = useState<ModalTab>('auth');
  const [auth, setAuth]           = useState<AuthConfig>(folder.auth ?? { type: 'none' });
  const [headers, setHeaders]     = useState<KeyValuePair[]>(folder.headers ?? []);

  function patchAuth(patch: AuthEditorPatch) {
    setAuth(prev => ({ ...prev, ...patch } as AuthConfig));
  }

  function save() {
    updateFolder(collectionId, folder.id, { auth, headers });
    onClose();
  }

  return (
    <Modal
      onClose={onClose}
      overlayClassName="bg-black/50 z-50 flex items-start justify-center pt-16"
      panelClassName="w-[600px] bg-surface-900 border border-surface-800 rounded-lg shadow-2xl flex flex-col max-h-[80vh]"
    >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-800 shrink-0">
          <div>
            <h2 className="text-sm font-semibold">{t('Folder settings')}</h2>
            <p className="text-[10px] text-surface-600 mt-0.5">{t(':name - auth and headers inherited by all requests in this folder', { name: folder.name })}</p>
          </div>
          <button onClick={onClose} className="text-surface-400 hover:text-white text-lg leading-none">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-800 px-4 shrink-0">
          {(['auth', 'headers'] as ModalTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px capitalize ${
                activeTab === tab
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-surface-400 hover:text-white'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-4 py-3 flex-1 overflow-y-auto text-xs">
          {activeTab === 'auth' && (
            <AuthEditor
              auth={auth}
              onChange={patchAuth}
              intro={
                <p className="text-[10px] text-surface-600">
                  {t('Auth configured here is inherited by all requests in this folder unless the request overrides it with its own non-none auth type.')}
                </p>
              }
            />
          )}
          {activeTab === 'headers' && (
            <KVTable
              rows={headers}
              onChange={setHeaders}
              keyPlaceholder={t('Header-Name')}
              valuePlaceholder={t('value')}
              headerMode
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-4 py-3 border-t border-surface-800 shrink-0">
          <button
            onClick={save}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium transition-colors"
          >
            {t('Save')}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-surface-800 hover:bg-surface-700 rounded text-xs transition-colors"
          >
            {t('Cancel')}
          </button>
        </div>
    </Modal>
  );
}
