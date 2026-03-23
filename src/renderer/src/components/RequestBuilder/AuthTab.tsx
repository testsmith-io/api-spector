import React, { useState } from 'react';
import type { ApiRequest, AuthConfig } from '../../../../shared/types';

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

  function setAuth(patch: Partial<AuthConfig>) {
    onChange({ auth: { ...auth, ...patch } });
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
    setOauth2Status('fetching');
    setOauth2Error('');
    try {
      const vars: Record<string, string> = {};
      if (auth.oauth2Flow === 'authorization_code') {
        const result = await electron.oauth2StartFlow(auth, vars);
        setAuth({
          oauth2CachedToken: result.accessToken,
          oauth2TokenExpiry: result.expiresAt,
        });
        if (result.refreshToken) setOauth2RT(result.refreshToken);
      } else {
        // client_credentials / password — handled in main process
        const result = await electron.oauth2StartFlow(auth, vars); // triggers fetchOAuth2Token on main side via IPC
        setAuth({
          oauth2CachedToken: result.accessToken,
          oauth2TokenExpiry: result.expiresAt,
        });
        if (result.refreshToken) setOauth2RT(result.refreshToken);
      }
      setOauth2Status('ok');
    } catch (e: unknown) {
      setOauth2Status('error');
      setOauth2Error(e instanceof Error ? e.message : String(e));
    }
  }

  async function refreshOAuth2Token() {
    if (!oauth2RefreshToken) return;
    setOauth2Status('fetching');
    setOauth2Error('');
    try {
      const result = await electron.oauth2RefreshToken(auth, {}, oauth2RefreshToken);
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
    <div className="flex flex-col gap-3 text-xs">
      {/* Type selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-surface-400">Type:</span>
        {AUTH_TYPES.map(t => (
          <label key={t} className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              value={t}
              checked={auth.type === t}
              onChange={() => setAuth({ type: t })}
              className="accent-blue-500"
            />
            <span className={auth.type === t ? 'text-white' : 'text-surface-400'}>{t}</span>
          </label>
        ))}
      </div>

      {/* ── Bearer ── */}
      {auth.type === 'bearer' && (
        <div className="flex flex-col gap-1.5">
          <label className="text-surface-400">Token</label>
          <div className="flex gap-2">
            <input
              type="password"
              value={secretValue}
              onChange={e => setSecretValue(e.target.value)}
              placeholder={auth.tokenSecretRef ? `Keychain ref: "${auth.tokenSecretRef}"` : 'Paste token to store in keychain'}
              className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
            />
            <input
              value={auth.tokenSecretRef ?? 'API_TOKEN'}
              onChange={e => setAuth({ tokenSecretRef: e.target.value })}
              placeholder="Keychain key name"
              className="w-36 bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => saveSecret(auth.tokenSecretRef ?? 'API_TOKEN')}
              className="px-2 py-1 bg-blue-700 hover:bg-blue-600 rounded transition-colors"
            >
              {saved ? '✓' : 'Save'}
            </button>
          </div>
          <p className="text-surface-400 text-[10px]">
            Token is stored in your OS keychain — never written to disk.
          </p>
        </div>
      )}

      {/* ── Basic ── */}
      {auth.type === 'basic' && (
        <BasicCredentialsFields
          auth={auth}
          secretValue={secretValue}
          setSecretValue={setSecretValue}
          saved={saved}
          setAuth={setAuth}
          saveSecret={saveSecret}
          label="Basic Auth"
        />
      )}

      {/* ── Digest ── */}
      {auth.type === 'digest' && (
        <BasicCredentialsFields
          auth={auth}
          secretValue={secretValue}
          setSecretValue={setSecretValue}
          saved={saved}
          setAuth={setAuth}
          saveSecret={saveSecret}
          label="Digest Auth"
          note="Digest uses a two-round-trip MD5 challenge-response. Username/password sent with first request to negotiate the challenge."
        />
      )}

      {/* ── NTLM ── */}
      {auth.type === 'ntlm' && (
        <div className="flex flex-col gap-2">
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
              <div className="flex gap-1 mt-1">
                <input
                  type="password"
                  value={secretValue}
                  onChange={e => setSecretValue(e.target.value)}
                  placeholder={auth.passwordSecretRef ? `Stored as "${auth.passwordSecretRef}"` : 'Password'}
                  className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
                />
                <button
                  onClick={() => saveSecret(auth.passwordSecretRef ?? 'NTLM_PASSWORD')}
                  className="px-2 py-1 bg-blue-700 hover:bg-blue-600 rounded transition-colors"
                >
                  {saved ? '✓' : 'Save'}
                </button>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-surface-400">Domain <span className="text-surface-600">(optional)</span></label>
              <input
                value={auth.ntlmDomain ?? ''}
                onChange={e => setAuth({ ntlmDomain: e.target.value })}
                placeholder="WORKGROUP"
                className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex-1">
              <label className="text-surface-400">Workstation <span className="text-surface-600">(optional)</span></label>
              <input
                value={auth.ntlmWorkstation ?? ''}
                onChange={e => setAuth({ ntlmWorkstation: e.target.value })}
                placeholder="MACHINE"
                className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <p className="text-surface-400 text-[10px] bg-yellow-950 border border-yellow-800 rounded px-2 py-1">
            NTLM support is pending. Add <code>httpntlm</code> to dependencies to enable it.
          </p>
        </div>
      )}

      {/* ── API Key ── */}
      {auth.type === 'apikey' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <div>
              <label className="text-surface-400">Key name</label>
              <input
                value={auth.apiKeyName ?? 'X-API-Key'}
                onChange={e => setAuth({ apiKeyName: e.target.value })}
                className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-surface-400">In</label>
              <select
                value={auth.apiKeyIn ?? 'header'}
                onChange={e => setAuth({ apiKeyIn: e.target.value as 'header' | 'query' })}
                className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              >
                <option value="header">Header</option>
                <option value="query">Query</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="text-surface-400">Value</label>
              <div className="flex gap-1 mt-1">
                <input
                  type="password"
                  value={secretValue}
                  onChange={e => setSecretValue(e.target.value)}
                  placeholder={auth.apiKeySecretRef ? `Stored as "${auth.apiKeySecretRef}"` : 'API key value'}
                  className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
                />
                <button
                  onClick={() => saveSecret(auth.apiKeySecretRef ?? 'API_KEY')}
                  className="px-2 py-1 bg-blue-700 hover:bg-blue-600 rounded transition-colors"
                >
                  {saved ? '✓' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── OAuth 2.0 ── */}
      {auth.type === 'oauth2' && (
        <div className="flex flex-col gap-2">
          {/* Flow selector */}
          <div>
            <label className="text-surface-400">Flow</label>
            <select
              value={auth.oauth2Flow ?? 'client_credentials'}
              onChange={e => setAuth({ oauth2Flow: e.target.value as AuthConfig['oauth2Flow'] })}
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
                  onClick={() => saveSecret(auth.oauth2ClientSecretRef ?? 'OAUTH2_CLIENT_SECRET')}
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
    </div>
  );
}

// ─── Shared username/password sub-component ───────────────────────────────────

function BasicCredentialsFields({
  auth,
  secretValue,
  setSecretValue,
  saved,
  setAuth,
  saveSecret,
  label,
  note,
}: {
  auth: AuthConfig
  secretValue: string
  setSecretValue: (v: string) => void
  saved: boolean
  setAuth: (p: Partial<AuthConfig>) => void
  saveSecret: (ref: string) => Promise<void>
  label: string
  note?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="text-surface-500 text-[10px] uppercase tracking-wide">{label}</span>}
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
          <div className="flex gap-1 mt-1">
            <input
              type="password"
              value={secretValue}
              onChange={e => setSecretValue(e.target.value)}
              placeholder={auth.passwordSecretRef ? `Stored as "${auth.passwordSecretRef}"` : 'Password'}
              className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
            />
            <button
              onClick={() => saveSecret(auth.passwordSecretRef ?? 'API_PASSWORD')}
              className="px-2 py-1 bg-blue-700 hover:bg-blue-600 rounded transition-colors"
            >
              {saved ? '✓' : 'Save'}
            </button>
          </div>
        </div>
      </div>
      <p className="text-surface-400 text-[10px]">
        Password stored in OS keychain as{' '}
        <input
          value={auth.passwordSecretRef ?? 'API_PASSWORD'}
          onChange={e => setAuth({ passwordSecretRef: e.target.value })}
          className="inline bg-transparent border-b border-surface-700 focus:outline-none focus:border-blue-500 w-24"
        />
      </p>
      {note && (
        <p className="text-surface-600 text-[10px]">{note}</p>
      )}
    </div>
  );
}
