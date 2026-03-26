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

import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import type { ApiRequest, RequestBody } from '../../../../shared/types';
import { KVTable } from './KVTable';
import { varCompletionExtension, varHoverTooltipExtension } from './atCompletions';
import { useVarNames } from '../../hooks/useVarNames';
import { useVarValues } from '../../hooks/useVarValues';
import { GraphQLEditor } from './GraphQLEditor';
import { SoapEditor } from './SoapEditor';

type BodyMode = RequestBody['mode']

export function BodyTab({ request, onChange }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void }) {
  const body     = request.body;
  const mode     = body.mode;
  const varNames  = useVarNames();
  const varValues = useVarValues();
  const varExt    = useMemo(
    () => [varCompletionExtension(varNames), varHoverTooltipExtension(varValues)],
    [varNames, varValues],
  );

  function setMode(m: BodyMode) {
    onChange({ body: { ...body, mode: m } });
  }

  return (
    <div className="flex flex-col gap-2 h-full min-h-0">
      {/* Mode selector */}
      <div className="flex gap-3 text-xs flex-shrink-0">
        {(['none', 'json', 'form', 'raw', 'graphql', 'soap'] as BodyMode[]).map(m => (
          <label key={m} className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              value={m}
              checked={mode === m}
              onChange={() => setMode(m)}
              className="accent-blue-500"
            />
            <span className={mode === m ? 'text-white' : 'text-surface-400'}>{m}</span>
          </label>
        ))}
      </div>

      {mode === 'none' && (
        <p className="text-xs text-surface-400">No request body.</p>
      )}

      {mode === 'json' && (
        <div className="rounded overflow-hidden border border-surface-700" style={{ height: 140 }}>
          <CodeMirror
            value={body.json ?? ''}
            height="140px"
            theme={oneDark}
            extensions={[json(), varExt]}
            onChange={val => onChange({ body: { ...body, json: val } })}
            basicSetup={{ lineNumbers: true, foldGutter: false, autocompletion: false }}
          />
        </div>
      )}

      {mode === 'form' && (
        <KVTable
          rows={body.form ?? []}
          onChange={rows => onChange({ body: { ...body, form: rows } })}
          keyPlaceholder="field"
          valuePlaceholder="value"
        />
      )}

      {mode === 'raw' && (
        <div className="flex flex-col gap-1">
          <input
            value={body.rawContentType ?? 'text/plain'}
            onChange={e => onChange({ body: { ...body, rawContentType: e.target.value } })}
            placeholder="Content-Type"
            className="text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1 w-48 focus:outline-none focus:border-blue-500"
          />
          <div className="rounded overflow-hidden border border-surface-700" style={{ height: 120 }}>
            <CodeMirror
              value={body.raw ?? ''}
              height="120px"
              theme={oneDark}
              extensions={[varExt]}
              onChange={val => onChange({ body: { ...body, raw: val } })}
              basicSetup={{ lineNumbers: true, foldGutter: false, autocompletion: false }}
            />
          </div>
        </div>
      )}

      {mode === 'graphql' && (
        <div className="flex-1 min-h-0">
          <GraphQLEditor request={request} onChange={onChange} />
        </div>
      )}

      {mode === 'soap' && (
        <div className="flex-1 min-h-0">
          <SoapEditor request={request} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
