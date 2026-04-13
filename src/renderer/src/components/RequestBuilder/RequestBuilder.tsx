// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useState } from 'react';
import { useStore } from '../../store';
import type { ApiRequest, HttpMethod, KeyValuePair, RunRequestResult } from '../../../../shared/types';
import { getHooksForRequest } from '../../../../shared/request-collection';
import { ParamsTab } from './ParamsTab';
import { VarInput } from '../common/VarInput';
import { HeadersTab } from './HeadersTab';
import { BodyTab } from './BodyTab';
import { AuthTab } from './AuthTab';
import { ScriptsTab } from './ScriptsTab';
import { SchemaTab } from './SchemaTab';
import { ContractTab } from './ContractTab';
import { WebSocketPanel } from '../WebSocket/WebSocketPanel';

const { electron } = window;

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const METHOD_COLORS: Record<string, string> = {
  GET:     'text-emerald-400',
  POST:    'text-blue-400',
  PUT:     'text-amber-400',
  PATCH:   'text-orange-400',
  DELETE:  'text-red-400',
  HEAD:    'text-purple-400',
  OPTIONS: 'text-gray-400',
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

export function RequestBuilder({ request }: Props) {
  const updateRequest       = useStore(s => s.updateRequest);
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
  const [runHooks, setRunHooks] = useState(() => localStorage.getItem('runHooks') !== 'false');

  function toggleRunHooks() {
    setRunHooks(prev => {
      const next = !prev;
      localStorage.setItem('runHooks', String(next));
      return next;
    });
  }

  function update(patch: Partial<ApiRequest>) {
    updateRequest(request.id, patch);
  }

  async function sendRequest() {
    if (!activeTabId) return;
    setTabSending(activeTabId, true);
    setTabResponse(activeTabId, null, null);
    setTabHookResults(activeTabId, null);
    const collectedHookResults: RunRequestResult[] = [];
    try {
      const activeEnv = activeEnvironmentId ? environments[activeEnvironmentId]?.data ?? null : null;
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
        ...sessionVars,
      };
      let liveGlobals = { ...globals };

      // Merge folder/collection-level auth and headers for the main request
      const inherited = useStore.getState().getInheritedAuthAndHeaders(request.id);
      const mergedAuth: typeof request.auth =
        request.auth.type !== 'none' ? request.auth : (inherited.auth ?? request.auth);
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
          const hookEnv = activeEnvironmentId
            ? useStore.getState().environments[activeEnvironmentId]?.data ?? null
            : null;
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
      const freshEnv = activeEnvironmentId
        ? useStore.getState().environments[activeEnvironmentId]?.data ?? null
        : null;
      const freshSessionVars = useStore.getState().sessionVars;
      const result = await electron.sendRequest({
        ...basePayload,
        environment: freshEnv,
        request: mergedRequest,
        collectionVars: { ...collectionVars, ...freshSessionVars },
        globals: liveGlobals,
      });

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
          const hookEnv = activeEnvironmentId
            ? useStore.getState().environments[activeEnvironmentId]?.data ?? null
            : null;
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
  const isWs         = request.protocol === 'websocket';

  const tabs = [
    { id: 'params',  label: 'Params',  count: request.params.filter(p => p.enabled && p.key).length },
    { id: 'headers', label: 'Headers', count: request.headers.filter(h => h.enabled && h.key).length },
    ...(!isWs ? [
      { id: 'body',    label: 'Body',    count: request.body.mode !== 'none' ? 1 : 0 },
      { id: 'auth',    label: 'Auth',    count: request.auth.type !== 'none' ? 1 : 0 },
      { id: 'scripts', label: 'Scripts', count: (hasPreScript ? 1 : 0) + (hasPostScript ? 1 : 0) },
      { id: 'schema',   label: 'Schema',   count: request.schema?.trim() ? 1 : 0 },
      { id: 'contract', label: 'Contract', count: (request.contract?.statusCode !== undefined || request.contract?.bodySchema?.trim() || request.contract?.headers?.some(h => h.key)) ? 1 : 0 },
    ] : []),
  ] as const;

  return (
    <div className="flex flex-col h-full">
      {/* Request name */}
      <div className="px-4 pt-3 pb-1 flex-shrink-0">
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
            className="text-sm font-medium text-white hover:text-blue-400 transition-colors text-left"
          >
            {request.name}
          </button>
        )}
      </div>

      {/* URL bar */}
      <div className="flex items-center gap-2 px-4 py-2 flex-shrink-0">
        {/* Protocol toggle */}
        <div className="flex bg-surface-800 border border-surface-700 rounded overflow-hidden text-xs font-bold flex-shrink-0">
          <button
            onClick={() => update({ protocol: 'http' })}
            className={`px-2 py-1.5 transition-colors ${!isWs ? 'bg-blue-600 text-white' : 'text-surface-500 hover:text-white'}`}
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
        </div>

        {/* Method selector (HTTP only) */}
        {!isWs && (
          <select
            value={request.method}
            onChange={e => update({ method: e.target.value as HttpMethod })}
            className={`bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-xs font-bold focus:outline-none focus:border-blue-500 ${METHOD_COLORS[request.method]}`}
          >
            {METHODS.map(m => (
              <option key={m} value={m} className="text-white">{m}</option>
            ))}
          </select>
        )}

        <VarInput
          value={request.url}
          onChange={url => update({ url })}
          placeholder={isWs ? 'ws://example.com/socket' : 'https://api.example.com/endpoint'}
          wrapperClassName="flex-1"
          className="bg-surface-800 border border-surface-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 font-mono placeholder-surface-700"
        />

        {/* Hooks toggle + Send button (HTTP only) */}
        {!isWs && (
          <>
            <button
              onClick={toggleRunHooks}
              title={runHooks ? 'Hooks enabled — click to disable' : 'Hooks disabled — click to enable'}
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

      {/* WS Panel (takes over the full remaining area) */}
      {isWs ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <WebSocketPanel request={request} />
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex border-b border-surface-800 px-4 gap-0 flex-shrink-0">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
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
          </div>

          {/* Tab content */}
          <div className="px-4 py-3 flex-1 overflow-y-auto min-h-0">
            {activeTab === 'params'  && <ParamsTab  request={request} onChange={update} />}
            {activeTab === 'headers' && <HeadersTab request={request} onChange={update} />}
            {activeTab === 'body'    && <BodyTab    request={request} onChange={update} />}
            {activeTab === 'auth'    && <AuthTab    request={request} onChange={update} />}
            {activeTab === 'scripts' && <ScriptsTab request={request} onChange={update} />}
            {activeTab === 'schema'   && <SchemaTab   request={request} onChange={update} />}
            {activeTab === 'contract' && <ContractTab request={request} onChange={update} />}
          </div>
        </>
      )}
    </div>
  );
}
