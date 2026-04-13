// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import Ajv from 'ajv';
import type { ApiRequest } from '../../../../shared/types';
import { useStore } from '../../store';

const ajv = new Ajv({ allErrors: true, strict: false });

interface ValidationResult {
  valid: boolean
  errors: { instancePath: string; message?: string }[]
}

interface Props {
  request: ApiRequest
  onChange: (p: Partial<ApiRequest>) => void
}

export function SchemaTab({ request, onChange }: Props) {
  const activeTab      = useStore(s => s.tabs.find(t => t.id === s.activeTabId));
  const lastResponse   = activeTab?.lastResponse ?? null;
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [error, setError]   = useState<string | null>(null);

  const schemaValue = request.schema ?? '';
  const contractSchema = request.contract?.bodySchema ?? '';
  const canDerive = Boolean(contractSchema.trim());

  function setSchema(val: string) {
    onChange({ schema: val });
  }

  function deriveFromContract() {
    if (!canDerive) return;
    setSchema(contractSchema);
  }

  function validate() {
    setError(null);
    setResult(null);

    if (!schemaValue.trim()) {
      setError('No schema defined. Enter a JSON Schema above.');
      return;
    }
    if (!lastResponse) {
      setError('No response yet. Send the request first, then validate.');
      return;
    }

    let schema: unknown;
    try {
      schema = JSON.parse(schemaValue);
    } catch {
      setError('Schema is not valid JSON. Fix the syntax and try again.');
      return;
    }

    let data: unknown;
    try {
      data = JSON.parse(lastResponse.body);
    } catch {
      setError('Response body is not valid JSON and cannot be validated against a schema.');
      return;
    }

    try {
      const validate = ajv.compile(schema as object);
      const valid = validate(data);
      setResult({
        valid: !!valid,
        errors: (validate.errors ?? []).map(e => ({
          instancePath: e.instancePath,
          message: e.message,
        })),
      });
    } catch (e: unknown) {
      setError(`Schema compile error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-surface-600 uppercase tracking-wider font-medium">
          JSON Schema (draft-07+)
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={deriveFromContract}
            disabled={!canDerive}
            title={canDerive
              ? "Copy the body schema from this request's contract"
              : 'No contract body schema defined yet'}
            className="px-3 py-1 text-xs bg-surface-800 hover:bg-surface-700 disabled:bg-surface-900 disabled:text-surface-600 rounded transition-colors font-medium"
          >
            Derive from contract
          </button>
          <button
            onClick={validate}
            className="px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 rounded transition-colors font-medium"
          >
            Validate
          </button>
        </div>
      </div>
      <p className="text-[10px] text-surface-600">
        Standalone schema for ad-hoc validation. Independent of the contract — edits here don&apos;t affect it.
      </p>

      {/* Schema editor */}
      <div className="border border-surface-700 rounded overflow-hidden">
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

      {/* Validation results */}
      {error && (
        <div className="text-xs text-red-400 bg-red-950/50 border border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      {result && (
        <div className={`rounded border px-3 py-2 text-xs ${
          result.valid
            ? 'bg-emerald-900/20 border-emerald-700'
            : 'bg-red-900/20 border-red-700'
        }`}>
          {result.valid ? (
            <span className="text-emerald-400 font-semibold">Valid — response matches the schema.</span>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-red-400 font-semibold">Invalid — {result.errors.length} error{result.errors.length !== 1 ? 's' : ''}</span>
              {result.errors.map((e, i) => (
                <div key={i} className="flex gap-2 text-red-300">
                  <span className="text-red-500 font-mono shrink-0">{e.instancePath || '/'}</span>
                  <span>{e.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
