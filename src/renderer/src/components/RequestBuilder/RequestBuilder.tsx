// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import type { ApiRequest, HttpMethod, KeyValuePair, RunRequestResult } from '../../../../shared/types';
import { getHooksForRequest, authIsConfigured } from '../../../../shared/request-collection';
import { extractQueryParams } from '../../../../shared/url-params';
import { resolveEnvironmentById } from '../../hooks/useActiveEnvironment';
import { ParamsTab } from './ParamsTab';
import { VarInput } from '../common/VarInput';
import { HeadersTab } from './HeadersTab';
import { BodyTab } from './BodyTab';
import { AuthTab } from './AuthTab';
import { ScriptsTab } from './ScriptsTab';
import { SchemaTab } from './SchemaTab';
import { ContractTab } from './ContractTab';
import { StreamTab } from './StreamTab';
import { WebSocketPanel } from '../WebSocket/WebSocketPanel';
import { GrpcPanel } from '../Grpc/GrpcPanel';
import { FuzzModal } from './FuzzModal';

const { electron } = window;

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY'];

const METHOD_COLORS: Record<string, string> = {
  GET:     'text-emerald-400',
  POST:    'text-blue-400',
  PUT:     'text-amber-400',
  PATCH:   'text-orange-400',
  DELETE:  'text-red-400',
  HEAD:    'text-purple-400',
  OPTIONS: 'text-gray-400',
  QUERY:   'text-fuchsia-400',
};

interface Props {
  request: ApiRequest
}

/**
 * Mirror of the runner-handler / request-handler status logic, applied to a
 * single hook execution. Kept in sync with src/main/ipc/runner-handler.ts.
 */
function deriveHookStatus(r: {
  response: { status: number }
  scriptResult: { postScriptError?: string; testResults: { passed: boolean }[] }
}): RunRequestResult['status'] {
  if (r.scriptResult.postScriptError) return 'error';
  if (r.response.status >= 400) return 'failed';
  const tests = r.scriptResult.testResults;
  if (tests.length === 0) return 'skipped';
  return tests.every(t => t.passed) ? 'passed' : 'failed';
}

// Tab tooltips. Schema vs Contract is the easily-confused pair: one is a local
// throwaway check, the other is the published contract-testing expectation.
const TAB_HINTS: Record<string, string> = {
  schema: 'Schema — a local, throwaway JSON-Schema check of the last response. Not saved to the contract, not published.',
  contract: 'Contract — the published expectation (status, body shape, headers) that drives contract testing: consumer pact, bi-directional verify, can-i-deploy.',
  stream: 'Stream — idle and total timeouts for streamed responses (SSE / NDJSON / chunked).',
};

export function RequestBuilder({ request }: Props) {
  const updateRequest       = useStore(s => s.updateRequest);
  const updateExampleRequest  = useStore(s => s.updateExampleRequest);
  const activeEnvironmentId = useStore(s => s.activeEnvironmentId);
  const activeCollectionId  = useStore(s => s.activeCollectionId);
  const environments        = useStore(s => s.environments);
  const collections         = useStore(s => s.collections);
  const globals             = useStore(s => s.globals);
  const activeTabId         = useStore(s => s.activeTabId);
  const setTabResponse      = useStore(s => s.setTabResponse);
  const setTabHookResults   = useStore(s => s.setTabHookResults);
  const setTabSending       = useStore(s => s.setTabSending);
  const setTabRequestTab    = useStore(s => s.setTabRequestTab);
  const addHistoryEntry     = useStore(s => s.addHistoryEntry);
  const applyScriptUpdates  = useStore(s => s.applyScriptUpdates);
  const startLiveStream     = useStore(s => s.startLiveStream);
  const finishLiveStream    = useStore(s => s.finishLiveStream);
  const workspaceSettings   = useStore(s => s.workspace?.settings);
  const collectionTls       = useStore(s => activeCollectionId ? s.collections[activeCollectionId]?.data.tls : undefined);

  // Read per-tab state
  const activeAppTab = useStore(s => s.tabs.find(t => t.id === s.activeTabId));
  const isSending    = activeAppTab?.isSending ?? false;
  const activeTab    = activeAppTab?.requestTab ?? 'params';

  function setActiveTab(t: typeof activeTab) {
    if (activeTabId) setTabRequestTab(activeTabId, t);
  }

  const [editingName, setEditingName] = useState(false);
  const [showFuzz, setShowFuzz] = useState(false);
  const [customVerb, setCustomVerb] = useState(false);
  const [runHooks, setRunHooks] = useState(() => localStorage.getItem('runHooks') !== 'false');

  function toggleRunHooks() {
    setRunHooks(prev => {
      const next = !prev;
      localStorage.setItem('runHooks', String(next));
      return next;
    });
  }

  // When the tab is on an example, edits update the example's overrides rather
  // than the base request (the example "overrides the request").
  function update(patch: Partial<ApiRequest>) {
    if (activeAppTab?.exampleId) updateExampleRequest(request.id, activeAppTab.exampleId, patch);
    else updateRequest(request.id, patch);
  }

  // Pasting a URL with a query string moves those params into the Params tab
  // instead of leaving them in the address bar (the send path re-appends them,
  // so the request on the wire is unchanged). Typing a URL is left untouched.
  function handleUrlPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text');
    if (!pasted.includes('?')) return;
    const input = e.currentTarget;
    const start = input.selectionStart ?? request.url.length;
    const end   = input.selectionEnd ?? request.url.length;
    const resulting = request.url.slice(0, start) + pasted + request.url.slice(end);
    const split = extractQueryParams(resulting, request.params ?? []);
    if (split.changed) {
      e.preventDefault();
      update({ url: split.url, params: split.params });
    }
  }

  // Replay support: history rows (and anywhere else) call requestSend() to
  // bump this counter; when it changes we fire the same send pipeline as the
  // Send button. The ref skips the initial mount so we never auto-send.
  const sendSignal = useStore(s => s.sendSignal);
  const lastSendSignal = useRef(sendSignal);
  useEffect(() => {
    if (sendSignal !== lastSendSignal.current) {
      lastSendSignal.current = sendSignal;
      void sendRequest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendSignal]);

  async function sendRequest() {
    if (!activeTabId) return;
    setTabSending(activeTabId, true);
    setTabResponse(activeTabId, null, null);
    setTabHookResults(activeTabId, null);
    const collectedHookResults: RunRequestResult[] = [];
    try {
      const activeEnv = resolveEnvironmentById(environments, activeEnvironmentId);
      const sessionVars = useStore.getState().sessionVars;
      const tls = collectionTls
        ? { ...workspaceSettings?.tls, ...collectionTls }
        : workspaceSettings?.tls;
      const basePayload = {
        environment:     activeEnv,
        proxy:           workspaceSettings?.proxy,
        tls,
        piiMaskPatterns: workspaceSettings?.piiMaskPatterns,
      };

      let collectionVars: Record<string, string> = {
        ...(activeCollectionId ? (collections[activeCollectionId]?.data.collectionVariables ?? {}) : {}),
        // Folder-chain variables sit above collection vars and below session/local.
        ...useStore.getState().getInheritedVariables(request.id),
        ...sessionVars,
      };
      let liveGlobals = { ...globals };

      // Merge folder/collection-level auth and headers for the main request.
      // The request's own auth wins only when it actually carries a credential;
      // an empty stub (e.g. from OpenAPI import) falls back to inherited auth.
      const inherited = useStore.getState().getInheritedAuthAndHeaders(request.id);
      const mergedAuth: typeof request.auth =
        authIsConfigured(request.auth) ? request.auth : (inherited.auth ?? request.auth);
      const mergedHeaders: KeyValuePair[] = [
        ...inherited.headers.filter(h => h.enabled),
        ...request.headers,
      ];
      const mergedRequest = { ...request, auth: mergedAuth, headers: mergedHeaders };

      // ── Resolve applicable hooks ────────────────────────────────────────────
      const collection = activeCollectionId ? collections[activeCollectionId]?.data : null;
      const hooks = (runHooks && collection)
        ? getHooksForRequest(request.id, collection)
        : { before: [], after: [] };

      // ── Run before hooks ────────────────────────────────────────────────────
      for (const hook of hooks.before) {
        const start = Date.now();
        try {
          // Re-read the environment each iteration — a prior hook may have
          // updated it via sp.environment.set() or sp.variables.set().
          const hookEnv = resolveEnvironmentById(
            useStore.getState().environments, activeEnvironmentId,
          );
          const hookSessionVars = useStore.getState().sessionVars;
          const r = await electron.sendRequest({
            ...basePayload,
            environment: hookEnv,
            request: hook,
            collectionVars: { ...collectionVars, ...hookSessionVars },
            globals: liveGlobals,
          });
          applyScriptUpdates(r.scriptResult);
          collectionVars = { ...collectionVars, ...r.scriptResult.updatedCollectionVars };
          liveGlobals    = { ...liveGlobals,    ...r.scriptResult.updatedGlobals };
          collectedHookResults.push({
            requestId:   hook.id,
            name:        hook.name,
            method:      hook.method,
            resolvedUrl: r.scriptResult.resolvedUrl,
            status:      deriveHookStatus(r),
            httpStatus:  r.response.status,
            durationMs:  Date.now() - start,
            isHook:      true,
            hookType:    hook.hookType,
            testResults: r.scriptResult.testResults,
            consoleOutput: r.scriptResult.consoleOutput,
            preScriptError:  r.scriptResult.preScriptError,
            postScriptError: r.scriptResult.postScriptError,
          });
        } catch (err) {
          collectedHookResults.push({
            requestId: hook.id, name: hook.name, method: hook.method, resolvedUrl: hook.url,
            status: 'error', durationMs: Date.now() - start, isHook: true, hookType: hook.hookType,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // ── Run main request ────────────────────────────────────────────────────
      // Re-read the environment from the store — before hooks may have updated
      // it via sp.environment.set() (e.g. extracting a token), and the original
      // snapshot in basePayload would be stale.
      const freshEnv = resolveEnvironmentById(
        useStore.getState().environments, activeEnvironmentId,
      );
      const freshSessionVars = useStore.getState().sessionVars;
      // A streamId lets the main process push live frames back for this send;
      // the viewer renders them as they arrive. Only the main request streams.
      const streamId = crypto.randomUUID();
      startLiveStream(activeTabId, streamId);
      let result;
      try {
        result = await electron.sendRequest({
          ...basePayload,
          environment: freshEnv,
          request: mergedRequest,
          collectionVars: { ...collectionVars, ...freshSessionVars },
          globals: liveGlobals,
          streamId,
        });
      } finally {
        finishLiveStream(streamId);
      }

      setTabResponse(activeTabId, result.response, result.scriptResult, result.sentRequest);
      applyScriptUpdates(result.scriptResult);
      collectionVars = { ...collectionVars, ...result.scriptResult.updatedCollectionVars };
      liveGlobals    = { ...liveGlobals,    ...result.scriptResult.updatedGlobals };

      addHistoryEntry({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        request: JSON.parse(JSON.stringify(request)),
        resolvedUrl: result.scriptResult.resolvedUrl,
        response: result.response,
        environmentName: activeEnv?.name ?? null,
        scriptResult: result.scriptResult,
      });

      // ── Run after hooks ─────────────────────────────────────────────────────
      for (const hook of hooks.after) {
        const start = Date.now();
        try {
          const hookEnv = resolveEnvironmentById(
            useStore.getState().environments, activeEnvironmentId,
          );
          const hookSessionVars = useStore.getState().sessionVars;
          const r = await electron.sendRequest({
            ...basePayload,
            environment: hookEnv,
            request: hook,
            collectionVars: { ...collectionVars, ...hookSessionVars },
            globals: liveGlobals,
          });
          applyScriptUpdates(r.scriptResult);
          collectionVars = { ...collectionVars, ...r.scriptResult.updatedCollectionVars };
          liveGlobals    = { ...liveGlobals,    ...r.scriptResult.updatedGlobals };
          collectedHookResults.push({
            requestId:   hook.id,
            name:        hook.name,
            method:      hook.method,
            resolvedUrl: r.scriptResult.resolvedUrl,
            status:      deriveHookStatus(r),
            httpStatus:  r.response.status,
            durationMs:  Date.now() - start,
            isHook:      true,
            hookType:    hook.hookType,
            testResults: r.scriptResult.testResults,
            consoleOutput: r.scriptResult.consoleOutput,
            preScriptError:  r.scriptResult.preScriptError,
            postScriptError: r.scriptResult.postScriptError,
          });
        } catch (err) {
          collectedHookResults.push({
            requestId: hook.id, name: hook.name, method: hook.method, resolvedUrl: hook.url,
            status: 'error', durationMs: Date.now() - start, isHook: true, hookType: hook.hookType,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (collectedHookResults.length > 0) {
        setTabHookResults(activeTabId, collectedHookResults);
      }
    } finally {
      setTabSending(activeTabId, false);
    }
  }

  const hasPreScript  = Boolean(request.preRequestScript?.trim());
  const hasPostScript = Boolean(request.postRequestScript?.trim());
  const isWs   = request.protocol === 'websocket';
  const isSoap = request.protocol === 'soap';
  const isGrpc = request.protocol === 'grpc';

  // An example is a request specimen (a saved payload), not a test — so it has
  // no Scripts / Schema / Contract, only what it sends.
  const isExample = !!activeAppTab?.exampleId;
  const tabs = [
    // SOAP collapses Params + Body into a single "SOAP" tab — the WSDL drives both.
    ...(!isSoap ? [{ id: 'params', label: 'Params', count: request.params.filter(p => p.enabled && p.key).length }] : []),
    { id: 'headers', label: 'Headers', count: request.headers.filter(h => h.enabled && h.key).length },
    ...(!isWs ? [
      { id: 'body',    label: isSoap ? 'SOAP' : 'Body', count: request.body.mode !== 'none' ? 1 : 0 },
      { id: 'auth',    label: 'Auth',    count: request.auth.type !== 'none' ? 1 : 0 },
      ...(!isExample ? [
        { id: 'scripts', label: 'Scripts', count: (hasPreScript ? 1 : 0) + (hasPostScript ? 1 : 0) },
        { id: 'schema',   label: 'Schema',   count: request.schema?.trim() ? 1 : 0 },
        { id: 'contract', label: 'Contract', count: (request.contract?.statusCode !== undefined || request.contract?.bodySchema?.trim() || request.contract?.headers?.some(h => h.key)) ? 1 : 0 },
        { id: 'stream',   label: 'Stream',   count: (request.stream?.idleMs !== undefined || request.stream?.maxMs !== undefined) ? 1 : 0 },
      ] : []),
    ] : []),
  ] as const;

  return (
    <div className="flex flex-col h-full">
      {/* Request name + example controls */}
      <div className="px-4 pt-3 pb-1 flex-shrink-0 flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          {editingName ? (
            <input
              autoFocus
              value={request.name}
              onChange={e => update({ name: e.target.value })}
              onBlur={() => setEditingName(false)}
              onKeyDown={e => e.key === 'Enter' && setEditingName(false)}
              className="text-sm font-medium bg-transparent border-b border-blue-500 focus:outline-none w-full"
            />
          ) : (
            <button
              onClick={() => setEditingName(true)}
              className="text-sm font-medium text-white hover:text-blue-400 transition-colors text-left truncate"
            >
              {request.name}
            </button>
          )}
          {activeAppTab?.exampleId && (
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-amber-400 border border-amber-500/30 rounded px-1.5 py-0.5">
              Example: {request.examples?.find(e => e.id === activeAppTab.exampleId)?.name ?? ''}
            </span>
          )}
        </div>
      </div>

      {/* URL bar */}
      <div className="flex items-center gap-2 px-4 py-2 flex-shrink-0">
        {/* Protocol toggle */}
        <div className="flex bg-surface-800 border border-surface-700 rounded overflow-hidden text-xs font-bold flex-shrink-0">
          <button
            onClick={() => update({ protocol: 'http' })}
            className={`px-2 py-1.5 transition-colors ${!isWs && !isSoap && !isGrpc ? 'bg-blue-600 text-white' : 'text-surface-500 hover:text-white'}`}
            title="HTTP request"
          >
            HTTP
          </button>
          <button
            onClick={() => update({ protocol: 'websocket' })}
            className={`px-2 py-1.5 transition-colors ${isWs ? 'bg-cyan-700 text-cyan-200' : 'text-surface-500 hover:text-white'}`}
            title="WebSocket"
          >
            WS
          </button>
          <button
            onClick={() => {
              update({
                protocol: 'soap',
                method: 'POST',
                body: request.body.mode === 'soap' ? request.body : { ...request.body, mode: 'soap', soap: request.body.soap ?? { wsdlUrl: '', envelope: '' } },
              });
              // SOAP's primary surface is the WSDL fetcher inside the Body
              // tab — jump there so the user sees it immediately instead of
              // landing on the (now-hidden) Params tab.
              if (activeTabId) setTabRequestTab(activeTabId, 'body');
            }}
            className={`px-2 py-1.5 transition-colors ${isSoap ? 'bg-amber-700 text-amber-100' : 'text-surface-500 hover:text-white'}`}
            title="SOAP - endpoint and method are derived from the WSDL"
          >
            SOAP
          </button>
          <button
            onClick={() => update({
              protocol: 'grpc',
              body: request.body.mode === 'grpc' ? request.body : { ...request.body, mode: 'grpc', grpc: request.body.grpc ?? { message: '{}', metadata: [], plaintext: false } },
            })}
            className={`px-2 py-1.5 transition-colors ${isGrpc ? 'bg-violet-700 text-violet-100' : 'text-surface-500 hover:text-white'}`}
            title="gRPC - proto-defined services over HTTP/2"
          >
            gRPC
          </button>
        </div>

        {/* Method selector — only meaningful for HTTP. SOAP is always POST,
            shown as a static badge so the user sees what's on the wire. */}
        {!isWs && !isSoap && !isGrpc && (customVerb ? (
          <input
            autoFocus
            value={request.method}
            onChange={e => update({ method: e.target.value.toUpperCase() })}
            onBlur={() => setCustomVerb(false)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setCustomVerb(false); } }}
            placeholder="VERB"
            title="Type any HTTP method"
            className="w-24 bg-surface-800 border border-blue-500 rounded px-2 py-1.5 text-xs font-bold uppercase focus:outline-none text-fuchsia-400 placeholder-surface-600"
          />
        ) : (
          <select
            value={METHODS.includes(request.method) ? request.method : '__current__'}
            onChange={e => {
              if (e.target.value === '__custom__') setCustomVerb(true);
              else if (e.target.value !== '__current__') update({ method: e.target.value as HttpMethod });
            }}
            className={`bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-xs font-bold focus:outline-none focus:border-blue-500 ${METHOD_COLORS[request.method] ?? 'text-fuchsia-400'}`}
          >
            {METHODS.map(m => (
              <option key={m} value={m} className="text-white">{m}</option>
            ))}
            {!METHODS.includes(request.method) && (
              <option value="__current__" className="text-white">{request.method}</option>
            )}
            <option value="__custom__" className="text-white">Custom…</option>
          </select>
        ))}
        {isSoap && (
          <span
            className="bg-surface-900 border border-surface-700 rounded px-2 py-1.5 text-xs font-bold text-amber-400 select-none"
            title="SOAP requests are always POST"
          >
            POST
          </span>
        )}
        {isGrpc && (
          <span
            className="bg-surface-900 border border-surface-700 rounded px-2 py-1.5 text-xs font-bold text-violet-400 select-none"
            title="gRPC target is host:port"
          >
            gRPC
          </span>
        )}

        <VarInput
          value={request.url}
          onChange={url => update({ url })}
          onPaste={handleUrlPaste}
          placeholder={
            isWs   ? 'ws://example.com/socket'
            : isSoap ? 'Endpoint (auto-filled from WSDL <soap:address>)'
            : isGrpc ? 'localhost:50051'
            : 'https://api.example.com/endpoint'
          }
          wrapperClassName="flex-1"
          className={`border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 font-mono placeholder-surface-700 ${
            isSoap
              ? 'bg-surface-900 border-amber-900/50 text-surface-300'
              : 'bg-surface-800 border-surface-700'
          }`}
        />

        {/* Hooks toggle + Send button (HTTP only) */}
        {!isWs && !isGrpc && (
          <>
            <button
              onClick={toggleRunHooks}
              title={runHooks ? 'Hooks enabled - click to disable' : 'Hooks disabled - click to enable'}
              className={`px-2 py-1.5 rounded text-xs font-medium transition-colors border ${
                runHooks
                  ? 'border-violet-500 text-violet-400 hover:bg-violet-500/10'
                  : 'border-surface-700 text-surface-500 hover:text-surface-300'
              }`}
            >
              hooks
            </button>
            <button
              onClick={sendRequest}
              disabled={isSending || !request.url}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-surface-800 disabled:text-surface-400 rounded text-sm font-medium transition-colors min-w-[72px]"
            >
              {isSending ? '...' : 'Send'}
            </button>
          </>
        )}
      </div>

      {showFuzz && <FuzzModal request={request} onClose={() => setShowFuzz(false)} />}

      {/* WS / gRPC panels take over the full remaining area */}
      {isWs ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <WebSocketPanel request={request} />
        </div>
      ) : isGrpc ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <GrpcPanel request={request} onChange={update} />
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex border-b border-surface-800 px-4 gap-0 flex-shrink-0">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                title={TAB_HINTS[tab.id]}
                className={`px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-white'
                    : 'border-transparent text-surface-400 hover:text-white'
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-1 text-[10px] bg-surface-600 text-white rounded px-1 font-medium">{tab.count}</span>
                )}
              </button>
            ))}
            <button
              onClick={() => setShowFuzz(true)}
              disabled={!request.url}
              title="Fuzz this request with malformed inputs (opens a dialog; nothing is sent until you confirm)"
              className="ml-auto my-1 self-center px-2 py-0.5 rounded text-[11px] border border-surface-700 text-surface-500 hover:text-fuchsia-400 hover:border-fuchsia-500 transition-colors disabled:opacity-40"
            >
              fuzz
            </button>
          </div>

          {/* Tab content */}
          <div className="px-4 py-3 flex-1 overflow-y-auto min-h-0">
            {(() => {
              // On an example, Scripts/Schema/Contract are hidden; if the stored
              // tab was one of them, fall back to Body so nothing renders blank.
              const shown = isExample && (activeTab === 'scripts' || activeTab === 'schema' || activeTab === 'contract' || activeTab === 'stream')
                ? 'body' : activeTab;
              return <>
                {shown === 'params'  && <ParamsTab  request={request} onChange={update} />}
                {shown === 'headers' && <HeadersTab request={request} onChange={update} />}
                {shown === 'body'    && <BodyTab    request={request} onChange={update} />}
                {shown === 'auth'    && <AuthTab    request={request} onChange={update} />}
                {!isExample && shown === 'scripts' && <ScriptsTab request={request} onChange={update} />}
                {!isExample && shown === 'schema'   && <SchemaTab   request={request} onChange={update} />}
                {!isExample && shown === 'contract' && <ContractTab request={request} onChange={update} />}
                {!isExample && shown === 'stream'   && <StreamTab   request={request} onChange={update} />}
              </>;
            })()}
          </div>
        </>
      )}
    </div>
  );
}
