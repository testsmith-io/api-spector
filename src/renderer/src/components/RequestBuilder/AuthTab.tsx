// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useState } from 'react';
import type { ApiRequest, AuthConfig } from '../../../../shared/types';
import { AuthEditor, type AuthEditorPatch } from '../common/AuthEditor';
import { useStore } from '../../store';
import { authIsConfigured, authTypeLabel, inheritedAuthWithSource } from '../../../../shared/request-collection';
import { useT } from '../../i18n';

const { electron } = window;

// Request-level auth. The full set of types (incl. OAuth 2.0) lives in the
// shared AuthEditor, so requests, folders and collections all offer the same
// options. This wrapper adds the keychain-backed secret inputs and shows what
// the request inherits from its folder / collection.
export function AuthTab({ request, onChange }: { readonly request: ApiRequest; readonly onChange: (p: Partial<ApiRequest>) => void }) {
  const t = useT();
  const auth = request.auth;
  const [secretValue, setSecretValue] = useState('');
  const [saved, setSaved] = useState(false);

  const collections = useStore(s => s.collections);
  const owning = Object.values(collections).find(c => request.id in c.data.requests)?.data;
  const inherited = owning ? inheritedAuthWithSource(request.id, owning) : null;
  const ownConfigured = authIsConfigured(request.auth);
  // Authorization Code / Implicit cannot be fetched by a plain send.
  const needsBrowser = inherited?.auth.type === 'oauth2'
    && (inherited.auth.oauth2Flow === 'authorization_code' || inherited.auth.oauth2Flow === 'implicit');

  function setAuth(patch: AuthEditorPatch) {
    onChange({ auth: { ...auth, ...patch } as AuthConfig });
  }

  async function saveSecret(ref: string) {
    if (!secretValue || !ref) return;
    await electron.setSecret(ref, secretValue);
    setSaved(true);
    setSecretValue('');
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex flex-col gap-3">
      <AuthEditor
        auth={auth}
        onChange={setAuth}
        secrets={{ secretValue, setSecretValue, saved, saveSecret }}
        className="text-xs"
      />

      {inherited && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-surface-500 font-medium mb-1.5">
            {t('Inherited auth')}
          </div>
          <div className={`flex items-center gap-2 text-xs rounded border px-2.5 py-2 ${ownConfigured
            ? 'border-surface-800 bg-surface-900/40 opacity-70'
            : 'border-emerald-500/25 bg-emerald-900/10'}`}>
            <span className="font-mono text-surface-300">{authTypeLabel(inherited.auth)}</span>
            <span
              className="text-[9px] uppercase tracking-wider text-sky-300/90 border border-sky-500/30 rounded px-1 py-px whitespace-nowrap"
              title={t('Defined on :source', { source: inherited.source })}
            >
              {t('from :source', { source: inherited.source })}
            </span>
            {ownConfigured && (
              <span className="ml-auto text-[10px] text-surface-500">{t('overridden by this request')}</span>
            )}
          </div>
          <p className="text-[10px] text-surface-600 mt-1.5">
            {ownConfigured
              ? t('This request defines its own auth, so the inherited one is not used. Set the type to None to inherit instead.')
              : t('Applied automatically when this request is sent, because its own auth is None. Choose a type above to override it.')}
          </p>
          {!ownConfigured && needsBrowser && (
            <p className="text-[10px] text-amber-300/80 mt-1">
              {t('This OAuth2 flow needs the one-time browser consent (open it from the Auth tab on the folder or collection) before a send can use the token.')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
