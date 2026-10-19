// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// OAuth 2.0 configuration + interactive token flow (Get token / Refresh /
// Clear), self-contained so it can be used at every level: the request AuthTab,
// and the folder/collection settings modals (via AuthEditor). The fetched token
// is cached on the auth object (oauth2CachedToken), which inheritance passes
// down to requests, and the send path uses it regardless of where it was set.

import React, { useState } from 'react';
import type { Oauth2Auth } from '../../../../shared/types';
import type { AuthEditorPatch } from './AuthEditor';
import { VarInput } from './VarInput';
import { useT } from '../../i18n';

const { electron } = window;

export function Oauth2Form({ auth, onChange }: {
  readonly auth: Oauth2Auth
  readonly onChange: (p: AuthEditorPatch) => void
}) {
  const t = useT();
  const [secretValue, setSecretValue] = useState('');
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState<'idle' | 'fetching' | 'ok' | 'error'>('idle');
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [keychainOpen, setKeychainOpen] = useState(!!auth.oauth2ClientSecretRef);

  const flow = auth.oauth2Flow ?? 'client_credentials';

  async function saveSecret(ref: string) {
    if (!secretValue || !ref) return;
    await electron.setSecret(ref, secretValue);
    setSaved(true);
    setSecretValue('');
    setTimeout(() => setSaved(false), 2000);
  }

  async function fetchToken() {
    setStatus('fetching'); setError('');
    try {
      const result = await electron.oauth2StartFlow(auth, {});
      onChange({ oauth2CachedToken: result.accessToken, oauth2TokenExpiry: result.expiresAt });
      if (result.refreshToken) setRefreshToken(result.refreshToken);
      setStatus('ok');
    } catch (e) {
      setStatus('error'); setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function refresh() {
    if (!refreshToken) return;
    setStatus('fetching'); setError('');
    try {
      const result = await electron.oauth2RefreshToken(auth, {}, refreshToken);
      onChange({ oauth2CachedToken: result.accessToken, oauth2TokenExpiry: result.expiresAt });
      if (result.refreshToken) setRefreshToken(result.refreshToken);
      setStatus('ok');
    } catch (e) {
      setStatus('error'); setError(e instanceof Error ? e.message : String(e));
    }
  }

  function clearToken() {
    onChange({ oauth2CachedToken: undefined, oauth2TokenExpiry: undefined });
    setRefreshToken(''); setStatus('idle'); setError('');
  }

  const tokenPreview = (() => {
    const tok = auth.oauth2CachedToken;
    if (!tok) return null;
    const preview = tok.length > 16 ? `${tok.slice(0, 6)}…${tok.slice(-6)}` : tok;
    const expiry = auth.oauth2TokenExpiry;
    let expiryLabel = '';
    if (expiry) {
      const secsLeft = Math.round((expiry - Date.now()) / 1000);
      expiryLabel = secsLeft > 0 ? t(' (expires in :secs)', { secs: `${secsLeft}s` }) : t(' (EXPIRED)');
    }
    return `${preview}${expiryLabel}`;
  })();

  return (
    <div className="flex flex-col gap-2">
      <div>
        <label className="text-surface-400">{t('Flow')}</label>
        <select
          value={flow}
          onChange={e => onChange({ oauth2Flow: e.target.value as Oauth2Auth['oauth2Flow'] })}
          className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
        >
          <option value="client_credentials">{t('Client Credentials')}</option>
          <option value="authorization_code">{t('Authorization Code')}</option>
          <option value="password">{t('Resource Owner Password')}</option>
          <option value="implicit">{t('Implicit (browser only)')}</option>
        </select>
      </div>

      {flow !== 'implicit' && (
        <div>
          <label className="text-surface-400">{t('Token URL')}</label>
          <input
            value={auth.oauth2TokenUrl ?? ''}
            onChange={e => onChange({ oauth2TokenUrl: e.target.value })}
            placeholder="https://auth.example.com/oauth/token"
            className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
          />
        </div>
      )}

      {(flow === 'authorization_code' || flow === 'implicit') && (
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-surface-400">{t('Auth URL')}</label>
            <input
              value={auth.oauth2AuthUrl ?? ''}
              onChange={e => onChange({ oauth2AuthUrl: e.target.value })}
              placeholder="https://auth.example.com/oauth/authorize"
              className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>
          <div className="w-28">
            <label className="text-surface-400">{t('Redirect Port')}</label>
            <input
              type="number"
              value={auth.oauth2RedirectPort ?? 9876}
              onChange={e => onChange({ oauth2RedirectPort: Number.parseInt(e.target.value, 10) || 9876 })}
              className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-surface-400">{t('Client ID')}</label>
          <input
            value={auth.oauth2ClientId ?? ''}
            onChange={e => onChange({ oauth2ClientId: e.target.value })}
            className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
          />
        </div>
        {flow !== 'implicit' && (
          <div className="flex-1">
            <label className="text-surface-400">
              {t('Client Secret')}{' '}
              <span className="text-surface-500 text-[10px]">{t('- supports :variables', { variables: '{{variables}}' })}</span>
            </label>
            <VarInput
              value={auth.oauth2ClientSecret ?? ''}
              onChange={v => onChange({ oauth2ClientSecret: v })}
              placeholder={auth.oauth2ClientSecretRef ? t('Using keychain ":ref"', { ref: auth.oauth2ClientSecretRef }) : t('Client secret')}
              className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>
        )}
      </div>

      {/* Optional: store the client secret in the OS keychain instead of inline */}
      {flow !== 'implicit' && (
        <div>
          <button
            onClick={() => setKeychainOpen(o => !o)}
            className="text-[10px] text-surface-500 hover:text-surface-300 text-left transition-colors w-fit"
          >
            <span className="text-[18px] leading-none">{keychainOpen ? '▾' : '▸'}</span> {t('Store client secret in OS keychain instead')}
          </button>
          {keychainOpen && (
            <div className="flex flex-col gap-1 pl-3 border-l border-surface-800 mt-1">
              <p className="text-surface-500 text-[10px]">
                {t('Encrypt the client secret in your OS keychain rather than saving it with the request. Leave the Client Secret field above empty to use the keychain value.')}
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={secretValue}
                  onChange={e => setSecretValue(e.target.value)}
                  placeholder={auth.oauth2ClientSecretRef ? t('Stored as ":ref"', { ref: auth.oauth2ClientSecretRef }) : t('Client secret')}
                  className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
                />
                <input
                  value={auth.oauth2ClientSecretRef ?? 'OAUTH2_CLIENT_SECRET'}
                  onChange={e => onChange({ oauth2ClientSecretRef: e.target.value })}
                  placeholder={t('Keychain ref')}
                  className="w-40 bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={() => { const ref = auth.oauth2ClientSecretRef ?? 'OAUTH2_CLIENT_SECRET'; onChange({ oauth2ClientSecretRef: ref }); void saveSecret(ref); }}
                  className="px-2 py-1 bg-blue-700 hover:bg-blue-600 rounded transition-colors"
                >
                  {saved ? '✓' : t('Save')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {flow === 'password' && (
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-surface-400">{t('Username')}</label>
            <input
              value={auth.username ?? ''}
              onChange={e => onChange({ username: e.target.value })}
              className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex-1">
            <label className="text-surface-400">{t('Password')}</label>
            <input
              type="password"
              value={auth.password ?? ''}
              onChange={e => onChange({ password: e.target.value })}
              className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>
        </div>
      )}

      <div>
        <label className="text-surface-400">{t('Scopes')} <span className="text-surface-600">{t('(space-separated)')}</span></label>
        <input
          value={auth.oauth2Scopes ?? ''}
          onChange={e => onChange({ oauth2Scopes: e.target.value })}
          placeholder={t('read write')}
          className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={fetchToken}
          disabled={status === 'fetching'}
          className="px-3 py-1 bg-blue-700 hover:bg-blue-600 disabled:bg-surface-700 disabled:text-surface-500 rounded transition-colors"
        >
          {status === 'fetching' ? t('Getting token…') : t('Get Token')}
        </button>
        {refreshToken && (
          <button onClick={refresh} disabled={status === 'fetching'} className="px-3 py-1 bg-surface-700 hover:bg-surface-600 rounded transition-colors">
            {t('Refresh')}
          </button>
        )}
        {auth.oauth2CachedToken && (
          <button onClick={clearToken} className="px-3 py-1 bg-surface-700 hover:bg-red-800 rounded transition-colors">
            {t('Clear')}
          </button>
        )}
      </div>

      {tokenPreview && (
        <p className="text-emerald-400 text-[10px] font-mono bg-surface-800 rounded px-2 py-1">{t('Token:')} {tokenPreview}</p>
      )}
      {status === 'error' && (
        <p className="text-red-400 text-[10px] bg-red-950 border border-red-800 rounded px-2 py-1">{error}</p>
      )}
    </div>
  );
}
