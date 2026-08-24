// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useState, useEffect } from 'react';
import { useStore } from '../../store';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { oneDark } from '@codemirror/theme-one-dark';
import { getStatusColor, getMethodColor } from '../../../../shared/colors';
import type { HistoryEntry } from '../../../../shared/types';
import { InteractiveBody } from './InteractiveBody';
import { StreamView } from './StreamView';
import { HookResultsPanel } from './HookResultsPanel';
import { SaveAsMockModal } from './SaveAsMockModal';
import { DiffView } from './DiffView';
import { TestsPanel } from './TestsPanel';
import { RequestPanel } from './RequestPanel';
import { ConsolePanel } from './ConsolePanel';
import { prettyJson, prettyXml } from './utils/formatters';
import { appendSnippetToScript } from '../RequestBuilder/scriptAppend';
import { useToast } from '../common/Toast';
import { ContextMenu } from '../common/ContextMenu';
import { Modal } from '../common/Modal';
import { validateHttpSemantics } from '../../../../shared/http-semantics';

const { electron } = window;

/** XML well-formedness via the browser's native DOMParser. Injected into the
 *  HTTP-semantics check and used for the body parse-error indicator. */
function xmlWellFormed(body: string): boolean {
  try {
    const doc = new DOMParser().parseFromString(body, 'application/xml');
    return doc.getElementsByTagName('parsererror').length === 0;
  } catch {
    return true; // cannot check: do not flag
  }
}

function requestBodyText(body: HistoryEntry['request']['body']): string {
  switch (body?.mode) {
    case 'json': return body.json ?? '';
    case 'raw': return body.raw ?? '';
    case 'graphql': return body.graphql?.query ?? '';
    case 'soap': return body.soap?.envelope ?? '';
    case 'form': return (body.form ?? []).filter(p => p.enabled && p.key).map(p => `${p.key}=${p.value}`).join('\n');
    default: return '';
  }
}

function KVBlock({ label, rows }: { label: string; rows: [string, string][] }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-surface-600 font-medium">{label}</span>
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2 font-mono text-[10px]">
          <span className="text-surface-500 shrink-0">{k}:</span>
          <span className="text-surface-300 break-all">{v}</span>
        </div>
      ))}
    </div>
  );
}

/** One history entry, expandable to show the full request and response.
 *  Loading brings the response back into the main viewer. */
function HistoryTabRow({ entry, onLoad, onResend }: { entry: HistoryEntry; onLoad: () => void; onResend?: () => void }) {
  const [open, setOpen] = useState(false);
  const reqBody = requestBodyText(entry.request.body);
  return (
    <div className="border-b border-surface-800">
      <div className="flex items-center gap-3 px-4 py-2 hover:bg-surface-800/40">
        <button onClick={() => setOpen(o => !o)} className="text-surface-600 text-xs w-3 shrink-0">{open ? '▾' : '▸'}</button>
        <span className={`text-[10px] font-bold font-mono shrink-0 w-10 ${getMethodColor(entry.request.method)}`}>{entry.request.method}</span>
        <span className={`text-xs font-bold font-mono shrink-0 w-8 ${getStatusColor(entry.response.status)}`}>{entry.response.status || 'ERR'}</span>
        <span className="text-xs text-surface-400 shrink-0">{entry.response.durationMs}ms</span>
        <span className="text-[11px] text-surface-500 shrink-0">{(entry.response.bodySize / 1024).toFixed(1)} KB</span>
        {entry.environmentName && (
          <span className="text-[10px] bg-surface-800 text-surface-400 px-1.5 py-0.5 rounded shrink-0">{entry.environmentName}</span>
        )}
        <span className="text-[11px] text-surface-500 ml-auto shrink-0">
          {new Date(entry.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
        <button onClick={onLoad} title="Load this response into the viewer" className="text-[10px] text-blue-400 hover:text-blue-300 shrink-0">load</button>
        {onResend && (
          <button onClick={onResend} title="Send this request again" className="text-[10px] text-emerald-400 hover:text-emerald-300 shrink-0">resend</button>
        )}
      </div>
      {open && (
        <div className="px-4 pb-3 pt-1 flex flex-col gap-3 bg-surface-950/40">
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Request</span>
            <p className="font-mono text-[10px] text-surface-300 break-all">{entry.request.method} {entry.resolvedUrl}</p>
            <KVBlock label="Headers" rows={entry.request.headers.filter(h => h.enabled && h.key).map(h => [h.key, h.value])} />
            {reqBody && (
              <pre className="text-[10px] font-mono text-surface-300 bg-surface-900 border border-surface-800 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{reqBody}</pre>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Response</span>
            <p className="font-mono text-[10px]"><span className={getStatusColor(entry.response.status)}>{entry.response.status} {entry.response.statusText}</span></p>
            <KVBlock label="Headers" rows={Object.entries(entry.response.headers)} />
            {entry.response.body && (
              <pre className="text-[10px] font-mono text-surface-300 bg-surface-900 border border-surface-800 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-words max-h-56 overflow-y-auto">{entry.response.body}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type RespTab = 'body' | 'headers' | 'tests' | 'console' | 'request' | 'history' | 'http' | 'error'

export function ResponseViewer() {
  const activeTab = useStore(s => s.tabs.find(t => t.id === s.activeTabId));
  const activeTabId = useStore(s => s.activeTabId);
  const pinnedResponse = useStore(s => s.pinnedResponse);
  const setPinned = useStore(s => s.setPinnedResponse);
  const updateRequest = useStore(s => s.updateRequest);
  const setTabRequestTab = useStore(s => s.setTabRequestTab);
  const setTabScriptTab = useStore(s => s.setTabScriptTab);
  const isSending = activeTab?.isSending ?? false;
  const liveStream = useStore(s => s.liveStream);
  const streamForTab = liveStream && liveStream.tabId === activeTabId ? liveStream : null;
  const response = activeTab?.lastResponse ?? null;
  const scriptResult = activeTab?.lastScriptResult ?? null;
  const sentRequest = activeTab?.lastSentRequest ?? null;
  const hookResults = activeTab?.lastHookResults ?? null;
  const requestId = activeTab?.requestId ?? null;
  const setTabResponse = useStore(s => s.setTabResponse);
  const requestSend = useStore(s => s.requestSend);
  const history = useStore(s => s.history);
  const activeEnvironmentId = useStore(s => s.activeEnvironmentId);
  const environments = useStore(s => s.environments);
  const upsertEnvVar = useStore(s => s.upsertEnvVar);
  const [tab, setTab] = useState<RespTab>('body');

  // Past responses for THIS request (Bruno-style per-request history).
  const requestHistory = requestId ? history.filter(e => e.request.id === requestId) : [];

  // HTTP semantics: passive RFC conformance check on the current response.
  const httpFindings = response && !response.error
    ? validateHttpSemantics({
        method: sentRequest?.method ?? 'GET',
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: response.body,
        bodySize: response.bodySize,
      }, { checkXml: xmlWellFormed })
    : [];
  const httpErrors = httpFindings.filter(x => x.severity === 'error').length;

  // Right-click a response header to create an environment variable from it.
  const [headerMenu, setHeaderMenu] = useState<{ x: number; y: number; key: string; value: string } | null>(null);
  const [varDialog, setVarDialog] = useState<{ name: string; value: string } | null>(null);
  const activeEnvName = activeEnvironmentId ? environments[activeEnvironmentId]?.data.name : undefined;

  // Auto-switch to Console when a script error occurs
  useEffect(() => {
    if (scriptResult?.preScriptError || scriptResult?.postScriptError) {
      setTab('console');
    }
  }, [scriptResult?.preScriptError, scriptResult?.postScriptError]);

  // A transport-level failure (no HTTP response) lands on the Error tab, but
  // Request and History stay reachable so you can still inspect what was sent
  // or jump back to a past response. Leave the Error tab once a real response
  // replaces the failure.
  useEffect(() => {
    if (response?.error) {
      if (tab !== 'request' && tab !== 'history') setTab('error');
    } else if (tab === 'error') {
      setTab('body');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  const [diffMode, setDiffMode] = useState(false);
  const [showMockModal, setShowMockModal] = useState(false);
  const [bodyView, setBodyView] = useState<'tree' | 'raw'>('raw');
  const assertToast = useToast(2500);
  const contractToast = useToast(2500);

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
    contractToast.show('✓ Contract saved', true);
  }

  function handleAssert(snippet: string) {
    if (!requestId) return;
    const state = useStore.getState();
    const req = Object.values(state.collections)
      .find(c => c.data.requests[requestId])?.data.requests[requestId];
    if (!req) return;
    const existing = req.postRequestScript ?? '';
    updateRequest(requestId, { postRequestScript: appendSnippetToScript(existing, snippet) });
    if (activeTabId) {
      setTabRequestTab(activeTabId, 'scripts');
      setTabScriptTab(activeTabId, 'post');
    }
    // Coming from the response tree means the user already chose what to
    // insert — fold the Quick Inserts sidebar so it doesn't crowd the editor
    // they're now looking at. They can reopen it with the Snippets toggle.
    state.setQuickInsertsOpen(false);
    assertToast.show('✓ Assertion added', true);
  }

  if (isSending) {
    // A streaming response renders live while the request is still open; a plain
    // request just shows the spinner until it resolves.
    if (streamForTab && (streamForTab.streaming || streamForTab.events.length > 0)) {
      return (
        <StreamView
          events={streamForTab.events}
          streaming={streamForTab.streaming}
          streamId={streamForTab.streamId}
        />
      );
    }
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

  const contentType = response.headers['content-type'] ?? '';
  const isJson = contentType.includes('json');
  const isXml = !isJson && (contentType.includes('xml') || contentType.includes('html'));
  const supportsTree = isJson || isXml;
  const displayBody = isJson ? prettyJson(response.body) : isXml ? prettyXml(response.body) : response.body;

  // Body parse error (for a red ! on the Body tab, regardless of tree/raw view).
  const bodyParseError = response.body.trim().length > 0 && (
    (isJson && (() => { try { JSON.parse(response.body); return false; } catch { return true; } })()) ||
    (isXml && contentType.includes('xml') && !xmlWellFormed(response.body))
  );

  const passedCount = scriptResult?.testResults.filter(t => t.passed).length ?? 0;
  const totalCount = scriptResult?.testResults.length ?? 0;
  const consoleCount = scriptResult?.consoleOutput.length ?? 0;
  const hasScriptError = !!(scriptResult?.preScriptError || scriptResult?.postScriptError);

  const historyBadge = requestHistory.length > 0 ? requestHistory.length : undefined;
  const tabList: { id: RespTab; label: string; badge?: number | string; error?: boolean }[] = response.error
    ? [
        { id: 'error', label: 'Error', error: true },
        { id: 'request', label: 'Request' },
        { id: 'history', label: 'History', badge: historyBadge },
      ]
    : [
        { id: 'request', label: 'Request' },
        { id: 'body', label: 'Body', badge: bodyParseError ? '!' : undefined, error: bodyParseError },
        { id: 'headers', label: 'Headers' },
        { id: 'tests', label: 'Tests', badge: totalCount > 0 ? `${passedCount}/${totalCount}` : undefined },
        { id: 'console', label: 'Console', badge: hasScriptError ? '!' : consoleCount > 0 ? consoleCount : undefined, error: hasScriptError },
        { id: 'history', label: 'History', badge: historyBadge },
        { id: 'http', label: 'HTTP', badge: httpFindings.length > 0 ? (httpErrors > 0 ? '!' : httpFindings.length) : undefined, error: httpErrors > 0 },
      ];

  // Shared by the normal History tab and the error view's History tab.
  const historyContent = requestHistory.length === 0 ? (
    <p className="text-xs text-surface-500 text-center p-8">
      No past responses for this request yet. Each send is recorded here.
    </p>
  ) : (
    <div className="flex flex-col">
      {requestHistory.map(entry => (
        <HistoryTabRow
          key={entry.id}
          entry={entry}
          onLoad={() => { if (activeTabId) setTabResponse(activeTabId, entry.response, entry.scriptResult ?? null); }}
          onResend={requestSend}
        />
      ))}
    </div>
  );

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


        {!response.error && <div className="ml-auto flex items-center gap-1 shrink-0">
          {/* Toasts */}
          {assertToast.toast && (
            <span className="text-[10px] text-emerald-400 font-medium px-1">{assertToast.toast.msg}</span>
          )}
          {contractToast.toast && (
            <span className="text-[10px] text-blue-400 font-medium px-1">{contractToast.toast.msg}</span>
          )}

          {/* Tree / Raw toggle — only for body tab with JSON or XML (not streams) */}
          {tab === 'body' && supportsTree && !response.streamed && (
            <div className="flex rounded overflow-hidden border border-surface-800 mr-1">
              <button
                onClick={() => setBodyView('tree')}
                className={`px-2 py-0.5 text-[10px] transition-colors ${bodyView === 'tree' ? 'bg-surface-700 text-white' : 'text-surface-600 hover:text-white'}`}
                title="Interactive tree view - click values to add assertions"
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
        </div>}
      </div>

      {showMockModal && <SaveAsMockModal onClose={() => setShowMockModal(false)} />}

      {/* Content — flex-col so each panel can fill remaining height cleanly */}
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
        {response.error ? (
          tab === 'request' ? (
            <RequestPanel sentRequest={sentRequest} />
          ) : tab === 'history' ? (
            <div className="flex-1 min-h-0 overflow-y-auto">{historyContent}</div>
          ) : (
            <div className="flex flex-col p-4 gap-2">
              <div className="text-red-400 text-sm font-medium">Request failed</div>
              <pre className="text-xs text-red-300 whitespace-pre-wrap">{response.error}</pre>
            </div>
          )
        ) : diffMode && pinnedResponse ? (
          <DiffView pinned={pinnedResponse} current={response} />
        ) : tab === 'body' && response.streamed ? (
          <StreamView
            events={response.events ?? []}
            streaming={false}
            streamClose={response.streamClose}
            firstEventMs={response.firstEventMs}
          />
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
                  <tr
                    key={k}
                    className="border-b border-surface-800 hover:bg-surface-800/40"
                    onContextMenu={e => {
                      e.preventDefault();
                      setHeaderMenu({ x: e.clientX, y: e.clientY, key: k, value: v });
                    }}
                    title="Right-click to create an environment variable"
                  >
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
        ) : tab === 'http' ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {httpFindings.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                <span className="text-2xl">✓</span>
                <p className="text-sm text-emerald-400">Conforms to HTTP semantics</p>
                <p className="text-xs text-surface-500 max-w-sm">No violations of the HTTP specification (RFC 9110/9111) in this response. This check is automatic and needs no test or spec.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-w-3xl">
                {httpFindings.map((find, i) => {
                  const tone = find.severity === 'error' ? 'border-red-800/60 bg-red-950/20'
                    : find.severity === 'warning' ? 'border-amber-800/50 bg-amber-950/20'
                    : 'border-surface-700 bg-surface-800/40';
                  const label = find.severity === 'error' ? 'text-red-400'
                    : find.severity === 'warning' ? 'text-amber-400' : 'text-surface-400';
                  return (
                    <div key={i} className={`border-l-2 rounded-r px-3 py-2 ${tone}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${label}`}>{find.severity}</span>
                        <span className="text-[10px] font-mono text-surface-500 bg-surface-900 px-1.5 py-0.5 rounded">{find.rule}</span>
                        {find.ref && <span className="text-[10px] text-surface-600 ml-auto">{find.ref}</span>}
                      </div>
                      <p className="text-xs text-surface-200 mt-1">{find.message}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : tab === 'history' ? (
          <div className="flex-1 min-h-0 overflow-y-auto">{historyContent}</div>
        ) : null}
      </div>

      {/* Header right-click: create environment variable */}
      {headerMenu && (
        <ContextMenu
          x={headerMenu.x}
          y={headerMenu.y}
          onClose={() => setHeaderMenu(null)}
          items={[
            { type: 'header', label: headerMenu.key },
            activeEnvironmentId
              ? {
                  type: 'item',
                  label: `Create variable in "${activeEnvName}"`,
                  onClick: () => {
                    setVarDialog({ name: headerMenu.key.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''), value: headerMenu.value });
                    setHeaderMenu(null);
                  },
                }
              : { type: 'header', label: 'Select an environment first' },
          ]}
        />
      )}

      {/* Name the new environment variable */}
      {varDialog && (
        <Modal onClose={() => setVarDialog(null)} title="Create environment variable" panelClassName="bg-surface-900 border border-surface-800 rounded-lg shadow-2xl w-[420px]">
          <div className="flex flex-col gap-3 p-4">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-surface-600 font-medium">Variable name</span>
              <input
                autoFocus
                value={varDialog.name}
                onChange={e => setVarDialog(d => d && { ...d, name: e.target.value })}
                className="bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-surface-600 font-medium">Value</span>
              <input
                value={varDialog.value}
                onChange={e => setVarDialog(d => d && { ...d, value: e.target.value })}
                className="bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-500"
              />
            </label>
            <p className="text-[11px] text-surface-500">
              Saved to {activeEnvName ? `"${activeEnvName}"` : 'the active environment'}. Use it as <code className="text-surface-300">{'{{'}{varDialog.name || 'name'}{'}}'}</code>.
            </p>
            <div className="flex justify-end gap-2 mt-1">
              <button onClick={() => setVarDialog(null)} className="px-3 py-1.5 text-xs text-surface-400 hover:text-surface-200 transition-colors">Cancel</button>
              <button
                onClick={() => {
                  if (activeEnvironmentId && varDialog.name.trim()) {
                    upsertEnvVar(activeEnvironmentId, varDialog.name.trim(), varDialog.value);
                    assertToast.show(`✓ Saved {{${varDialog.name.trim()}}}`, true);
                  }
                  setVarDialog(null);
                }}
                disabled={!varDialog.name.trim()}
                className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50 transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
