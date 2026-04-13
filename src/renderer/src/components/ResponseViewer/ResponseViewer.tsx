// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { useState, useEffect } from 'react';
import { useStore } from '../../store';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { oneDark } from '@codemirror/theme-one-dark';
import { getStatusColor } from '../../../../shared/colors';
import { InteractiveBody } from './InteractiveBody';
import { HookResultsPanel } from './HookResultsPanel';
import { SaveAsMockModal } from './SaveAsMockModal';
import { DiffView } from './DiffView';
import { TestsPanel } from './TestsPanel';
import { RequestPanel } from './RequestPanel';
import { ConsolePanel } from './ConsolePanel';
import { prettyJson, prettyXml } from './utils/formatters';

const { electron } = window;

type RespTab = 'body' | 'headers' | 'tests' | 'console' | 'request'

export function ResponseViewer() {
  const activeTab = useStore(s => s.tabs.find(t => t.id === s.activeTabId));
  const activeTabId = useStore(s => s.activeTabId);
  const pinnedResponse = useStore(s => s.pinnedResponse);
  const setPinned = useStore(s => s.setPinnedResponse);
  const updateRequest = useStore(s => s.updateRequest);
  const setTabRequestTab = useStore(s => s.setTabRequestTab);
  const setTabScriptTab = useStore(s => s.setTabScriptTab);
  const isSending = activeTab?.isSending ?? false;
  const response = activeTab?.lastResponse ?? null;
  const scriptResult = activeTab?.lastScriptResult ?? null;
  const sentRequest = activeTab?.lastSentRequest ?? null;
  const hookResults = activeTab?.lastHookResults ?? null;
  const requestId = activeTab?.requestId ?? null;
  const [tab, setTab] = useState<RespTab>('body');

  // Auto-switch to Console when a script error occurs
  useEffect(() => {
    if (scriptResult?.preScriptError || scriptResult?.postScriptError) {
      setTab('console');
    }
  }, [scriptResult?.preScriptError, scriptResult?.postScriptError]);

  const [diffMode, setDiffMode] = useState(false);
  const [showMockModal, setShowMockModal] = useState(false);
  const [bodyView, setBodyView] = useState<'tree' | 'raw'>('raw');
  const [assertToast, setAssertToast] = useState(false);
  const [contractToast, setContractToast] = useState(false);

  async function saveAsContract() {
    if (!response || !requestId || !activeTabId) return;
    const schema: string | null = response.body
      ? await electron.inferContractSchema(response.body)
      : null;
    const contentType = response.headers['content-type'];
    const headers: { key: string; value: string; required: boolean }[] = contentType
      ? [{ key: 'content-type', value: contentType, required: true }]
      : [];
    updateRequest(requestId, {
      contract: {
        statusCode: response.status,
        headers,
        bodySchema: schema ?? '',
      },
    });
    setTabRequestTab(activeTabId, 'contract');
    setContractToast(true);
    setTimeout(() => setContractToast(false), 2500);
  }

  function handleAssert(snippet: string) {
    if (!requestId) return;
    const state = useStore.getState();
    const req = Object.values(state.collections)
      .find(c => c.data.requests[requestId])?.data.requests[requestId];
    if (!req) return;
    const existing = req.postRequestScript ?? '';
    // If the script already declares `const json = sp.response.json()`,
    // strip the duplicate declaration from the incoming snippet so we
    // don't redeclare the variable on every assertion added from the tree.
    let cleaned = snippet;
    if (existing.includes('const json = sp.response.json()')) {
      cleaned = cleaned
        .replace(/^\s*const json = sp\.response\.json\(\);?\s*\n?/m, '')
        .replace(/\n\s*const json = sp\.response\.json\(\);?\s*\n/g, '\n');
    }
    const sep = existing.trim() ? '\n\n' : '';
    updateRequest(requestId, { postRequestScript: existing + sep + cleaned });
    if (activeTabId) {
      setTabRequestTab(activeTabId, 'scripts');
      setTabScriptTab(activeTabId, 'post');
    }
    setAssertToast(true);
    setTimeout(() => setAssertToast(false), 2500);
  }

  if (isSending) {
    return (
      <div className="h-full flex items-center justify-center text-surface-400 text-sm">
        Sending...
      </div>
    );
  }

  if (!response) {
    return (
      <div className="h-full flex items-center justify-center text-surface-400 text-sm">
        Hit Send to see the response
      </div>
    );
  }

  if (response.error) {
    return (
      <div className="h-full flex flex-col p-4 gap-2">
        <div className="text-red-400 text-sm font-medium">Request failed</div>
        <pre className="text-xs text-red-300 whitespace-pre-wrap">{response.error}</pre>
      </div>
    );
  }

  const contentType = response.headers['content-type'] ?? '';
  const isJson = contentType.includes('json');
  const isXml = !isJson && (contentType.includes('xml') || contentType.includes('html'));
  const supportsTree = isJson || isXml;
  const displayBody = isJson ? prettyJson(response.body) : isXml ? prettyXml(response.body) : response.body;

  const passedCount = scriptResult?.testResults.filter(t => t.passed).length ?? 0;
  const totalCount = scriptResult?.testResults.length ?? 0;
  const consoleCount = scriptResult?.consoleOutput.length ?? 0;
  const hasScriptError = !!(scriptResult?.preScriptError || scriptResult?.postScriptError);

  const tabList: { id: RespTab; label: string; badge?: number | string; error?: boolean }[] = [
    { id: 'request', label: 'Request' },
    { id: 'body', label: 'Body' },
    { id: 'headers', label: 'Headers' },
    { id: 'tests', label: 'Tests', badge: totalCount > 0 ? `${passedCount}/${totalCount}` : undefined },
    { id: 'console', label: 'Console', badge: hasScriptError ? '!' : consoleCount > 0 ? consoleCount : undefined, error: hasScriptError },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Hook results */}
      {hookResults && hookResults.length > 0 && (
        <HookResultsPanel results={hookResults} />
      )}

      {/* Status bar */}
      <div className="flex items-center gap-4 px-4 py-1.5 border-b border-surface-800 flex-shrink-0 overflow-x-auto">
        <span className={`text-sm font-bold shrink-0 ${getStatusColor(response.status)}`}>
          {response.status} {response.statusText}
        </span>
        <span className="text-xs text-surface-400 shrink-0">{response.durationMs}ms</span>
        <span className="text-xs text-surface-400 shrink-0">{(response.bodySize / 1024).toFixed(1)} KB</span>

        <div className="flex gap-0 ml-2 shrink-0">
          {tabList.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1 text-xs rounded transition-colors flex items-center gap-1 ${tab === t.id ? 'bg-surface-800 text-white' : 'text-surface-400 hover:text-white'
                }`}
            >
              {t.label}
              {t.badge !== undefined && (
                <span className={`text-[10px] px-1 rounded ${
                  t.error ? 'bg-red-800 text-red-200'
                  : t.id === 'tests' && passedCount < totalCount ? 'bg-red-800 text-red-200'
                  : 'bg-surface-700 text-white'
                }`}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>


        <div className="ml-auto flex items-center gap-1 shrink-0">
          {/* Toasts */}
          {assertToast && (
            <span className="text-[10px] text-emerald-400 font-medium px-1">✓ Assertion added</span>
          )}
          {contractToast && (
            <span className="text-[10px] text-blue-400 font-medium px-1">✓ Contract saved</span>
          )}

          {/* Tree / Raw toggle — only for body tab with JSON or XML */}
          {tab === 'body' && supportsTree && (
            <div className="flex rounded overflow-hidden border border-surface-800 mr-1">
              <button
                onClick={() => setBodyView('tree')}
                className={`px-2 py-0.5 text-[10px] transition-colors ${bodyView === 'tree' ? 'bg-surface-700 text-white' : 'text-surface-600 hover:text-white'}`}
                title="Interactive tree view — click values to add assertions"
              >
                Tree
              </button>
              <button
                onClick={() => setBodyView('raw')}
                className={`px-2 py-0.5 text-[10px] transition-colors ${bodyView === 'raw' ? 'bg-surface-700 text-white' : 'text-surface-600 hover:text-white'}`}
                title="Raw body view"
              >
                Raw
              </button>
            </div>
          )}

          {/* Pin button */}
          <button
            onClick={() => setPinned(response)}
            title="Pin this response to compare against later responses"
            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${pinnedResponse === response
              ? 'bg-blue-700 text-white'
              : 'bg-surface-800 hover:bg-surface-700'
              }`}
          >
            Pin
          </button>

          {/* Diff toggle — only when a pinned response exists */}
          {pinnedResponse && (
            <button
              onClick={() => setDiffMode(d => !d)}
              title="Toggle diff view against pinned response"
              className={`px-2 py-0.5 text-[10px] rounded transition-colors ${diffMode
                ? 'bg-amber-700 text-white'
                : 'bg-surface-800 hover:bg-surface-700'
                }`}
            >
              Diff
            </button>
          )}

          <button
            onClick={saveAsContract}
            className="px-2 py-0.5 text-[10px] bg-surface-800 hover:bg-surface-700 rounded transition-colors"
            title="Capture this response as a contract expectation"
          >
            ↓ Contract
          </button>
          <button
            onClick={() => setShowMockModal(true)}
            className="px-2 py-0.5 text-[10px] bg-surface-800 hover:bg-surface-700 rounded transition-colors"
            title="Save this response as a mock route"
          >
            ↓ Mock
          </button>
        </div>
      </div>

      {showMockModal && <SaveAsMockModal onClose={() => setShowMockModal(false)} />}

      {/* Content — flex-col so each panel can fill remaining height cleanly */}
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
        {diffMode && pinnedResponse ? (
          <DiffView pinned={pinnedResponse} current={response} />
        ) : tab === 'body' && supportsTree && bodyView === 'tree' ? (
          <InteractiveBody
            body={response.body}
            contentType={contentType}
            onAssert={handleAssert}
          />
        ) : tab === 'body' ? (
          <CodeMirror
            value={displayBody}
            theme={oneDark}
            extensions={isJson ? [json()] : isXml ? [xml()] : []}
            readOnly
            basicSetup={{ lineNumbers: true, foldGutter: true }}
          />
        ) : tab === 'headers' ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <table className="w-full text-xs px-4 py-2">
              <tbody>
                {Object.entries(response.headers).map(([k, v]) => (
                  <tr key={k} className="border-b border-surface-800">
                    <td className="py-1.5 px-4 text-surface-400 font-mono w-56 align-top">{k}</td>
                    <td className="py-1.5 px-4 text-white font-mono break-all">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : tab === 'tests' ? (
          <TestsPanel scriptResult={scriptResult} />
        ) : tab === 'console' ? (
          <ConsolePanel scriptResult={scriptResult} />
        ) : tab === 'request' ? (
          <RequestPanel sentRequest={sentRequest} />
        ) : null}
      </div>
    </div>
  );
}
