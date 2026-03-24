// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

import React, { useState } from 'react';
import { useStore } from '../../store';
import type { EnvVariable } from '../../../../shared/types';
import { MasterKeyModal } from './MasterKeyModal';
import { envRelPath } from '../../../../shared/naming-utils';

const { electron } = window;

// ─── Crypto helpers (Web Crypto API) ─────────────────────────────────────────

/** First 8 hex chars of SHA-256(value) — fingerprint only, not reversible. */
async function shortHash(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 8);
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer)));
}

/**
 * Encrypt plaintext with AES-256-GCM using PBKDF2-derived key.
 * Returns base64 fields suitable for storing in the env file.
 */
async function encryptSecret(plaintext: string, password: string): Promise<{
  secretEncrypted: string
  secretSalt: string
  secretIv: string
  secretHash: string
}> {
  const enc  = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));

  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));

  return {
    secretEncrypted: b64(encrypted),
    secretSalt: b64(salt),
    secretIv: b64(iv),
    secretHash: await shortHash(plaintext),
  };
}

// ─── Source mode ──────────────────────────────────────────────────────────────

type SourceMode = 'plain' | 'encrypted' | 'env'

function getSourceMode(v: EnvVariable): SourceMode {
  if (v.envRef  !== undefined) return 'env';
  if (v.secret)               return 'encrypted';
  return 'plain';
}

// ─── Component ───────────────────────────────────────────────────────────────

export function EnvironmentEditor({ onClose }: { onClose: () => void }) {
  const environments         = useStore(s => s.environments);
  const activeEnvironmentId  = useStore(s => s.activeEnvironmentId);
  const updateEnvironment    = useStore(s => s.updateEnvironment);
  const setActiveEnvironment = useStore(s => s.setActiveEnvironment);

  const [selectedId,   setSelectedId]   = useState<string>(
    activeEnvironmentId ?? Object.keys(environments)[0] ?? ''
  );
  // Pending plaintext input per row (cleared after encrypting)
  const [secretInputs, setSecretInputs] = useState<Record<number, string>>({});
  // Row that just got saved
  const [savedIdx,     setSavedIdx]     = useState<number | null>(null);
  // Show master key setup modal for a pending row
  const [pendingEncryptIdx, setPendingEncryptIdx] = useState<number | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const deleteEnvironment = useStore(s => s.deleteEnvironment);

  const envList = Object.values(environments);
  const env = selectedId ? environments[selectedId]?.data ?? null : null;

  function handleDelete(id: string) {
    deleteEnvironment(id);
    const remaining = Object.keys(environments).filter(k => k !== id);
    setSelectedId(remaining[0] ?? '');
  }

  function updateVar(idx: number, patch: Partial<EnvVariable>) {
    if (!env) return;
    const vars = env.variables.map((v, i) => i === idx ? { ...v, ...patch } : v);
    updateEnvironment(env.id, { ...env, variables: vars });
  }

  function addVar() {
    if (!env) return;
    const newVar: EnvVariable = { key: '', value: '', enabled: true };
    updateEnvironment(env.id, { ...env, variables: [...env.variables, newVar] });
  }

  function removeVar(idx: number) {
    if (!env) return;
    updateEnvironment(env.id, { ...env, variables: env.variables.filter((_, i) => i !== idx) });
  }

  function cycleSource(idx: number) {
    if (!env) return;
    const v = env.variables[idx];
    const current = getSourceMode(v);
    const next: SourceMode = current === 'plain' ? 'encrypted' : current === 'encrypted' ? 'env' : 'plain';

    if (next === 'plain') {
      updateVar(idx, { secret: false, secretEncrypted: undefined, secretSalt: undefined, secretIv: undefined, secretHash: undefined, envRef: undefined, value: '' });
    } else if (next === 'encrypted') {
      updateVar(idx, { secret: true, secretEncrypted: undefined, secretSalt: undefined, secretIv: undefined, secretHash: undefined, envRef: undefined, value: '' });
    } else {
      updateVar(idx, { secret: false, secretEncrypted: undefined, secretSalt: undefined, secretIv: undefined, secretHash: undefined, envRef: '', value: '' });
    }
    setSecretInputs(s => { const n = { ...s }; delete n[idx]; return n; });
  }

  async function doEncrypt(idx: number, password: string) {
    const plaintext = secretInputs[idx] ?? '';
    if (!plaintext) return;

    const fields = await encryptSecret(plaintext, password);
    updateVar(idx, { ...fields, value: '' });
    setSecretInputs(s => { const n = { ...s }; delete n[idx]; return n; });
    setSavedIdx(idx);
    setTimeout(() => setSavedIdx(null), 2500);
  }

  async function saveEncrypted(idx: number) {
    const plaintext = secretInputs[idx] ?? '';
    if (!plaintext) return;

    const { set } = await electron.checkMasterKey();
    if (!set) {
      setPendingEncryptIdx(idx);
      return;
    }
    // Master key already set in process — but we need the value to encrypt in renderer.
    // Prompt user since we can't read it back from main.
    setPendingEncryptIdx(idx);
  }

  function selectEnv(id: string) {
    setSelectedId(id);
    setActiveEnvironment(id);
    setSecretInputs({});
    setNameError(null);
  }

  async function saveEnv() {
    if (!env) return;
    const duplicate = Object.values(environments).some(
      e => e.data.id !== env.id && e.data.name.toLowerCase() === env.name.trim().toLowerCase()
    );
    if (duplicate) {
      setNameError(`"${env.name.trim()}" already exists`);
      return;
    }
    setNameError(null);
    const currentRelPath = environments[env.id]?.relPath ?? `environments/${env.id}.env.json`;
    const newRelPath = envRelPath(env.name, env.id);

    // Update store and workspace if the path changed (name was renamed)
    if (newRelPath !== currentRelPath) {
      useStore.setState(state => ({
        environments: {
          ...state.environments,
          [env.id]: { ...state.environments[env.id], relPath: newRelPath },
        },
        workspace: state.workspace ? {
          ...state.workspace,
          environments: state.workspace.environments.map(p => p === currentRelPath ? newRelPath : p),
        } : state.workspace,
      }));
      const ws = useStore.getState().workspace;
      if (ws) await electron.saveWorkspace(ws);
    }

    await electron.saveEnvironment(newRelPath, env);
  }

  return (
    <>
      {pendingEncryptIdx !== null && (
        <MasterKeyModal
          onSuccess={async (password) => {
            setPendingEncryptIdx(null);
            await doEncrypt(pendingEncryptIdx, password);
          }}
          onCancel={() => setPendingEncryptIdx(null)}
        />
      )}

      <div
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
        onClick={onClose}
      >
        <div
          className="bg-surface-900 border border-surface-800 rounded-lg shadow-2xl flex w-[780px] max-h-[80vh]"
          onClick={e => e.stopPropagation()}
        >
          {/* Sidebar */}
          <div className="w-44 border-r border-surface-800 flex flex-col flex-shrink-0">
            <div className="px-3 py-2 text-xs font-semibold text-surface-400 uppercase tracking-wider border-b border-surface-800">
              Environments
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {envList.map(({ data: e }) => (
                <div
                  key={e.id}
                  className={`group flex items-center pr-1 transition-colors ${
                    selectedId === e.id ? 'bg-surface-800' : 'hover:bg-surface-800'
                  }`}
                >
                  <button
                    onClick={() => selectEnv(e.id)}
                    className={`flex-1 text-left px-3 py-1.5 text-xs truncate ${
                      selectedId === e.id ? 'text-white' : 'text-surface-200'
                    }`}
                  >
                    {e.name}
                  </button>
                  <button
                    onClick={() => handleDelete(e.id)}
                    className="opacity-0 group-hover:opacity-100 text-surface-400 hover:text-red-400 transition-all px-1 text-sm leading-none shrink-0"
                    title="Delete environment"
                  >×</button>
                </div>
              ))}
            </div>
            <button
              onClick={() => {
                useStore.getState().addEnvironment();
                const newId = Object.keys(useStore.getState().environments).at(-1) ?? '';
                selectEnv(newId);
              }}
              className="px-3 py-2 text-xs text-surface-400 hover:text-white border-t border-surface-800 transition-colors text-left"
            >
              + Add environment
            </button>
          </div>

          {/* Main editor */}
          {env ? (
            <div className="flex-1 flex flex-col min-w-0">
              {/* Name bar */}
              <div className="px-4 py-2 border-b border-surface-800">
                <div className="flex items-center gap-3">
                  <input
                    value={env.name}
                    onChange={e => { updateEnvironment(env.id, { ...env, name: e.target.value }); setNameError(null); }}
                    className={`flex-1 bg-surface-800 rounded px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-1 ${
                      nameError ? 'ring-1 ring-red-500 focus:ring-red-500' : 'focus:ring-blue-500'
                    }`}
                    placeholder="Environment name"
                  />
                  <button onClick={onClose} className="text-surface-400 hover:text-white text-lg leading-none">×</button>
                </div>
                {nameError && <p className="text-[10px] text-red-400 mt-1">{nameError}</p>}
              </div>

              {/* Variables table */}
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-surface-400 text-left border-b border-surface-800">
                      <th className="px-3 py-2 w-8">On</th>
                      <th className="px-2 py-2 w-36">Variable</th>
                      <th className="px-2 py-2">Value / Encrypted / Env var</th>
                      <th className="px-2 py-2 w-20 text-center">Source</th>
                      <th className="px-2 py-2 w-6"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {env.variables.map((v, idx) => {
                      const mode = getSourceMode(v);
                      return (
                        <tr key={idx} className="group border-b border-surface-800/50 hover:bg-surface-800/30">
                          {/* Enabled */}
                          <td className="px-3 py-1.5">
                            <input
                              type="checkbox"
                              checked={v.enabled}
                              onChange={e => updateVar(idx, { enabled: e.target.checked })}
                              className="accent-blue-500"
                            />
                          </td>

                          {/* Key */}
                          <td className="px-2 py-1.5">
                            <input
                              value={v.key}
                              onChange={e => updateVar(idx, { key: e.target.value })}
                              placeholder="variable_name"
                              className="w-full bg-surface-800 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </td>

                          {/* Value cell */}
                          <td className="px-2 py-1.5">
                            {mode === 'plain' && (
                              <input
                                value={v.value}
                                onChange={e => updateVar(idx, { value: e.target.value })}
                                placeholder="value"
                                className="w-full bg-surface-800 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            )}

                            {mode === 'encrypted' && (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="password"
                                  value={secretInputs[idx] ?? ''}
                                  onChange={e => setSecretInputs(s => ({ ...s, [idx]: e.target.value }))}
                                  placeholder={
                                    v.secretHash
                                      ? `Encrypted  ·  sha256: ${v.secretHash}…`
                                      : 'Enter secret value to encrypt…'
                                  }
                                  className="flex-1 bg-surface-800 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <button
                                  onClick={() => saveEncrypted(idx)}
                                  disabled={!secretInputs[idx]}
                                  className="px-2 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 rounded whitespace-nowrap transition-colors"
                                >
                                  {savedIdx === idx ? '✓ Saved' : 'Encrypt'}
                                </button>
                                {v.secretHash && savedIdx !== idx && (
                                  <span
                                    className="text-[10px] text-emerald-400 font-mono shrink-0"
                                    title={`SHA-256 fingerprint of encrypted value: ${v.secretHash}…`}
                                  >
                                    ●&nbsp;{v.secretHash}…
                                  </span>
                                )}
                              </div>
                            )}

                            {mode === 'env' && (
                              <div className="flex items-center gap-1 font-mono">
                                <span className="text-surface-400 select-none">$</span>
                                <input
                                  value={v.envRef ?? ''}
                                  onChange={e => updateVar(idx, { envRef: e.target.value })}
                                  placeholder="OS_ENV_VAR_NAME"
                                  className="flex-1 bg-surface-800 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <span
                                  className="text-[10px] text-surface-400 shrink-0"
                                  title="Value read from OS env at send-time. Never stored in project."
                                >
                                  process.env
                                </span>
                              </div>
                            )}
                          </td>

                          {/* Source cycle button */}
                          <td className="px-2 py-1.5 text-center">
                            <button
                              onClick={() => cycleSource(idx)}
                              title={
                                mode === 'plain'     ? 'Plain text — click to switch to encrypted secret'  :
                                mode === 'encrypted' ? 'Encrypted secret — click to switch to env var ref' :
                                                       'OS env var reference — click to switch to plain text'
                              }
                              className="flex items-center justify-center gap-1 mx-auto px-1.5 py-0.5 rounded border transition-colors text-[10px] font-medium w-16 border-surface-700 hover:border-surface-500"
                            >
                              {mode === 'plain'     && <span>abc</span>}
                              {mode === 'encrypted' && <><span className="text-amber-400">🔒</span><span className="text-amber-400">enc</span></>}
                              {mode === 'env'       && <><span className="text-blue-400">$</span><span className="text-blue-400">env</span></>}
                            </button>
                          </td>

                          {/* Delete */}
                          <td className="px-2 py-1.5">
                            <button
                              onClick={() => removeVar(idx)}
                              className="text-surface-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                            >×</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <button
                  onClick={addVar}
                  className="mx-3 my-2 text-xs text-surface-400 hover:text-white transition-colors"
                >
                  + Add variable
                </button>
              </div>

              {/* Usage hint */}
              <div className="px-4 py-2 border-t border-surface-800 bg-surface-950/50 flex flex-col gap-0.5">
                <p className="text-[10px] text-surface-400">
                  Use <code className="text-surface-200">{'{{variable_name}}'}</code> in URLs, headers, and body.
                </p>
                <p className="text-[10px] text-surface-400">
                  <span className="text-amber-400">🔒 Encrypted</span> — AES-256-GCM, key from{' '}
                  <code className="text-surface-200">API_SPECTOR_MASTER_KEY</code>.
                </p>
                <p className="text-[10px] text-surface-400">
                  <span className="text-blue-400">$ Env var</span> — read from{' '}
                  <code className="text-surface-200">process.env</code> at send-time. Ideal for CI/CD.
                </p>
              </div>

              {/* Footer */}
              <div className="px-4 py-2 border-t border-surface-800 flex justify-end gap-2">
                <button onClick={onClose} className="px-3 py-1.5 text-xs text-surface-400 hover:text-white">
                  Cancel
                </button>
                <button
                  onClick={() => { saveEnv(); onClose(); }}
                  className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-surface-400 text-xs">
              <p>No environment selected.</p>
              <button
                onClick={() => { useStore.getState().addEnvironment(); const id = Object.keys(useStore.getState().environments).at(-1) ?? ''; selectEnv(id); }}
                className="text-blue-400 hover:text-blue-300"
              >
                + Create environment
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
