// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useState } from 'react';
import type { ApiRequest, AuthConfig, Oauth2Auth } from '../../../../shared/types';
import { AuthEditor, type AuthEditorPatch } from '../common/AuthEditor';

const { electron } = window;

type AuthType = AuthConfig['type']

const AUTH_TYPES: AuthType[] = ['none', 'bearer', 'basic', 'digest', 'ntlm', 'apikey', 'oauth2'];

export function AuthTab({ request, onChange }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void }) {
  const auth = request.auth;
  const [secretValue, setSecretValue]       = useState('');
  const [saved, setSaved]                   = useState(false);
  const [oauth2Status, setOauth2Status]     = useState<'idle' | 'fetching' | 'ok' | 'error'>('idle');
  const [oauth2Error, setOauth2Error]       = useState<string>('');
  const [oauth2RefreshToken, setOauth2RT]   = useState<string>('');

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

  // ── OAuth 2.0 token fetch ──────────────────────────────────────────────────

  async function fetchOAuth2Token() {
    if (auth.type !== 'oauth2') return;
    const oauth2Auth: Oauth2Auth = auth;
    setOauth2Status('fetching');
    setOauth2Error('');
    try {
      const vars: Record<string, string> = {};
      const result = await electron.oauth2StartFlow(oauth2Auth, vars);
      setAuth({
        oauth2CachedToken: result.accessToken,
        oauth2TokenExpiry: result.expiresAt,
      });
      if (result.refreshToken) setOauth2RT(result.refreshToken);
      setOauth2Status('ok');
    } catch (e: unknown) {
      setOauth2Status('error');
      setOauth2Error(e instanceof Error ? e.message : String(e));
    }
  }

  async function refreshOAuth2Token() {
    if (auth.type !== 'oauth2' || !oauth2RefreshToken) return;
    const oauth2Auth: Oauth2Auth = auth;
    setOauth2Status('fetching');
    setOauth2Error('');
    try {
      const result = await electron.oauth2RefreshToken(oauth2Auth, {}, oauth2RefreshToken);
      setAuth({
        oauth2CachedToken: result.accessToken,
        oauth2TokenExpiry: result.expiresAt,
      });
      if (result.refreshToken) setOauth2RT(result.refreshToken);
      setOauth2Status('ok');
    } catch (e: unknown) {
      setOauth2Status('error');
      setOauth2Error(e instanceof Error ? e.message : String(e));
    }
  }

  function clearOAuth2Token() {
    setAuth({ oauth2CachedToken: undefined, oauth2TokenExpiry: undefined });
    setOauth2RT('');
    setOauth2Status('idle');
    setOauth2Error('');
  }

  const tokenPreview = (() => {
    if (auth.type !== 'oauth2') return null;
    const t = auth.oauth2CachedToken;
    if (!t) return null;
    const preview = t.length > 16 ? `${t.slice(0, 6)}…${t.slice(-6)}` : t;
    const expiry  = auth.oauth2TokenExpiry;
    let expiryLabel = '';
    if (expiry) {
      const secsLeft = Math.round((expiry - Date.now()) / 1000);
      expiryLabel = secsLeft > 0 ? ` (expires in ${secsLeft}s)` : ' (EXPIRED)';
    }
    return `${preview}${expiryLabel}`;
  })();

  return (
    <AuthEditor
      auth={auth}
      onChange={setAuth}
      types={AUTH_TYPES}
      secrets={{ secretValue, setSecretValue, saved, saveSecret }}
      className="text-xs"
    >
      {/* ── OAuth 2.0 ── */}
      {auth.type === 'oauth2' && (
        <div className="flex flex-col gap-2">
          {/* Flow selector */}
          <div>
            <label className="text-surface-400">Flow</label>
            <select
              value={auth.oauth2Flow ?? 'client_credentials'}
              onChange={e => setAuth({ oauth2Flow: e.target.value as Oauth2Auth['oauth2Flow'] })}
              className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
            >
              <option value="client_credentials">Client Credentials</option>
              <option value="authorization_code">Authorization Code</option>
              <option value="password">Resource Owner Password</option>
              <option value="implicit">Implicit (browser only)</option>
            </select>
          </div>

          {/* Token URL */}
          <div>
            <label className="text-surface-400">Token URL</label>
            <input
              value={auth.oauth2TokenUrl ?? ''}
              onChange={e => setAuth({ oauth2TokenUrl: e.target.value })}
              placeholder="https://auth.example.com/oauth/token"
              className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>

          {/* Auth URL — only for authorization_code */}
          {auth.oauth2Flow === 'authorization_code' && (
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-surface-400">Auth URL</label>
                <input
                  value={auth.oauth2AuthUrl ?? ''}
                  onChange={e => setAuth({ oauth2AuthUrl: e.target.value })}
                  placeholder="https://auth.example.com/oauth/authorize"
                  className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
              <div className="w-28">
                <label className="text-surface-400">Redirect Port</label>
                <input
                  type="number"
                  value={auth.oauth2RedirectPort ?? 9876}
                  onChange={e => setAuth({ oauth2RedirectPort: parseInt(e.target.value, 10) || 9876 })}
                  className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}

          {/* Client ID + Secret */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-surface-400">Client ID</label>
              <input
                value={auth.oauth2ClientId ?? ''}
                onChange={e => setAuth({ oauth2ClientId: e.target.value })}
                className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex-1">
              <label className="text-surface-400">Client Secret</label>
              <div className="flex gap-1 mt-1">
                <input
                  type="password"
                  value={secretValue}
                  onChange={e => setSecretValue(e.target.value)}
                  placeholder={auth.oauth2ClientSecretRef ? `Stored as "${auth.oauth2ClientSecretRef}"` : 'Client secret'}
                  className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
                />
                <button
                  onClick={() => { const ref = auth.oauth2ClientSecretRef ?? 'OAUTH2_CLIENT_SECRET'; setAuth({ oauth2ClientSecretRef: ref }); void saveSecret(ref); }}
                  className="px-2 py-1 bg-blue-700 hover:bg-blue-600 rounded transition-colors"
                >
                  {saved ? '✓' : 'Save'}
                </button>
              </div>
              <input
                value={auth.oauth2ClientSecretRef ?? 'OAUTH2_CLIENT_SECRET'}
                onChange={e => setAuth({ oauth2ClientSecretRef: e.target.value })}
                placeholder="Keychain ref"
                className="mt-1 w-full bg-transparent border-b border-surface-700 focus:outline-none focus:border-blue-500 text-[10px] text-surface-600"
              />
            </div>
          </div>

          {/* Username + Password — for password flow */}
          {auth.oauth2Flow === 'password' && (
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-surface-400">Username</label>
                <input
                  value={auth.username ?? ''}
                  onChange={e => setAuth({ username: e.target.value })}
                  className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex-1">
                <label className="text-surface-400">Password</label>
                <input
                  type="password"
                  value={auth.password ?? ''}
                  onChange={e => setAuth({ password: e.target.value })}
                  className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
            </div>
          )}

          {/* Scopes */}
          <div>
            <label className="text-surface-400">Scopes <span className="text-surface-600">(space-separated)</span></label>
            <input
              value={auth.oauth2Scopes ?? ''}
              onChange={e => setAuth({ oauth2Scopes: e.target.value })}
              placeholder="read write"
              className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Token actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={fetchOAuth2Token}
              disabled={oauth2Status === 'fetching'}
              className="px-3 py-1 bg-blue-700 hover:bg-blue-600 disabled:bg-surface-700 disabled:text-surface-500 rounded transition-colors"
            >
              {oauth2Status === 'fetching' ? 'Getting token…' : 'Get Token'}
            </button>
            {oauth2RefreshToken && (
              <button
                onClick={refreshOAuth2Token}
                disabled={oauth2Status === 'fetching'}
                className="px-3 py-1 bg-surface-700 hover:bg-surface-600 rounded transition-colors"
              >
                Refresh
              </button>
            )}
            {auth.oauth2CachedToken && (
              <button
                onClick={clearOAuth2Token}
                className="px-3 py-1 bg-surface-700 hover:bg-red-800 rounded transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {/* Token preview */}
          {tokenPreview && (
            <p className="text-emerald-400 text-[10px] font-mono bg-surface-800 rounded px-2 py-1">
              Token: {tokenPreview}
            </p>
          )}
          {oauth2Status === 'error' && (
            <p className="text-red-400 text-[10px] bg-red-950 border border-red-800 rounded px-2 py-1">
              {oauth2Error}
            </p>
          )}
        </div>
      )}
    </AuthEditor>
  );
}
