// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useState } from 'react';
import type {
  AuthConfig,
  BasicAuth,
  BearerAuth,
  ApiKeyAuth,
  DigestAuth,
  NtlmAuth,
  Oauth2Auth,
} from '../../../../shared/types';
import { VarInput } from './VarInput';

// ─── Shared auth field editor ─────────────────────────────────────────────────
//
// Renders the per-auth-type form (none/bearer/basic/digest/ntlm/apikey) shared
// by the request AuthTab and the folder/collection settings modals.
//
// Two flavours, chosen by the `secrets` prop:
//  - without `secrets` (folder/collection inheritance): plain inputs writing
//    straight into the auth config.
//  - with `secrets` (request AuthTab): keychain-backed secret inputs with a
//    Save button, VarInput bearer token, and NTLM/digest usage notes.
//
// OAuth 2.0 fields are not rendered here — the AuthTab owns that flow (token
// fetch state, electron calls) and renders it via `children`.

/** Flat patch shape covering every auth type's fields. Unlike `AuthPatch`
 *  (whose discriminant intersection collapses to `never`), this is a real
 *  object type, so `onChange({ token: v })` typechecks. Consumers still cast
 *  the merged result back to `AuthConfig`. */
export type AuthEditorPatch = Partial<
  Omit<BasicAuth, 'type'> &
  Omit<BearerAuth, 'type'> &
  Omit<ApiKeyAuth, 'type'> &
  Omit<DigestAuth, 'type'> &
  Omit<NtlmAuth, 'type'> &
  Omit<Oauth2Auth, 'type'>
> & { type?: AuthConfig['type'] }

export interface SecretFieldSupport {
  secretValue: string
  setSecretValue: (v: string) => void
  saved: boolean
  saveSecret: (ref: string) => Promise<void>
}

const DEFAULT_AUTH_TYPES: AuthConfig['type'][] = ['none', 'bearer', 'basic', 'digest', 'ntlm', 'apikey'];

interface AuthEditorProps {
  auth: AuthConfig
  onChange: (p: AuthEditorPatch) => void
  /** Auth types offered in the radio row. Defaults to all except oauth2. */
  types?: AuthConfig['type'][]
  /** Call-site chrome rendered above the type selector (inheritance hints etc.). */
  intro?: React.ReactNode
  /** Enables the keychain-backed secret inputs (request AuthTab flavour). */
  secrets?: SecretFieldSupport
  /** Extra classes on the root container. */
  className?: string
  /** Rendered after the per-type fields (e.g. the AuthTab's OAuth 2.0 panel). */
  children?: React.ReactNode
}

export function AuthEditor({
  auth,
  onChange,
  types = DEFAULT_AUTH_TYPES,
  intro,
  secrets,
  className = '',
  children,
}: AuthEditorProps) {
  return (
    <div className={`flex flex-col gap-3${className ? ` ${className}` : ''}`}>
      {intro}

      {/* Type selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-surface-400">Type:</span>
        {types.map(t => (
          <label key={t} className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              value={t}
              checked={auth.type === t}
              onChange={() => onChange({ type: t })}
              className="accent-blue-500"
            />
            <span className={auth.type === t ? 'text-white' : 'text-surface-400'}>{t}</span>
          </label>
        ))}
      </div>

      {/* ── Bearer ── */}
      {auth.type === 'bearer' && (
        secrets ? (
          <BearerPanel
            auth={auth}
            secretValue={secrets.secretValue}
            setSecretValue={secrets.setSecretValue}
            saved={secrets.saved}
            setAuth={onChange}
            saveSecret={secrets.saveSecret}
          />
        ) : (
          <div className="flex flex-col gap-1">
            <label className="text-surface-400">Token</label>
            <input
              value={auth.token ?? ''}
              onChange={e => onChange({ token: e.target.value })}
              placeholder="Bearer token"
              className="bg-surface-800 border border-surface-700 rounded px-2 py-1 font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
        )
      )}

      {/* ── Basic ── */}
      {auth.type === 'basic' && (
        secrets ? (
          <BasicCredentialsFields
            auth={auth}
            secretValue={secrets.secretValue}
            setSecretValue={secrets.setSecretValue}
            saved={secrets.saved}
            setAuth={onChange}
            saveSecret={secrets.saveSecret}
            label="Basic Auth"
          />
        ) : (
          <PlainCredentialsFields auth={auth} onChange={onChange} />
        )
      )}

      {/* ── Digest ── */}
      {auth.type === 'digest' && (
        secrets ? (
          <BasicCredentialsFields
            auth={auth}
            secretValue={secrets.secretValue}
            setSecretValue={secrets.setSecretValue}
            saved={secrets.saved}
            setAuth={onChange}
            saveSecret={secrets.saveSecret}
            label="Digest Auth"
            note="Digest uses a two-round-trip MD5 challenge-response. Username/password sent with first request to negotiate the challenge."
          />
        ) : (
          <PlainCredentialsFields auth={auth} onChange={onChange} />
        )
      )}

      {/* ── NTLM ── */}
      {auth.type === 'ntlm' && (
        secrets ? (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-surface-400">Username</label>
                <input
                  value={auth.username ?? ''}
                  onChange={e => onChange({ username: e.target.value })}
                  className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex-1">
                <label className="text-surface-400">Password</label>
                <div className="flex gap-1 mt-1">
                  <input
                    type="password"
                    value={secrets.secretValue}
                    onChange={e => secrets.setSecretValue(e.target.value)}
                    placeholder={auth.passwordSecretRef ? `Stored as "${auth.passwordSecretRef}"` : 'Password'}
                    className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <button
                    onClick={() => secrets.saveSecret(auth.passwordSecretRef ?? 'NTLM_PASSWORD')}
                    className="px-2 py-1 bg-blue-700 hover:bg-blue-600 rounded transition-colors"
                  >
                    {secrets.saved ? '✓' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-surface-400">Domain <span className="text-surface-600">(optional)</span></label>
                <input
                  value={auth.ntlmDomain ?? ''}
                  onChange={e => onChange({ ntlmDomain: e.target.value })}
                  placeholder="WORKGROUP"
                  className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex-1">
                <label className="text-surface-400">Workstation <span className="text-surface-600">(optional)</span></label>
                <input
                  value={auth.ntlmWorkstation ?? ''}
                  onChange={e => onChange({ ntlmWorkstation: e.target.value })}
                  placeholder="MACHINE"
                  className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <p className="text-surface-400 text-[10px] bg-surface-800 border border-surface-700 rounded px-2 py-1">
              Uses NTLMv2 over a single keep-alive connection. Not supported through a proxy.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <PlainCredentialsFields auth={auth} onChange={onChange} />
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-surface-400">Domain</label>
                <input
                  value={auth.ntlmDomain ?? ''}
                  onChange={e => onChange({ ntlmDomain: e.target.value })}
                  placeholder="WORKGROUP"
                  className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex-1">
                <label className="text-surface-400">Workstation</label>
                <input
                  value={auth.ntlmWorkstation ?? ''}
                  onChange={e => onChange({ ntlmWorkstation: e.target.value })}
                  placeholder="MACHINE"
                  className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        )
      )}

      {/* ── API Key ── */}
      {auth.type === 'apikey' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <div>
              <label className="text-surface-400">Key name</label>
              <input
                value={auth.apiKeyName ?? 'X-API-Key'}
                onChange={e => onChange({ apiKeyName: e.target.value })}
                className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-surface-400">In</label>
              <select
                value={auth.apiKeyIn ?? 'header'}
                onChange={e => onChange({ apiKeyIn: e.target.value as 'header' | 'query' })}
                className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              >
                <option value="header">Header</option>
                <option value="query">Query</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="text-surface-400">Value</label>
              {secrets ? (
                <div className="flex gap-1 mt-1">
                  <input
                    type="password"
                    value={secrets.secretValue}
                    onChange={e => secrets.setSecretValue(e.target.value)}
                    placeholder={auth.apiKeySecretRef ? `Stored as "${auth.apiKeySecretRef}"` : 'API key value'}
                    className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <button
                    onClick={() => secrets.saveSecret(auth.apiKeySecretRef ?? 'API_KEY')}
                    className="px-2 py-1 bg-blue-700 hover:bg-blue-600 rounded transition-colors"
                  >
                    {secrets.saved ? '✓' : 'Save'}
                  </button>
                </div>
              ) : (
                <input
                  value={auth.apiKeyValue ?? ''}
                  onChange={e => onChange({ apiKeyValue: e.target.value })}
                  placeholder="API key value"
                  className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 font-mono focus:outline-none focus:border-blue-500"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {children}
    </div>
  );
}

// ─── Plain username/password pair (folder/collection flavour) ─────────────────

function PlainCredentialsFields({
  auth,
  onChange,
}: {
  auth: { username?: string; password?: string }
  onChange: (p: AuthEditorPatch) => void
}) {
  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <label className="text-surface-400">Username</label>
        <input
          value={auth.username ?? ''}
          onChange={e => onChange({ username: e.target.value })}
          className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
        />
      </div>
      <div className="flex-1">
        <label className="text-surface-400">Password</label>
        <input
          type="password"
          value={auth.password ?? ''}
          onChange={e => onChange({ password: e.target.value })}
          className="mt-1 w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 font-mono focus:outline-none focus:border-blue-500"
        />
      </div>
    </div>
  );
}

// ─── Shared username/password sub-component (keychain flavour) ────────────────

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
  auth: { username?: string; password?: string; passwordSecretRef?: string }
  secretValue: string
  setSecretValue: (v: string) => void
  saved: boolean
  setAuth: (p: AuthEditorPatch) => void
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

// ─── Bearer panel (keychain flavour) ──────────────────────────────────────────

function BearerPanel({
  auth, secretValue, setSecretValue, saved, setAuth, saveSecret,
}: {
  auth: { token?: string; tokenSecretRef?: string }
  secretValue: string
  setSecretValue: (v: string) => void
  saved: boolean
  setAuth: (p: AuthEditorPatch) => void
  saveSecret: (ref: string) => Promise<void>
}) {
  const [keychainOpen, setKeychainOpen] = useState(!!auth.tokenSecretRef);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label className="text-surface-400">
          Token{' '}
          <span className="text-surface-500 text-[10px]">— supports {'{{variables}}'}</span>
        </label>
        <VarInput
          value={auth.token ?? ''}
          onChange={v => setAuth({ token: v })}
          placeholder="{{token}}  or paste a raw token"
          className="bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono text-xs"
        />
      </div>

      <button
        onClick={() => setKeychainOpen(o => !o)}
        className="text-[10px] text-surface-500 hover:text-surface-300 text-left transition-colors w-fit"
      >
        {keychainOpen ? '▾' : '▸'} Store in OS keychain instead
      </button>

      {keychainOpen && (
        <div className="flex flex-col gap-1 pl-3 border-l border-surface-800">
          <p className="text-surface-500 text-[10px]">
            Paste a raw token here to encrypt it in your OS keychain. Useful for static long-lived API tokens. Leave the value field above empty to use the keychain.
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={secretValue}
              onChange={e => setSecretValue(e.target.value)}
              placeholder={auth.tokenSecretRef ? `Stored as "${auth.tokenSecretRef}"` : 'Paste token'}
              className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
            />
            <input
              value={auth.tokenSecretRef ?? 'API_TOKEN'}
              onChange={e => setAuth({ tokenSecretRef: e.target.value })}
              placeholder="Keychain key"
              className="w-32 bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => saveSecret(auth.tokenSecretRef ?? 'API_TOKEN')}
              className="px-2 py-1 bg-blue-700 hover:bg-blue-600 rounded transition-colors"
            >
              {saved ? '✓' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
