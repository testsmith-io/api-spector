// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useEffect, useMemo, useState } from 'react';
import type { ApiRequest } from '../../../../shared/types';
import { useStore } from '../../store';
import { useActiveEnvironment } from '../../hooks/useActiveEnvironment';
import { collectFolderVars } from '../../../../shared/folder-tree';
import { VarInput } from '../common/VarInput';
import { TrashIcon } from '../common/icons';
import { useT } from '../../i18n';

// Scopes, from most general to most specific. Precedence (higher wins):
// global < environment < collection < folder < request. Request variables are
// the most specific static scope; they locally override any higher scope and
// are available to the request's examples. (Data-row, runtime sp.set and CLI
// --var values still override request variables at send time.)
type Scope = 'global' | 'collection' | 'folder' | 'environment' | 'request'

const SCOPE_BADGE: Record<Scope, string> = {
  global:      'text-amber-400 border-amber-500/30',
  collection:  'text-blue-400 border-blue-500/30',
  folder:      'text-violet-400 border-violet-500/30',
  environment: 'text-emerald-400 border-emerald-500/30',
  request:     'text-fuchsia-400 border-fuchsia-500/30',
};

// A {{token}} is "dynamic" when it resolves at send time rather than from a
// stored variable: built-in $vars ($uuid, $timestamp, …), faker/dayjs calls, or
// any expression. Those are never "undefined" even if absent from every scope.
function isDynamicToken(name: string): boolean {
  return name.startsWith('$') || name.includes('faker.') || name.includes('dayjs') || name.includes('(');
}

// Every {{var}} referenced anywhere the runner interpolates: URL, params,
// headers, auth, and the body (whichever mode is active).
function collectUsedTokens(req: ApiRequest): string[] {
  const parts: (string | undefined)[] = [req.url];
  for (const p of req.params ?? []) parts.push(p.key, p.value);
  for (const h of req.headers ?? []) parts.push(h.key, h.value);
  if (req.auth) parts.push(JSON.stringify(req.auth));
  const b = req.body;
  if (b) {
    parts.push(b.json, b.raw);
    if (b.graphql) parts.push(b.graphql.query, b.graphql.variables);
    if (b.soap) parts.push(b.soap.envelope);
    for (const f of b.form ?? []) parts.push(f.key, f.value);
  }
  const found = new Set<string>();
  for (const s of parts) {
    if (!s) continue;
    for (const m of s.matchAll(/\{\{([^}]+)\}\}/g)) found.add(m[1].trim());
  }
  return [...found];
}

/**
 * Variables available to a request, by scope, plus an editable request scope.
 * Shows which scope each variable resolves from (request > folder > collection
 * > environment > global), flags used-but-undefined tokens, and lets you define
 * request-local variables or locally override a higher-level one.
 */
export function VariablesTab({ request }: { readonly request: ApiRequest }) {
  const t = useT();
  const activeCollectionId = useStore(s => s.activeCollectionId);
  const collections        = useStore(s => s.collections);
  const globals            = useStore(s => s.globals);
  const updateRequest      = useStore(s => s.updateRequest);
  const updateExampleRequest = useStore(s => s.updateExampleRequest);
  const activeExampleId    = useStore(s => { const tb = s.tabs.find(x => x.id === s.activeTabId); return tb?.exampleId ?? null; });
  const activeEnv          = useActiveEnvironment();

  const col = activeCollectionId ? collections[activeCollectionId]?.data : undefined;

  // ── Scope maps ──────────────────────────────────────────────────────────────
  const { envDisplay, envKeys, folderVars, collectionVars } = useMemo(() => {
    const envDisplay: Record<string, string> = {};
    const envKeys = new Set<string>();
    for (const v of activeEnv?.variables ?? []) {
      if (!v.enabled || !v.key) continue;
      envKeys.add(v.key);
      envDisplay[v.key] = v.secret && v.secretEncrypted ? '••••••••'
        : v.envRef ? `$${v.envRef}`
        : v.value;
    }
    const folderVars = col ? collectFolderVars(col.rootFolder, request.id) : {};
    const collectionVars = col?.collectionVariables ?? {};
    return { envDisplay, envKeys, folderVars, collectionVars };
  }, [activeEnv, col, request.id]);

  const requestVars = useMemo(() => request.variables ?? {}, [request.variables]);

  // When viewing an example, the editable section targets the EXAMPLE's own
  // variables (stored on the example and overriding the request) instead of the
  // request's — so an example can hold its own values. The read-only scope views
  // above keep showing the effective (merged) request.variables.
  const isExample = !!activeExampleId;
  // Seed rows from the editable scope's enabled + disabled maps, so a disabled
  // (unchecked) variable round-trips (toggle) instead of being deleted.
  const editableSeed = useMemo<{ key: string; value: string; enabled: boolean }[]>(() => {
    const base = col?.requests[request.id];
    let enabled: Record<string, string>;
    let disabled: Record<string, string>;
    if (isExample) {
      const ex = base?.examples?.find(e => e.id === activeExampleId);
      enabled = ex?.request?.variables ?? {};
      disabled = ex?.request?.variablesDisabled ?? {};
    } else {
      enabled = base?.variables ?? request.variables ?? {};
      disabled = base?.variablesDisabled ?? request.variablesDisabled ?? {};
    }
    return [
      ...Object.entries(enabled).map(([key, value]) => ({ key, value, enabled: true })),
      ...Object.entries(disabled).map(([key, value]) => ({ key, value, enabled: false })),
    ];
  }, [isExample, activeExampleId, col, request.id, request.variables, request.variablesDisabled]);

  const sourceOf = (name: string): Scope =>
    name in requestVars ? 'request'
    : name in folderVars ? 'folder'
    : name in collectionVars ? 'collection'
    : envKeys.has(name) ? 'environment'
    : 'global';

  const valueOf = (name: string): string => {
    switch (sourceOf(name)) {
      case 'request':     return requestVars[name];
      case 'environment': return envDisplay[name] ?? '';
      case 'folder':      return folderVars[name];
      case 'collection':  return collectionVars[name];
      default:            return globals[name] ?? '';
    }
  };

  const inScope = useMemo(() => new Set<string>([
    ...Object.keys(requestVars), ...envKeys, ...Object.keys(folderVars),
    ...Object.keys(collectionVars), ...Object.keys(globals),
  ]), [requestVars, envKeys, folderVars, collectionVars, globals]);

  const used = useMemo(() => collectUsedTokens(request), [request]);
  const usedSet = useMemo(() => new Set(used), [used]);
  const allNames = useMemo(() => [...inScope].sort((a, b) => a.localeCompare(b)), [inScope]);

  const SCOPE_LABEL: Record<Scope, string> = {
    global: t('global'), collection: t('collection'), folder: t('folder'),
    environment: t('environment'), request: t('request'),
  };

  // ── Editable request-scope variables ─────────────────────────────────────────
  // A local row buffer so a half-typed (empty-key) row survives; persisted to the
  // request as a Record on every edit. Resynced when the request changes.
  type VarRow = { key: string; value: string; enabled: boolean };
  const [rows, setRows] = useState<VarRow[]>(() => editableSeed);
  useEffect(() => {
    setRows(editableSeed);
  }, [request.id, activeExampleId]); // eslint-disable-line react-hooks/exhaustive-deps

  function persist(next: VarRow[]) {
    setRows(next);
    const variables: Record<string, string> = {};
    const variablesDisabled: Record<string, string> = {};
    for (const r of next) {
      const k = r.key.trim();
      if (!k) continue;
      (r.enabled ? variables : variablesDisabled)[k] = r.value;
    }
    if (isExample && activeExampleId) updateExampleRequest(request.id, activeExampleId, { variables, variablesDisabled });
    else updateRequest(request.id, { variables, variablesDisabled });
  }
  const setRow = (i: number, patch: Partial<VarRow>) =>
    persist(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => persist(rows.filter((_, idx) => idx !== i));
  const addRow = (key = '', value = '') => persist([...rows, { key, value, enabled: true }]);

  const overrideHere = (name: string) => {
    if (name in requestVars) return;
    addRow(name, valueOf(name) === '••••••••' ? '' : `{{${name}}}`);
  };

  return (
    <div className="space-y-5 text-xs">
      {/* ── Request variables (editable) ──────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] uppercase tracking-wider text-surface-400">
            {isExample ? t('Example variables') : t('Request variables')}
            {rows.filter(r => r.enabled && r.key.trim()).length > 0 && (
              <span className="ml-1.5 text-surface-500">({rows.filter(r => r.enabled && r.key.trim()).length})</span>
            )}
          </h3>
          <button onClick={() => addRow()} className="text-[11px] text-fuchsia-400 hover:text-fuchsia-300">
            + {t('Add variable')}
          </button>
        </div>
        <p className="text-surface-500 mb-2">
          {isExample
            ? t('Scoped to this example. Override the request’s variables (and environment, folder, collection, global) for this example only.')
            : t('Scoped to this request and its examples. Override environment, folder, collection and global variables with the same name.')}
        </p>
        {rows.length > 0 && (
          <div className="flex flex-col gap-1">
            {rows.map((r, i) => {
              const key = r.key.trim();
              const shadows = !!key && (envKeys.has(key) || key in folderVars || key in collectionVars || key in globals);
              return (
                <div key={i} className={`flex items-center gap-1.5 ${r.enabled ? '' : 'opacity-50'}`}>
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={e => setRow(i, { enabled: e.target.checked })}
                    title={r.enabled ? t('Disable') : t('Enable')}
                    className="shrink-0 accent-blue-500 cursor-pointer"
                  />
                  <input
                    value={r.key}
                    onChange={e => setRow(i, { key: e.target.value })}
                    placeholder={t('name')}
                    className="w-40 bg-surface-800 border border-surface-700 rounded px-2 py-1 font-mono focus:outline-none focus:border-blue-500"
                  />
                  <VarInput
                    value={r.value}
                    onChange={v => setRow(i, { value: v })}
                    placeholder={t('value')}
                    wrapperClassName="flex-1"
                    className="bg-surface-800 border border-surface-700 rounded px-2 py-1 font-mono focus:outline-none focus:border-blue-500"
                  />
                  {shadows && (
                    <span className="shrink-0 text-[9px] uppercase tracking-wider text-fuchsia-400 border border-fuchsia-500/30 rounded px-1 py-px" title={t('Overrides a higher-level variable of the same name')}>
                      {t('override')}
                    </span>
                  )}
                  <button onClick={() => removeRow(i)} className="shrink-0 text-surface-500 hover:text-red-400 p-1" title={t('Remove')}>
                    <TrashIcon />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Referenced by this request ────────────────────────────────────── */}
      <section>
        <h3 className="text-[11px] uppercase tracking-wider text-surface-400 mb-2">
          {t('Referenced by this request')}
          {used.length > 0 && <span className="ml-1.5 text-surface-500">({used.length})</span>}
        </h3>
        {used.length === 0 ? (
          <p className="text-surface-500">{t('No {{variables}} are referenced in the URL, params, headers, auth, or body.')}</p>
        ) : (
          <div className="rounded border border-surface-800 overflow-hidden">
            {used.map(name => {
              const defined = inScope.has(name);
              const dynamic = !defined && isDynamicToken(name);
              return (
                <div key={name} className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-800 last:border-b-0">
                  <code className="font-mono text-surface-200 shrink-0">{`{{${name}}}`}</code>
                  <span className="flex-1 min-w-0 truncate text-surface-400 font-mono">
                    {defined ? (valueOf(name) || <span className="italic text-surface-600">{t('(empty)')}</span>)
                      : dynamic ? <span className="text-surface-500">{t('generated at send time')}</span>
                      : <span className="text-red-400">{t('not defined')}</span>}
                  </span>
                  {defined ? (
                    <span className={`shrink-0 text-[9px] uppercase tracking-wider border rounded px-1 py-px ${SCOPE_BADGE[sourceOf(name)]}`}>
                      {SCOPE_LABEL[sourceOf(name)]}
                    </span>
                  ) : !dynamic && (
                    <span className="shrink-0 text-[9px] uppercase tracking-wider text-red-400 border border-red-500/30 rounded px-1 py-px">
                      {t('missing')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── All variables in scope ────────────────────────────────────────── */}
      <section>
        <h3 className="text-[11px] uppercase tracking-wider text-surface-400 mb-2">
          {t('All variables in scope')}
          {allNames.length > 0 && <span className="ml-1.5 text-surface-500">({allNames.length})</span>}
        </h3>
        {allNames.length === 0 ? (
          <p className="text-surface-500">{t('No variables are defined in the active environment, collection, folder, or globals.')}</p>
        ) : (
          <div className="rounded border border-surface-800 overflow-hidden">
            {allNames.map(name => {
              const scope = sourceOf(name);
              return (
                <div key={name} className={`flex items-center gap-2 px-3 py-1.5 border-b border-surface-800 last:border-b-0 ${usedSet.has(name) ? 'bg-surface-800/40' : ''}`}>
                  <code className="font-mono text-surface-200 shrink-0">{name}</code>
                  {usedSet.has(name) && (
                    <span className="shrink-0 text-[9px] uppercase tracking-wider text-surface-400 border border-surface-700 rounded px-1 py-px" title={t('Referenced by this request')}>
                      {t('used')}
                    </span>
                  )}
                  <span className="flex-1 min-w-0 truncate text-surface-400 font-mono text-right">
                    {valueOf(name) || <span className="italic text-surface-600">{t('(empty)')}</span>}
                  </span>
                  {scope !== 'request' && (
                    <button
                      onClick={() => overrideHere(name)}
                      className="shrink-0 text-[9px] uppercase tracking-wider text-surface-500 hover:text-fuchsia-400 border border-surface-700 hover:border-fuchsia-500/40 rounded px-1 py-px"
                      title={t('Override this variable for this request')}
                    >
                      {t('override')}
                    </button>
                  )}
                  <span className={`shrink-0 text-[9px] uppercase tracking-wider border rounded px-1 py-px ${SCOPE_BADGE[scope]}`}>
                    {SCOPE_LABEL[scope]}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="text-[10px] text-surface-600 leading-relaxed">
        {t('Precedence (higher wins): global, collection, folder, environment, request. Data-row, runtime and CLI values override all. Secrets show as dots; environment-reference variables show as $NAME.')}
      </p>
    </div>
  );
}
