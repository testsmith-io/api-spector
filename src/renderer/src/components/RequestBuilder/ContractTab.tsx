// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import type { ApiRequest, ContractExpectation } from '../../../../shared/types';
import { useStore } from '../../store';

const { electron } = window;

interface Props {
  request: ApiRequest
  onChange: (patch: Partial<ApiRequest>) => void
}

const EMPTY: ContractExpectation = { statusCode: 200, headers: [], bodySchema: '' };

export function ContractTab({ request, onChange }: Props) {
  const activeTab      = useStore(s => s.tabs.find(t => t.id === s.activeTabId));
  const lastResponse   = activeTab?.lastResponse ?? null;
  const contract       = request.contract ?? EMPTY;
  const [inferring, setInferring] = useState(false);

  function update(patch: Partial<ContractExpectation>) {
    onChange({ contract: { ...contract, ...patch } });
  }

  async function inferSchema() {
    if (!lastResponse?.body) return;
    setInferring(true);
    try {
      const schema = await electron.inferContractSchema(lastResponse.body);
      if (schema) update({ bodySchema: schema });
    } finally {
      setInferring(false);
    }
  }

  function addHeader() {
    update({ headers: [...(contract.headers ?? []), { key: '', value: '', required: true }] });
  }

  function updateHeader(i: number, patch: Partial<ContractExpectation['headers'][0]>) {
    const headers = [...(contract.headers ?? [])];
    headers[i] = { ...headers[i], ...patch };
    update({ headers });
  }

  function removeHeader(i: number) {
    update({ headers: (contract.headers ?? []).filter((_, idx) => idx !== i) });
  }

  const hasContract = contract.statusCode !== undefined || contract.bodySchema?.trim() || contract.headers?.some(h => h.key);

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      {/* Status indicator */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border ${
        hasContract
          ? 'bg-blue-950/40 border-blue-700 text-blue-300'
          : 'bg-surface-800 border-surface-700 text-surface-500'
      }`}>
        <span className={`w-2 h-2 rounded-full ${hasContract ? 'bg-blue-400' : 'bg-surface-600'}`} />
        {hasContract ? 'Contract defined — will be verified in Contract panel' : 'No contract defined yet'}
      </div>

      {/* Expected status code */}
      <div>
        <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium block mb-1.5">
          Expected Status Code
        </label>
        <input
          type="number"
          value={contract.statusCode ?? ''}
          onChange={e => update({ statusCode: e.target.value ? Number(e.target.value) : undefined })}
          placeholder="200"
          className="w-28 text-xs bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono"
        />
      </div>

      {/* Expected response headers */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
            Required Response Headers
          </label>
          <button
            onClick={addHeader}
            className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
          >
            + Add
          </button>
        </div>
        {(contract.headers ?? []).length === 0 ? (
          <p className="text-[11px] text-surface-600 italic">No required headers</p>
        ) : (
          <div className="flex flex-col gap-1">
            {(contract.headers ?? []).map((h, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  value={h.required ? '✓' : '○'}
                  readOnly
                  onClick={() => updateHeader(i, { required: !h.required })}
                  className="w-6 text-center text-xs bg-surface-800 border border-surface-700 rounded px-1 py-1 cursor-pointer text-blue-400"
                  title="Click to toggle required"
                />
                <input
                  value={h.key}
                  onChange={e => updateHeader(i, { key: e.target.value })}
                  placeholder="Header name"
                  className="flex-1 text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
                />
                <input
                  value={h.value}
                  onChange={e => updateHeader(i, { value: e.target.value })}
                  placeholder="Expected value (optional)"
                  className="flex-1 text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono"
                />
                <button onClick={() => removeHeader(i)} className="text-surface-600 hover:text-red-400 text-sm leading-none px-1">×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Expected body schema */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
            Expected Response Body Schema (JSON Schema)
          </label>
          <button
            onClick={inferSchema}
            disabled={!lastResponse?.body || inferring}
            className="text-[10px] text-blue-400 hover:text-blue-300 disabled:text-surface-600 transition-colors"
            title={lastResponse?.body ? 'Generate schema from last response' : 'Send the request first'}
          >
            {inferring ? 'Inferring…' : '⚡ Infer from response'}
          </button>
        </div>
        <div className="border border-surface-700 rounded overflow-hidden">
          <CodeMirror
            value={contract.bodySchema ?? ''}
            height="300px"
            maxHeight="50vh"
            theme={oneDark}
            extensions={[json()]}
            onChange={val => update({ bodySchema: val })}
            placeholder={'{\n  "type": "object",\n  "required": ["id"],\n  "properties": {\n    "id": { "type": "integer" }\n  }\n}'}
            basicSetup={{ lineNumbers: true, foldGutter: true }}
          />
        </div>
      </div>
    </div>
  );
}
