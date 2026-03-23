import React, { useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import type { ApiRequest } from '../../../../shared/types'
import { SNIPPET_GROUPS } from './scriptSnippets'
import { atCompletionExtension, varHoverTooltipExtension } from './atCompletions'
import { useVarNames } from '../../hooks/useVarNames'
import { useVarValues } from '../../hooks/useVarValues'
import { useStore } from '../../store'

interface Props {
  request: ApiRequest
  onChange: (patch: Partial<ApiRequest>) => void
}

type ScriptType = 'pre' | 'post'

export function ScriptsTab({ request, onChange }: Props) {
  const activeTabId     = useStore(s => s.activeTabId)
  const activeAppTab    = useStore(s => s.tabs.find(t => t.id === s.activeTabId))
  const setTabScriptTab = useStore(s => s.setTabScriptTab)
  const scriptType      = activeAppTab?.scriptTab ?? 'pre'
  const setScriptType   = (t: ScriptType) => { if (activeTabId) setTabScriptTab(activeTabId, t) }
  const [expandedGroup, setExpandedGroup] = useState<string | null>(SNIPPET_GROUPS[0].group)

  const varNames   = useVarNames()
  const varValues  = useVarValues()
  const extensions = useMemo(
    () => [javascript(), atCompletionExtension(varNames), varHoverTooltipExtension(varValues)],
    [varNames, varValues],
  )

  const value = scriptType === 'pre'
    ? (request.preRequestScript ?? '')
    : (request.postRequestScript ?? '')

  function handleChange(code: string) {
    if (scriptType === 'pre') onChange({ preRequestScript: code })
    else onChange({ postRequestScript: code })
  }

  function insertSnippet(code: string) {
    const current = value
    const separator = current.trim() ? '\n\n' : ''
    handleChange(current + separator + code)
  }

  return (
    <div className="flex gap-3 h-full min-h-0">
      {/* Editor pane */}
      <div className="flex flex-col flex-1 min-w-0 gap-2">
        {/* Sub-tabs */}
        <div className="flex gap-0 border-b border-surface-700">
          {(['pre', 'post'] as ScriptType[]).map(t => (
            <button
              key={t}
              onClick={() => setScriptType(t)}
              className={`px-3 py-1 text-xs border-b-2 -mb-px transition-colors ${
                scriptType === t
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-surface-400 hover:text-white'
              }`}
            >
              {t === 'pre' ? 'Pre-request' : 'Post-response'}
            </button>
          ))}
        </div>

        <div className="text-[10px] text-surface-400">
          {scriptType === 'pre'
            ? 'Runs before the request is sent. Use at.variables.set() to generate dynamic data.'
            : 'Runs after the response is received. Use at.test() to assert and at.environment.set() to extract values.'}
        </div>

        <div className="flex-1 rounded overflow-hidden border border-surface-700" style={{ minHeight: 160 }}>
          <CodeMirror
            value={value}
            height="100%"
            theme={oneDark}
            extensions={extensions}
            onChange={handleChange}
            basicSetup={{ lineNumbers: true, foldGutter: false }}
          />
        </div>
      </div>

      {/* Snippets panel */}
      <div className="w-52 flex-shrink-0 flex flex-col overflow-y-auto border-l border-surface-700 pl-2">
        <div className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider mb-2">Snippets</div>
        {SNIPPET_GROUPS.map(group => (
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
  )
}
