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
import { ResponseTable, bodyHasArray } from './ResponseTable';
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
import { OverflowMenu } from '../common/OverflowMenu';
import { DotsHorizontalIcon } from '../common/icons';
import { Modal } from '../common/Modal';
import { validateHttpSemantics } from '../../../../shared/http-semantics';
import { useT } from '../../i18n';

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
    case 'grpc': return body.grpc?.message ?? '';
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
  const t = useT();
  const [open, setOpen] = useState(false);
  const reqBody = requestBodyText(entry.request.body);
  return (
    <div className="border-b border-surface-800">
      <div className="flex items-center gap-3 px-4 py-2 hover:bg-surface-800/40">
        <button onClick={() => setOpen(o => !o)} className="text-surface-600 text-[22px] leading-none w-3 shrink-0">{open ? '▾' : '▸'}</button>
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
        <button onClick={onLoad} title={t('Load this response into the viewer')} className="text-[10px] text-blue-400 hover:text-blue-300 shrink-0">{t('load')}</button>
        {onResend && (
          <button onClick={onResend} title={t('Send this request again')} className="text-[10px] text-emerald-400 hover:text-emerald-300 shrink-0">{t('resend')}</button>
        )}
      </div>
      {open && (
        <div className="px-4 pb-3 pt-1 flex flex-col gap-3 bg-surface-950/40">
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">{t('Request')}</span>
            <p className="font-mono text-[10px] text-surface-300 break-all">{entry.request.method} {entry.resolvedUrl}</p>
            <KVBlock label={t('Headers')} rows={entry.request.headers.filter(h => h.enabled && h.key).map(h => [h.key, h.value])} />
            {reqBody && (
              <pre className="text-[10px] font-mono text-surface-300 bg-surface-900 border border-surface-800 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{reqBody}</pre>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">{t('Response')}</span>
            <p className="font-mono text-[10px]"><span className={getStatusColor(entry.response.status)}>{entry.response.status} {entry.response.statusText}</span></p>
            <KVBlock label={t('Headers')} rows={Object.entries(entry.response.headers)} />
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

// Progressive disclosure driven by the PANEL width (a container query on the
// toolbar), not the viewport — the response panel is independently resizable.
// Primary tabs stay inline; the rest fold into "More" as the panel narrows.
// `@min-[520px]` = medium+, `@min-[720px]` = large. The active tab is always
// forced inline (and dropped from the menu) so it never hides.
const TAB_INLINE_VIS: Record<RespTab, string> = {
  error: 'flex', request: 'flex', body: 'flex', headers: 'flex',
  tests: 'hidden @min-[520px]:flex', console: 'hidden @min-[520px]:flex',
  history: 'hidden @min-[720px]:flex', http: 'hidden @min-[720px]:flex',
};
const TAB_MENU_VIS: Record<RespTab, string> = {
  error: 'hidden', request: 'hidden', body: 'hidden', headers: 'hidden',
  tests: 'flex @min-[520px]:hidden', console: 'flex @min-[520px]:hidden',
  history: 'flex @min-[720px]:hidden', http: 'flex @min-[720px]:hidden',
};

export function ResponseViewer() {
  const t = useT();
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
  const [bodyView, setBodyView] = useState<'tree' | 'raw' | 'table'>('raw');
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
    contractToast.show(t('✓ Contract saved'), true);
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
    assertToast.show(t('✓ Assertion added'), true);
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
        {t('Sending...')}
      </div>
    );
  }

  if (!response) {
    return (
      <div className="h-full flex items-center justify-center text-surface-400 text-sm">
        {t('Hit Send to see the response')}
      </div>
    );
  }

  const contentType = response.headers['content-type'] ?? '';
  const isJson = contentType.includes('json');
  const isXml = !isJson && (contentType.includes('xml') || contentType.includes('html'));
  const supportsTree = isJson || isXml;
  const displayBody = isJson ? prettyJson(response.body) : isXml ? prettyXml(response.body) : response.body;
  // Show the Table view only when the body actually has an array to tabulate.
  // (A plain computation, not a hook: this sits after early returns above.)
  const showTable = supportsTree && !response.streamed && bodyHasArray(response.body, contentType);

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
        { id: 'error', label: t('Error'), error: true },
        { id: 'request', label: t('Request') },
        { id: 'history', label: t('History'), badge: historyBadge },
      ]
    : [
        { id: 'request', label: t('Request') },
        { id: 'body', label: t('Body'), badge: bodyParseError ? '!' : undefined, error: bodyParseError },
        { id: 'headers', label: t('Headers') },
        { id: 'tests', label: t('Tests'), badge: totalCount > 0 ? `${passedCount}/${totalCount}` : undefined },
        { id: 'console', label: t('Console'), badge: hasScriptError ? '!' : consoleCount > 0 ? consoleCount : undefined, error: hasScriptError },
        { id: 'history', label: t('History'), badge: historyBadge },
        { id: 'http', label: t('HTTP'), badge: httpFindings.length > 0 ? (httpErrors > 0 ? '!' : httpFindings.length) : undefined, error: httpErrors > 0 },
      ];

  // Shared by the normal History tab and the error view's History tab.
  const historyContent = requestHistory.length === 0 ? (
    <p className="text-xs text-surface-500 text-center p-8">
      {t('No past responses for this request yet. Each send is recorded here.')}
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

  // One response tab, rendered either inline in the bar or as a row inside the
  // "More" menu; container-query classes pick which, and the active tab is
  // always forced inline (and removed from the menu) so it can never hide.
  function renderTabButton(def: typeof tabList[number], variant: 'inline' | 'menu') {
    const active = tab === def.id;
    const badge = def.badge !== undefined ? (
      <span className={`text-[10px] px-1 rounded ${
        def.error ? 'bg-red-800 text-red-200'
        : def.id === 'tests' && passedCount < totalCount ? 'bg-red-800 text-red-200'
        : 'bg-surface-700 text-white'
      }`}>{def.badge}</span>
    ) : null;
    if (variant === 'menu') {
      return (
        <button
          key={def.id}
          role="menuitem"
          tabIndex={-1}
          onClick={() => setTab(def.id)}
          className={`${active ? 'hidden' : TAB_MENU_VIS[def.id]} w-full items-center justify-between gap-3 px-3 py-1.5 text-xs ${active ? '' : 'text-surface-300 hover:bg-surface-800 hover:text-white'}`}
        >
          <span>{def.label}</span>
          {badge}
        </button>
      );
    }
    return (
      <button
        key={def.id}
        role="tab"
        aria-selected={active}
        onClick={() => setTab(def.id)}
        className={`${active ? 'flex' : TAB_INLINE_VIS[def.id]} px-3 py-1 text-xs rounded transition-colors items-center gap-1 ${active ? 'bg-surface-800 text-white' : 'text-surface-400 hover:text-white'}`}
      >
        {def.label}
        {badge}
      </button>
    );
  }

  // Left/Right arrow navigation across the visible tabs (WAI-ARIA tablist).
  function onTablistKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const btns = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')).filter(el => el.offsetParent !== null);
    const idx = btns.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    if (e.key === 'ArrowRight') btns[(idx + 1) % btns.length]?.focus();
    else if (e.key === 'ArrowLeft') btns[(idx - 1 + btns.length) % btns.length]?.focus();
    else if (e.key === 'Home') btns[0]?.focus();
    else btns[btns.length - 1]?.focus();
  }

  return (
    <div className="h-full flex flex-col">
      {/* Hook results */}
      {hookResults && hookResults.length > 0 && (
        <HookResultsPanel results={hookResults} />
      )}

      {/* Response toolbar. A container query on this wrapper makes the controls
          respond to the PANEL width (it is independently resizable), so the bar
          never scrolls horizontally: tabs and actions fold into overflow menus
          as it narrows. Row 1 = metadata + tabs; row 2 = view label + actions. */}
      <div className="@container flex-shrink-0 border-b border-surface-800">
        {/* Row 1: response metadata + tabs (+ "More" overflow) */}
        <div className="flex items-center gap-3 px-4 py-1.5 min-w-0">
          <div className="flex items-center gap-3 shrink-0">
            <span className={`text-sm font-bold ${getStatusColor(response.status)}`}>
              {response.status}<span className="hidden @min-[440px]:inline"> {response.statusText}</span>
            </span>
            <span className="text-xs text-surface-400">{response.durationMs}ms</span>
            <span className="text-xs text-surface-400">{(response.bodySize / 1024).toFixed(1)} KB</span>
          </div>

          <div role="tablist" aria-label={t('Response sections')} onKeyDown={onTablistKey} className="flex items-center gap-0 min-w-0 ml-1">
            {tabList.map(def => renderTabButton(def, 'inline'))}
            <OverflowMenu
              wrapperClassName="flex @min-[720px]:hidden"
              buttonClassName="px-2 py-1 text-xs rounded text-surface-400 hover:text-white hover:bg-surface-800 flex items-center gap-1"
              button={<>{t('More')} <span aria-hidden="true" className="text-[22px] leading-none">▾</span></>}
              ariaLabel={t('More response sections')}
              align="left"
            >
              {tabList.map(def => renderTabButton(def, 'menu'))}
            </OverflowMenu>
          </div>
        </div>

        {/* Row 2: current view label + body/view actions (+ "…" overflow) */}
        {!response.error && (
          <div className="flex items-center gap-2 px-4 py-1 border-t border-surface-800/60 min-w-0">
            <span className="text-[11px] uppercase tracking-wider text-surface-500 font-medium truncate">
              {tabList.find(x => x.id === tab)?.label ?? t('Body')}
            </span>
            {assertToast.toast && (
              <span className="text-[10px] text-emerald-400 font-medium px-1 shrink-0">{assertToast.toast.msg}</span>
            )}
            {contractToast.toast && (
              <span className="text-[10px] text-blue-400 font-medium px-1 shrink-0">{contractToast.toast.msg}</span>
            )}

            <div className="ml-auto flex items-center gap-1 shrink-0">
              {/* Tree / Raw / Table — a segmented view-mode control (body tab) */}
              {tab === 'body' && supportsTree && !response.streamed && (
                <div role="group" aria-label={t('Body view mode')} className="flex rounded overflow-hidden border border-surface-800 mr-1">
                  <button
                    onClick={() => setBodyView('tree')}
                    aria-pressed={bodyView === 'tree'}
                    className={`px-2 py-0.5 text-[10px] transition-colors ${bodyView === 'tree' ? 'bg-surface-700 text-white' : 'text-surface-600 hover:text-white'}`}
                    title={t('Interactive tree view - click values to add assertions')}
                  >
                    {t('Tree')}
                  </button>
                  <button
                    onClick={() => setBodyView('raw')}
                    aria-pressed={bodyView === 'raw'}
                    className={`px-2 py-0.5 text-[10px] transition-colors ${bodyView === 'raw' ? 'bg-surface-700 text-white' : 'text-surface-600 hover:text-white'}`}
                    title={t('Raw body view')}
                  >
                    {t('Raw')}
                  </button>
                  {showTable && (
                    <button
                      onClick={() => setBodyView('table')}
                      aria-pressed={bodyView === 'table'}
                      className={`px-2 py-0.5 text-[10px] transition-colors ${bodyView === 'table' ? 'bg-surface-700 text-white' : 'text-surface-600 hover:text-white'}`}
                      title={t('Show an array in the response as a sortable table')}
                    >
                      {t('Table')}
                    </button>
                  )}
                </div>
              )}

              {/* Pin — always visible */}
              <button
                onClick={() => setPinned(response)}
                aria-pressed={pinnedResponse === response}
                title={t('Pin this response to compare against later responses')}
                className={`px-2 py-0.5 text-[10px] rounded transition-colors shrink-0 ${pinnedResponse === response ? 'bg-blue-700 text-white' : 'bg-surface-800 hover:bg-surface-700'}`}
              >
                {t('Pin')}
              </button>

              {/* Diff / Contract / Mock — inline while there is room; they are
                  few and small, so they only fold into "…" on a genuinely narrow
                  panel. */}
              {pinnedResponse && (
                <button
                  onClick={() => setDiffMode(d => !d)}
                  aria-pressed={diffMode}
                  title={t('Toggle diff view against pinned response')}
                  className={`hidden @min-[350px]:flex px-2 py-0.5 text-[10px] rounded transition-colors ${diffMode ? 'bg-amber-700 text-white' : 'bg-surface-800 hover:bg-surface-700'}`}
                >
                  {t('Diff')}
                </button>
              )}
              <button
                onClick={saveAsContract}
                className="hidden @min-[350px]:flex px-2 py-0.5 text-[10px] bg-surface-800 hover:bg-surface-700 rounded transition-colors"
                title={t('Capture this response as a contract expectation')}
              >
                ↓ {t('Contract')}
              </button>
              <button
                onClick={() => setShowMockModal(true)}
                className="hidden @min-[350px]:flex px-2 py-0.5 text-[10px] bg-surface-800 hover:bg-surface-700 rounded transition-colors"
                title={t('Save this response as a mock route')}
              >
                ↓ {t('Mock')}
              </button>

              {/* "…" overflow — only appears below the width where Diff/Contract/
                  Mock stop fitting; hidden entirely (no empty button) above it. */}
              <OverflowMenu
                wrapperClassName="flex @min-[350px]:hidden"
                buttonClassName="px-1.5 py-1 text-[10px] rounded bg-surface-800 hover:bg-surface-700 text-surface-300 flex items-center"
                button={<DotsHorizontalIcon />}
                ariaLabel={t('More actions')}
              >
                {pinnedResponse && (
                  <button
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => setDiffMode(d => !d)}
                    className="flex @min-[350px]:hidden w-full items-center gap-2 px-3 py-1.5 text-xs text-surface-300 hover:bg-surface-800 hover:text-white"
                  >
                    {t('Diff')}
                  </button>
                )}
                <button
                  role="menuitem"
                  tabIndex={-1}
                  onClick={saveAsContract}
                  className="flex @min-[350px]:hidden w-full items-center gap-2 px-3 py-1.5 text-xs text-surface-300 hover:bg-surface-800 hover:text-white"
                >
                  ↓ {t('Contract')}
                </button>
                <button
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => setShowMockModal(true)}
                  className="flex @min-[350px]:hidden w-full items-center gap-2 px-3 py-1.5 text-xs text-surface-300 hover:bg-surface-800 hover:text-white"
                >
                  ↓ {t('Mock')}
                </button>
              </OverflowMenu>
            </div>
          </div>
        )}
      </div>

      {showMockModal && <SaveAsMockModal onClose={() => setShowMockModal(false)} />}

      {/* Content — flex-col so each panel can fill remaining height cleanly */}
      <div role="tabpanel" aria-label={tabList.find(x => x.id === tab)?.label} className="flex-1 min-h-0 flex flex-col overflow-y-auto">
        {response.error ? (
          tab === 'request' ? (
            <RequestPanel sentRequest={sentRequest} />
          ) : tab === 'history' ? (
            <div className="flex-1 min-h-0 overflow-y-auto">{historyContent}</div>
          ) : (
            <div className="flex flex-col p-4 gap-2">
              <div className="text-red-400 text-sm font-medium">{t('Request failed')}</div>
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
        ) : tab === 'body' && showTable && bodyView === 'table' ? (
          <ResponseTable body={response.body} contentType={contentType} />
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
                    title={t('Right-click to create an environment variable')}
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
                <p className="text-sm text-emerald-400">{t('Conforms to HTTP semantics')}</p>
                <p className="text-xs text-surface-500 max-w-sm">{t('No violations of the HTTP specification (RFC 9110/9111) in this response. This check is automatic and needs no test or spec.')}</p>
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
                  label: t('Create variable in ":env"', { env: activeEnvName ?? '' }),
                  onClick: () => {
                    setVarDialog({ name: headerMenu.key.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''), value: headerMenu.value });
                    setHeaderMenu(null);
                  },
                }
              : { type: 'header', label: t('Select an environment first') },
          ]}
        />
      )}

      {/* Name the new environment variable */}
      {varDialog && (
        <Modal onClose={() => setVarDialog(null)} title={t('Create environment variable')} panelClassName="bg-surface-900 border border-surface-800 rounded-lg shadow-2xl w-[420px]">
          <div className="flex flex-col gap-3 p-4">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-surface-600 font-medium">{t('Variable name')}</span>
              <input
                autoFocus
                value={varDialog.name}
                onChange={e => setVarDialog(d => d && { ...d, name: e.target.value })}
                className="bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-surface-600 font-medium">{t('Value')}</span>
              <input
                value={varDialog.value}
                onChange={e => setVarDialog(d => d && { ...d, value: e.target.value })}
                className="bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-500"
              />
            </label>
            <p className="text-[11px] text-surface-500">
              {t('Saved to :env. Use it as', { env: activeEnvName ? `"${activeEnvName}"` : t('the active environment') })} <code className="text-surface-300">{'{{'}{varDialog.name || 'name'}{'}}'}</code>.
            </p>
            <div className="flex justify-end gap-2 mt-1">
              <button onClick={() => setVarDialog(null)} className="px-3 py-1.5 text-xs text-surface-400 hover:text-surface-200 transition-colors">{t('Cancel')}</button>
              <button
                onClick={() => {
                  if (activeEnvironmentId && varDialog.name.trim()) {
                    upsertEnvVar(activeEnvironmentId, varDialog.name.trim(), varDialog.value);
                    assertToast.show(t('✓ Saved {{:name}}', { name: varDialog.name.trim() }), true);
                  }
                  setVarDialog(null);
                }}
                disabled={!varDialog.name.trim()}
                className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50 transition-colors"
              >
                {t('Create')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
