// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React from 'react';
import type { ApiRequest } from '../../../../shared/types';
import { KVTable } from './KVTable';
import { useStore } from '../../store';
import { inheritedHeadersWithSource } from '../../../../shared/request-collection';
import { useT } from '../../i18n';

export function HeadersTab({ request, onChange }: { readonly request: ApiRequest; readonly onChange: (p: Partial<ApiRequest>) => void }) {
  const t = useT();
  const collections = useStore(s => s.collections);

  // Headers inherited from the collection and the folders on this request's
  // path. Resolved from whichever collection actually owns the request, so it
  // is correct regardless of which collection is "active".
  const owning = Object.values(collections).find(c => request.id in c.data.requests)?.data;
  const inherited = owning ? inheritedHeadersWithSource(request.id, owning) : [];

  return (
    <div className="flex flex-col gap-3">
      <KVTable
        rows={request.headers}
        onChange={rows => onChange({ headers: rows })}
        keyPlaceholder={t('Header-Name')}
        valuePlaceholder={t('value')}
        headerMode
      />

      {inherited.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-surface-500 font-medium mb-1.5 flex items-center gap-1.5">
            <span>{t('Inherited headers')}</span>
            <span className="text-surface-600 normal-case tracking-normal">({inherited.length})</span>
          </div>
          <table className="w-full text-xs">
            <tbody>
              {inherited.map((h, i) => (
                <tr key={`${h.key}:${i}`} className="border-b border-surface-800/40">
                  <td className="px-2 py-1 w-56 font-mono text-surface-400 align-top break-all">{h.key}</td>
                  <td className="px-2 py-1 font-mono text-surface-500 align-top break-all">{h.value}</td>
                  <td className="px-2 py-1 w-44 text-right align-top">
                    <span
                      className="text-[9px] uppercase tracking-wider text-sky-300/90 border border-sky-500/30 rounded px-1 py-px whitespace-nowrap"
                      title={t('Defined on :source', { source: h.source })}
                    >
                      {t('from :source', { source: h.source })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] text-surface-600 mt-1.5">
            {t('These are sent with the request, defined on the parent folder or collection. Add a header with the same name above to send your own value as well.')}
          </p>
        </div>
      )}
    </div>
  );
}
