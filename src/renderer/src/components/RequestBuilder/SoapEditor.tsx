import React, { useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { xml } from '@codemirror/lang-xml';
import { oneDark } from '@codemirror/theme-one-dark';
import type { ApiRequest, SoapBody } from '../../../../shared/types';

const { electron } = window;

interface WsdlOperation {
  name: string
  soapAction?: string
  inputTemplate: string
}

interface Props {
  request: ApiRequest
  onChange: (p: Partial<ApiRequest>) => void
}

export function SoapEditor({ request, onChange }: Props) {
  const soap: SoapBody = request.body.soap ?? {
    wsdlUrl: '',
    envelope: '',
  };

  const [operations, setOperations] = useState<WsdlOperation[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  function updateSoap(patch: Partial<SoapBody>) {
    onChange({ body: { ...request.body, soap: { ...soap, ...patch } } });
  }

  async function fetchWsdl() {
    if (!soap.wsdlUrl.trim()) return;
    setFetching(true);
    setFetchError(null);
    try {
      const result = await electron.wsdlFetch(soap.wsdlUrl.trim());
      setOperations(result.operations);
      if (result.operations.length > 0) {
        const first = result.operations[0];
        updateSoap({
          operationName: first.name,
          soapAction: first.soapAction ?? '',
          envelope: first.inputTemplate,
        });
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  }

  function selectOperation(name: string) {
    const op = operations.find(o => o.name === name);
    if (!op) return;
    updateSoap({
      operationName: op.name,
      soapAction: op.soapAction ?? soap.soapAction ?? '',
      envelope: op.inputTemplate,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* WSDL URL */}
      <div className="flex gap-2 items-center">
        <input
          value={soap.wsdlUrl}
          onChange={e => updateSoap({ wsdlUrl: e.target.value })}
          placeholder="https://example.com/service.wsdl"
          className="flex-1 text-xs bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 placeholder-surface-600 font-mono"
        />
        <button
          onClick={fetchWsdl}
          disabled={fetching || !soap.wsdlUrl.trim()}
          className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-surface-800 disabled:text-surface-600 rounded transition-colors whitespace-nowrap"
        >
          {fetching ? 'Fetching…' : 'Fetch WSDL'}
        </button>
      </div>

      {fetchError && (
        <p className="text-xs text-red-400">{fetchError}</p>
      )}

      {/* Operation selector */}
      {operations.length > 0 && (
        <div className="flex gap-2 items-center">
          <label className="text-xs text-surface-600 whitespace-nowrap">Operation</label>
          <select
            value={soap.operationName ?? ''}
            onChange={e => selectOperation(e.target.value)}
            className="flex-1 text-xs bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500"
          >
            {operations.map(op => (
              <option key={op.name} value={op.name}>{op.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* SOAPAction */}
      <div className="flex gap-2 items-center">
        <label className="text-xs text-surface-600 whitespace-nowrap">SOAPAction</label>
        <input
          value={soap.soapAction ?? ''}
          onChange={e => updateSoap({ soapAction: e.target.value })}
          placeholder="(auto-filled from WSDL)"
          className="flex-1 text-xs bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 placeholder-surface-600 font-mono"
        />
      </div>

      {/* XML envelope editor */}
      <div>
        <p className="text-xs text-surface-600 mb-1">Envelope</p>
        <div className="rounded overflow-hidden border border-surface-700" style={{ minHeight: 200 }}>
          <CodeMirror
            value={soap.envelope ?? ''}
            height="200px"
            theme={oneDark}
            extensions={[xml()]}
            onChange={val => updateSoap({ envelope: val })}
            basicSetup={{ lineNumbers: true, foldGutter: true }}
          />
        </div>
      </div>
    </div>
  );
}
