// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { ApiRequest } from '../../../../shared/types';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { DocsEditor } from '../common/DocsEditor';
import { useAiAvailable, generateDocs, requestDocsContext } from '../../lib/ai';

interface Props {
  readonly request: ApiRequest
  readonly onChange: (p: Partial<ApiRequest>) => void
}

/** Markdown documentation for a request (stored in `description`, so it travels
 *  with the collection). Optionally generated with AI when a key is configured. */
export function DocsTab({ request, onChange }: Props) {
  const t = useT();
  const aiAvailable = useAiAvailable();
  const lastResponse = useStore(s => s.tabs.find(tab => tab.id === s.activeTabId)?.lastResponse ?? null);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-surface-500 leading-relaxed">
        {t('Document this request in markdown. It is saved with the collection.')}
      </p>
      <DocsEditor
        value={request.description ?? ''}
        onChange={v => onChange({ description: v })}
        aiAvailable={aiAvailable}
        onGenerate={() => generateDocs({
          level: 'request',
          name: request.name,
          existing: request.description,
          context: requestDocsContext(request, {
            response: lastResponse && !lastResponse.error ? { status: lastResponse.status, body: lastResponse.body } : null,
          }),
        })}
      />
    </div>
  );
}
