// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import type { ApiRequest } from '../../../../shared/types';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { renderMarkup } from '../common/RichText';
import { validateBodyAgainstSchema, type SchemaValidation } from '../../lib/schema-validate';
import { SchemaSyncModal } from '../CollectionTree/SchemaSyncModal';

const { electron } = window;

interface Props {
  readonly request: ApiRequest
  readonly onChange: (p: Partial<ApiRequest>) => void
}

export function SchemaTab({ request, onChange }: Props) {
  const t = useT();
  const activeTab      = useStore(s => s.tabs.find(tab => tab.id === s.activeTabId));
  const lastResponse   = activeTab?.lastResponse ?? null;
  const collectionId   = useStore(s =>
    Object.values(s.collections).find(c => c.data.requests[request.id])?.data.id ?? null);
  const [result, setResult] = useState<SchemaValidation | null>(null);
  const [inferring, setInferring] = useState(false);
  const [showSync, setShowSync] = useState(false);

  const schemaValue = request.schema ?? '';

  function setSchema(val: string) {
    onChange({ schema: val });
  }

  // Auto-validate: whenever a response arrives (or the schema changes) and both
  // are present, re-check silently so opening this tab after a send already
  // shows the current pass / fail without clicking Validate.
  useEffect(() => {
    if (!schemaValue.trim() || !lastResponse) { setResult(null); return; }
    setResult(validateBodyAgainstSchema(schemaValue, lastResponse.body));
  }, [schemaValue, lastResponse]);

  async function createFromResponse() {
    if (!lastResponse?.body) return;
    setInferring(true);
    try {
      const schema = await electron.inferContractSchema(lastResponse.body);
      if (schema) setSchema(schema);
    } finally {
      setInferring(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* What this tab is. */}
      <div className="rounded-lg border border-blue-700/40 bg-blue-950/20 px-3 py-2 text-[11px] leading-relaxed text-blue-200/90">
        <span className="font-semibold text-blue-300">{t('Response schema.')}</span>{' '}
        {renderMarkup(t("Validate this request's response body against a JSON Schema. The schema comes from your **OpenAPI spec** or is **created from a response**, and is checked automatically after every send. For cross-team contract verification, use the **Contract** panel."))}
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[10px] text-surface-600 uppercase tracking-wider font-medium">
          {t('JSON Schema (draft-07+)')}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSync(true)}
            disabled={!collectionId}
            title={t('Match this request against your OpenAPI spec and pull in its response schema')}
            className="px-3 py-1 text-xs bg-surface-800 hover:bg-surface-700 disabled:bg-surface-900 disabled:text-surface-600 rounded transition-colors font-medium"
          >
            {t('Sync from OpenAPI')}
          </button>
          <button
            onClick={createFromResponse}
            disabled={!lastResponse?.body || inferring}
            title={lastResponse?.body ? t('Infer a schema from the last response body') : t('Send the request first')}
            className="px-3 py-1 text-xs bg-surface-800 hover:bg-surface-700 disabled:bg-surface-900 disabled:text-surface-600 rounded transition-colors font-medium"
          >
            {inferring ? t('Creating…') : t('Create from response')}
          </button>
        </div>
      </div>

      {/* Schema editor */}
      <div className="border border-surface-700 rounded overflow-hidden">
        <div className="flex justify-end px-2 py-0.5 bg-surface-800/50 border-b border-surface-700">
          <button
            onClick={() => {
              try { setSchema(JSON.stringify(JSON.parse(schemaValue), null, 2)); } catch { /* invalid json */ }
            }}
            className="text-[10px] text-surface-500 hover:text-white transition-colors"
            title={t('Format JSON')}
          >
            {t('Format')}
          </button>
        </div>
        <CodeMirror
          value={schemaValue}
          height="300px"
          maxHeight="50vh"
          theme={oneDark}
          extensions={[json()]}
          onChange={val => setSchema(val)}
          placeholder={'{\n  "type": "object",\n  "properties": {}\n}'}
          basicSetup={{ lineNumbers: true, foldGutter: true }}
        />
      </div>

      {/* Validation status */}
      {!schemaValue.trim() ? (
        <p className="text-[11px] text-surface-600">
          {t('No schema yet. Sync one from your OpenAPI spec or create one from a response.')}
        </p>
      ) : !lastResponse ? (
        <p className="text-[11px] text-surface-600">
          {t('Schema saved. Send the request and the response will be validated automatically.')}
        </p>
      ) : result?.status === 'error' ? (
        <div className="text-xs text-amber-400 bg-amber-950/40 border border-amber-800 rounded px-3 py-2">
          {t(result.message)}
        </div>
      ) : result?.status === 'valid' ? (
        <div className="rounded border border-emerald-700 bg-emerald-900/20 px-3 py-2 text-xs">
          <span className="text-emerald-400 font-semibold">{t('Valid: response matches the schema.')}</span>
        </div>
      ) : result?.status === 'invalid' ? (
        <div className="rounded border border-red-700 bg-red-900/20 px-3 py-2 text-xs">
          <div className="flex flex-col gap-1.5">
            <span className="text-red-400 font-semibold">{t('Invalid: :count error|Invalid: :count errors', { count: result.errors.length })}</span>
            {result.errors.map((e, i) => (
              <div key={i} className="flex gap-2 text-red-300">
                <span className="text-red-500 font-mono shrink-0">{e.instancePath || '/'}</span>
                <span>{e.message}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {showSync && collectionId && (
        <SchemaSyncModal
          collectionId={collectionId}
          scope={{ type: 'request', requestId: request.id }}
          onClose={() => setShowSync(false)}
        />
      )}
    </div>
  );
}
