// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import type { ApiRequest } from '../../../../shared/types';
import { SNIPPET_GROUPS } from './scriptSnippets';
import { appendSnippetToScript } from './scriptAppend';
import { atCompletionExtension, varHoverTooltipExtension } from './atCompletions';
import { useVarNames } from '../../hooks/useVarNames';
import { useVarValues } from '../../hooks/useVarValues';
import { useStore } from '../../store';

interface Props {
  request: ApiRequest
  onChange: (patch: Partial<ApiRequest>) => void
}

type ScriptType = 'pre' | 'post' | 'gql'

export function ScriptsTab({ request, onChange }: Props) {
  const activeTabId     = useStore(s => s.activeTabId);
  const activeAppTab    = useStore(s => s.tabs.find(t => t.id === s.activeTabId));
  const setTabScriptTab = useStore(s => s.setTabScriptTab);
  const scriptType      = activeAppTab?.scriptTab ?? 'pre';
  const setScriptType   = (t: ScriptType) => { if (activeTabId) setTabScriptTab(activeTabId, t); };
  const [expandedGroup, setExpandedGroup] = useState<string | null>(SNIPPET_GROUPS[0].group);
  const [snippetsOpen, setSnippetsOpen] = useState(true);

  const varNames   = useVarNames();
  const varValues  = useVarValues();
  const extensions = useMemo(
    () => [javascript(), atCompletionExtension(varNames), varHoverTooltipExtension(varValues)],
    [varNames, varValues],
  );

  const isGraphQL = request.body.mode === 'graphql';

  const value = scriptType === 'pre'  ? (request.preRequestScript        ?? '')
              : scriptType === 'post' ? (request.postRequestScript        ?? '')
              :                         (request.graphqlIntrospectionScript ?? '');

  function handleChange(code: string) {
    if (scriptType === 'pre')  onChange({ preRequestScript:         code });
    else if (scriptType === 'post') onChange({ postRequestScript:   code });
    else                            onChange({ graphqlIntrospectionScript: code });
  }

  function insertSnippet(code: string) {
    // Post-script snippets: route through appendSnippetToScript so
    // `const json = sp.response.json();` is hoisted once rather than
    // duplicated inside every sp.test block.
    if (scriptType === 'post') {
      handleChange(appendSnippetToScript(value, code));
    } else {
      const separator = value.trim() ? '\n\n' : '';
      handleChange(value + separator + code);
    }
  }

  return (
    <div className="flex gap-3 h-full min-h-0">
      {/* Editor pane */}
      <div className="flex flex-col flex-1 min-w-0 gap-2">
        {/* Sub-tabs */}
        <div className="flex gap-0 border-b border-surface-700">
          {(['pre', 'post', ...(isGraphQL ? ['gql' as ScriptType] : [])] as ScriptType[]).map(t => (
            <button
              key={t}
              onClick={() => setScriptType(t)}
              className={`px-3 py-1 text-xs border-b-2 -mb-px transition-colors ${
                scriptType === t
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-surface-400 hover:text-white'
              }`}
            >
              {t === 'pre' ? 'Pre-request' : t === 'post' ? 'Post-response' : 'GQL Introspect'}
            </button>
          ))}
        </div>

        <div className="text-[10px] text-surface-400">
          {scriptType === 'pre'  && 'Runs before the request is sent. Use sp.variables.set() to generate dynamic data.'}
          {scriptType === 'post' && 'Runs after the response is received. Use sp.test() to assert and sp.environment.set() to extract values.'}
          {scriptType === 'gql'  && 'Runs before GraphQL schema introspection. Use sp.environment.set() or sp.collectionVariables.set() to inject auth headers or tokens.'}
        </div>

        <div className="flex-1 rounded overflow-hidden border border-surface-700" style={{ minHeight: 160 }}>
          <CodeMirror
            value={value}
            height="100%"
            theme={oneDark}
            extensions={extensions}
            onChange={handleChange}
            basicSetup={{ lineNumbers: true, foldGutter: false, autocompletion: false }}
          />
        </div>
      </div>

      {/* Snippets panel */}
      <div className={`flex-shrink-0 flex flex-col border-l border-surface-700 transition-all ${snippetsOpen ? 'w-52 pl-2 overflow-y-auto' : 'w-7'}`}>
        {snippetsOpen ? (
          <button
            onClick={() => setSnippetsOpen(false)}
            className="flex items-center gap-1 text-[10px] font-semibold text-surface-400 uppercase tracking-wider mb-2 hover:text-white transition-colors w-full"
          >
            <span>▾</span>
            <span>Quick inserts</span>
          </button>
        ) : (
          <button
            onClick={() => setSnippetsOpen(true)}
            className="flex-1 flex items-center justify-center hover:bg-surface-800 transition-colors rounded-sm"
            title="Expand quick inserts"
          >
            <span className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider [writing-mode:vertical-rl] rotate-180">
              Quick inserts
            </span>
          </button>
        )}
        {snippetsOpen && SNIPPET_GROUPS.map(group => (
          <div key={group.group} className="mb-1">
            <button
              onClick={() => setExpandedGroup(prev => prev === group.group ? null : group.group)}
              className="w-full text-left text-xs font-medium text-surface-400 hover:text-white flex items-center justify-between py-0.5"
            >
              <span>{group.group}</span>
              <span className="text-[10px]">{expandedGroup === group.group ? '▾' : '▸'}</span>
            </button>
            {expandedGroup === group.group && (
              <div className="flex flex-col gap-0.5 mt-0.5">
                {group.items.map(item => (
                  <button
                    key={item.label}
                    onClick={() => insertSnippet(item.code)}
                    className="text-left text-[11px] text-blue-400 hover:text-blue-300 px-1 py-0.5 rounded hover:bg-surface-800 transition-colors"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

