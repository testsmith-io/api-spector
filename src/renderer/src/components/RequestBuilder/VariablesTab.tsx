// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useMemo } from 'react';
import type { ApiRequest } from '../../../../shared/types';
import { useStore } from '../../store';
import { useVarValues } from '../../hooks/useVarValues';
import { useActiveEnvironment } from '../../hooks/useActiveEnvironment';
import { useT } from '../../i18n';

type Scope = 'environment' | 'collection' | 'global'

// A {{token}} is "dynamic" when it resolves at send time rather than from a
// stored variable: built-in $vars ($uuid, $timestamp, …), faker/dayjs calls, or
// any expression. Those are never "undefined" even if absent from every scope.
function isDynamicToken(name: string): boolean {
  return name.startsWith('$')
    || name.includes('faker.')
    || name.includes('dayjs')
    || name.includes('(');
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

const SCOPE_BADGE: Record<Scope, string> = {
  environment: 'text-emerald-400 border-emerald-500/30',
  collection:  'text-blue-400 border-blue-500/30',
  global:      'text-amber-400 border-amber-500/30',
};

/**
 * Read-only view of every variable available to a request: the resolved value,
 * which scope it comes from (environment > collection > global, matching the
 * runner's precedence), and which ones the request actually references. Used
 * tokens that resolve to nothing (and aren't dynamic) are flagged, since those
 * are the usual cause of a request silently sending a blank value.
 */
export function VariablesTab({ request }: { readonly request: ApiRequest }) {
  const t = useT();
  const activeCollectionId = useStore(s => s.activeCollectionId);
  const collections        = useStore(s => s.collections);
  const globals            = useStore(s => s.globals);
  const activeEnv          = useActiveEnvironment();
  const values             = useVarValues();

  // Scope membership (for the source badge), honouring the same precedence the
  // merge uses: environment overrides collection overrides global.
  const { sourceOf, inScope } = useMemo(() => {
    const envKeys = new Set<string>();
    for (const v of activeEnv?.variables ?? []) if (v.enabled && v.key) envKeys.add(v.key);
    const colKeys = new Set(Object.keys(
      activeCollectionId ? collections[activeCollectionId]?.data.collectionVariables ?? {} : {},
    ));
    const globalKeys = new Set(Object.keys(globals));
    const all = new Set<string>([...envKeys, ...colKeys, ...globalKeys]);
    const sourceOf = (name: string): Scope =>
      envKeys.has(name) ? 'environment' : colKeys.has(name) ? 'collection' : 'global';
    return { sourceOf, inScope: all };
  }, [activeEnv, activeCollectionId, collections, globals]);

  const used = useMemo(() => collectUsedTokens(request), [request]);
  const usedSet = useMemo(() => new Set(used), [used]);

  const allNames = useMemo(
    () => [...inScope].sort((a, b) => a.localeCompare(b)),
    [inScope],
  );

  const SCOPE_LABEL: Record<Scope, string> = {
    environment: t('environment'),
    collection:  t('collection'),
    global:      t('global'),
  };

  return (
    <div className="space-y-5 text-xs">
      {/* ── Referenced by this request ─────────────────────────────────── */}
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
                    {defined ? (values[name] || <span className="italic text-surface-600">{t('(empty)')}</span>)
                      : dynamic ? <span className="text-surface-500">{t('generated at send time')}</span>
                      : <span className="text-red-400">{t('not defined')}</span>}
                  </span>
                  {defined && (
                    <span className={`shrink-0 text-[9px] uppercase tracking-wider border rounded px-1 py-px ${SCOPE_BADGE[sourceOf(name)]}`}>
                      {SCOPE_LABEL[sourceOf(name)]}
                    </span>
                  )}
                  {!defined && !dynamic && (
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

      {/* ── All variables in scope ─────────────────────────────────────── */}
      <section>
        <h3 className="text-[11px] uppercase tracking-wider text-surface-400 mb-2">
          {t('All variables in scope')}
          {allNames.length > 0 && <span className="ml-1.5 text-surface-500">({allNames.length})</span>}
        </h3>
        {allNames.length === 0 ? (
          <p className="text-surface-500">{t('No variables are defined in the active environment, collection, or globals.')}</p>
        ) : (
          <div className="rounded border border-surface-800 overflow-hidden">
            {allNames.map(name => (
              <div
                key={name}
                className={`flex items-center gap-2 px-3 py-1.5 border-b border-surface-800 last:border-b-0 ${usedSet.has(name) ? 'bg-surface-800/40' : ''}`}
              >
                <code className="font-mono text-surface-200 shrink-0">{name}</code>
                {usedSet.has(name) && (
                  <span className="shrink-0 text-[9px] uppercase tracking-wider text-surface-400 border border-surface-700 rounded px-1 py-px" title={t('Referenced by this request')}>
                    {t('used')}
                  </span>
                )}
                <span className="flex-1 min-w-0 truncate text-surface-400 font-mono text-right">
                  {values[name] || <span className="italic text-surface-600">{t('(empty)')}</span>}
                </span>
                <span className={`shrink-0 text-[9px] uppercase tracking-wider border rounded px-1 py-px ${SCOPE_BADGE[sourceOf(name)]}`}>
                  {SCOPE_LABEL[sourceOf(name)]}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="text-[10px] text-surface-600 leading-relaxed">
        {t('Precedence: environment overrides collection overrides global. Secrets show as dots; environment-reference variables show as $NAME.')}
      </p>
    </div>
  );
}
