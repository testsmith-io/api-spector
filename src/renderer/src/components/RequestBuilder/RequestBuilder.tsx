// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useStore } from '../../store';
import type { ApiRequest, HttpMethod, KeyValuePair, RunRequestResult } from '../../../../shared/types';
import { getHooksForRequest, authIsConfigured } from '../../../../shared/request-collection';
import { findFolderContaining } from '../../../../shared/folder-tree';
import { syncParamsFromUrl, buildPreviewUrl } from '../../../../shared/url-params';
import { resolveEnvironmentById, withEnvOverrides } from '../../hooks/useActiveEnvironment';
import { useVarValues } from '../../hooks/useVarValues';
import { ParamsTab } from './ParamsTab';
import { VarInput } from '../common/VarInput';
import { HeadersTab } from './HeadersTab';
import { BodyTab } from './BodyTab';
import { AuthTab } from './AuthTab';
import { ScriptsTab } from './ScriptsTab';
import { SchemaTab } from './SchemaTab';
import { DocsTab } from './DocsTab';
import { StreamTab } from './StreamTab';
import { VariablesTab } from './VariablesTab';
import { WebSocketPanel } from '../WebSocket/WebSocketPanel';
import { SocketIoPanel } from '../SocketIO/SocketIoPanel';
import { MqttPanel } from '../MQTT/MqttPanel';
import { GrpcPanel } from '../Grpc/GrpcPanel';
import { isSubscriptionQuery, deriveWsUrl } from './GraphQlSubscription';
import { FuzzModal } from './FuzzModal';
import { AskVarsModal } from './AskVarsModal';
import { askVarsInRequest, resolveAskValues, type AskVar } from '../../../../shared/ask-vars';
import { STORAGE_KEYS } from '../../lib/storage-keys';
import { useT } from '../../i18n';

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
  readonly request: ApiRequest
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

// Tab tooltips.
const TAB_HINTS: Record<string, string> = {
  schema: 'Schema: validate the response body against a JSON Schema, synced from your OpenAPI spec or created from a response. Checked automatically on every send.',
  stream: 'Stream: idle and total timeouts for streamed responses (SSE / NDJSON / chunked).',
  variables: 'Variables: every variable in scope for this request (environment, collection, globals), their resolved values, and which ones the request references.',
};

export function RequestBuilder({ request }: Props) {
  const t = useT();
  const updateRequest       = useStore(s => s.updateRequest);
  const subVars             = useVarValues();
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
  const recordScriptSession = useStore(s => s.recordScriptSession);
  const startLiveStream     = useStore(s => s.startLiveStream);
  const finishLiveStream    = useStore(s => s.finishLiveStream);
  const workspaceSettings   = useStore(s => s.workspace?.settings);
  const collectionTls       = useStore(s => activeCollectionId ? s.collections[activeCollectionId]?.data.tls : undefined);

  // Read per-tab state
  const activeAppTab = useStore(s => s.tabs.find(t => t.id === s.activeTabId));
  const isSending    = activeAppTab?.isSending ?? false;
  const activeTab    = activeAppTab?.requestTab ?? 'params';

  // Live preview of the final URL that will actually be sent: enabled query
  // params appended, path params / {{vars}} / [name] substituted. Shown under
  // the URL bar so the composed request is visible at a glance before sending.
  const varValues = useVarValues();
  const previewUrl = useMemo(
    () => buildPreviewUrl(request.url, request.params ?? [], varValues),
    [request.url, request.params, varValues],
  );

  function setActiveTab(t: typeof activeTab) {
    if (activeTabId) setTabRequestTab(activeTabId, t);
  }

  const [editingName, setEditingName] = useState(false);
  const [showFuzz, setShowFuzz] = useState(false);
  // Realtime panels (WS/IO/MQTT/gRPC) have no tab bar of their own, so they get
  // a tiny Protocol | Docs switch here so their requests can be documented too.
  const [rtTab, setRtTab] = useState<'panel' | 'docs'>('panel');
  const [askPrompt, setAskPrompt] = useState<{ asks: AskVar[]; resolve: (answers: Record<string, string> | null) => void } | null>(null);

  // Open the ask-variable modal and resolve with the entered answers, or null if
  // the user cancels (which aborts the send).
  function promptAskVars(asks: AskVar[]): Promise<Record<string, string> | null> {
    return new Promise(resolve => setAskPrompt({ asks, resolve }));
  }
  const [customVerb, setCustomVerb] = useState(false);
  const [runHooks, setRunHooks] = useState(() => localStorage.getItem(STORAGE_KEYS.runHooks) !== 'false');

  function toggleRunHooks() {
    setRunHooks(prev => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEYS.runHooks, String(next));
      return next;
    });
  }

  // Data table applicable to this request (its folder's wins, else the
  // collection's) so a single send can be run against one specific row.
  const applicableDataSet = useMemo(() => {
    const col = activeCollectionId ? collections[activeCollectionId]?.data : null;
    if (!col) return null;
    const folder = findFolderContaining(col.rootFolder, request.id);
    if (folder?.dataSet && folder.dataSet.rows.length > 0) return folder.dataSet;
    if (col.dataSet && col.dataSet.rows.length > 0) return col.dataSet;
    return null;
  }, [activeCollectionId, collections, request.id]);

  const [dataRowIdx, setDataRowIdx] = useState(-1);

  function selectedDataRow(): Record<string, string> | undefined {
    if (!applicableDataSet || dataRowIdx < 0) return undefined;
    const row = applicableDataSet.rows[dataRowIdx];
    if (!row) return undefined;
    const dr: Record<string, string> = {};
    applicableDataSet.columns.forEach((c, ci) => { if (c) dr[c] = row[ci] ?? ''; });
    return dr;
  }

  // When the tab is on an example, edits update the example's overrides rather
  // than the base request (the example "overrides the request").
  function update(patch: Partial<ApiRequest>) {
    if (activeAppTab?.exampleId) updateExampleRequest(request.id, activeAppTab.exampleId, patch);
    else updateRequest(request.id, patch);
  }

  // Pasting a URL syncs its params into the Params tab: a `?a=1` query string is
  // moved out of the address bar (the send path re-appends it, so the wire
  // request is unchanged), and each `[name]` path placeholder gets a path-param
  // row. The `[name]` text stays in the URL.
  function handleUrlPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text');
    const input = e.currentTarget;
    const start = input.selectionStart ?? request.url.length;
    const end   = input.selectionEnd ?? request.url.length;
    const resulting = request.url.slice(0, start) + pasted + request.url.slice(end);
    const synced = syncParamsFromUrl(resulting, request.params ?? []);
    if (synced.changed) {
      e.preventDefault();
      update({ url: synced.url, params: synced.params });
    }
  }

  // On blur, reconcile the Params tab with whatever the user typed: new `[name]`
  // path params and any `?query` get rows; empty, now-unreferenced path rows are
  // pruned. Done on blur (not per keystroke) so half-typed tokens are ignored.
  function handleUrlBlur() {
    const synced = syncParamsFromUrl(request.url, request.params ?? []);
    if (synced.changed) update({ url: synced.url, params: synced.params });
  }

  // Replay support: history rows (and anywhere else) call requestSend() to
  // bump this counter; when it changes we fire the same send pipeline as the
  // Send button. The ref skips the initial mount so we never auto-send.
  const sendSignal = useStore(s => s.sendSignal);
  const lastSendSignal = useRef(sendSignal);
  useEffect(() => {
    if (sendSignal !== lastSendSignal.current) {
      lastSendSignal.current = sendSignal;
      // WebSocket / Socket.IO / gRPC drive their own panels; the HTTP send
      // pipeline does not apply, so the Cmd/Ctrl+Enter shortcut is a no-op there.
      if (request.protocol !== 'websocket' && request.protocol !== 'grpc' && request.protocol !== 'socketio' && request.protocol !== 'mqtt') void sendRequest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendSignal]);

  // Keyboard sub-tab navigation (Cmd/Ctrl+Alt+Up/Down). App bumps subTabCycle;
  // when it targets the request pane we step through THIS tab's own visible tab
  // list (kept in a ref, since the list depends on the request type).
  const subTabCycle = useStore(s => s.subTabCycle);
  const lastSubTabCycle = useRef(subTabCycle.nonce);
  const subTabIdsRef = useRef<string[]>([]);
  const activeSubTabRef = useRef<string>(activeTab);
  useEffect(() => {
    if (subTabCycle.nonce === lastSubTabCycle.current) return;
    lastSubTabCycle.current = subTabCycle.nonce;
    if (subTabCycle.pane !== 'request') return;
    const ids = subTabIdsRef.current;
    if (ids.length === 0) return;
    const i = ids.indexOf(activeSubTabRef.current);
    const next = (i + subTabCycle.dir + ids.length) % ids.length;
    setActiveTab(ids[next] as typeof activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTabCycle]);

  async function sendRequest() {
    if (!activeTabId) return;

    // A GraphQL subscription is not an HTTP exchange: start the graphql-ws
    // stream (the Response pane shows the live messages + tests) instead of
    // POSTing. The stream and its Stop control live in the Response pane.
    if (request.body.mode === 'graphql' && request.body.graphql && isSubscriptionQuery(request.body.graphql.query)) {
      const gql = request.body.graphql;
      const interp = (s: string) => (s ?? '').replace(/\{\{([^}]+)\}\}/g, (_m, k) => subVars[String(k).trim()] ?? '');
      const url = deriveWsUrl(interp(gql.subscriptionUrl?.trim() || request.url));
      if (!url) { useStore.getState().setGraphqlWsStatus(request.id, 'error', t('No subscription URL')); return; }
      const headers: Record<string, string> = {};
      for (const h of request.headers) if (h.enabled && h.key) headers[interp(h.key)] = interp(h.value);
      try {
        await electron.graphqlWsSubscribe(request.id, {
          url, headers,
          query: gql.query,
          variables: interp(gql.variables),
          operationName: gql.operationName,
          connectionParams: gql.connectionParams ? interp(gql.connectionParams) : undefined,
        });
      } catch (err) {
        useStore.getState().setGraphqlWsStatus(request.id, 'error', err instanceof Error ? err.message : String(err));
      }
      return;
    }

    setTabSending(activeTabId, true);
    setTabResponse(activeTabId, null, null);
    setTabHookResults(activeTabId, null);
    const collectedHookResults: RunRequestResult[] = [];
    try {
      const activeEnv = resolveEnvironmentById(environments, activeEnvironmentId);
      const tls = collectionTls
        ? { ...workspaceSettings?.tls, ...collectionTls }
        : workspaceSettings?.tls;
      const basePayload = {
        environment:     activeEnv,
        proxy:           workspaceSettings?.proxy,
        tls,
        piiMaskPatterns: workspaceSettings?.piiMaskPatterns,
      };

      // Session script values (sp.*.set from earlier sends this session) seed the
      // scopes so an extracted value — e.g. a token set by a previous manual send
      // — is visible to this request. They are held in memory only (never written
      // to disk / the Variables screens) and clear on workspace close / restart.
      const session = useStore.getState().sessionScriptVars;

      let collectionVars: Record<string, string> = {
        ...(activeCollectionId ? (collections[activeCollectionId]?.data.collectionVariables ?? {}) : {}),
        ...session.collection,
      };
      // Folder-chain variables are their own scope (folder precedence: above the
      // environment, below request/local) — passed to the send separately rather
      // than flattened into collectionVars, which would drop them to collection
      // precedence (below the environment).
      const folderVars = {
        ...useStore.getState().getInheritedVariables(request.id),
        ...session.folder,
      };
      let liveGlobals = { ...globals, ...session.globals };
      // Script-write accumulators threaded WITHIN this send: a before-hook's
      // sp.*.set flows into the next hook and the main request through these
      // locals. Env writes seed from the session and are overlaid onto the
      // environment via withEnvOverrides; local (sp.variables) is in-send only
      // (request-scoped) and starts empty.
      let liveLocalVars: Record<string, string> = {};
      let liveEnvOverrides: Record<string, string> = { ...session.env };

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

      // ── Ask variables ({{@Message}}) — prompt before anything is sent ───────
      const asks = askVarsInRequest(mergedRequest);
      if (asks.length > 0) {
        const answers = await promptAskVars(asks);
        if (!answers) { setTabSending(activeTabId, false); return; }  // cancelled
        const askValues = resolveAskValues(asks, answers);
        collectionVars = { ...collectionVars, ...askValues };
      }

      // ── Resolve applicable hooks ────────────────────────────────────────────
      const collection = activeCollectionId ? collections[activeCollectionId]?.data : null;
      const hooks = (runHooks && collection)
        ? getHooksForRequest(request.id, collection)
        : { before: [], after: [] };

      // ── Run before hooks ────────────────────────────────────────────────────
      for (const hook of hooks.before) {
        const start = Date.now();
        try {
          // Thread any run-only env writes from prior hooks onto the environment
          // (sp.environment.set / sp.variables.set), without re-reading the store.
          const hookEnv = withEnvOverrides(activeEnv, liveEnvOverrides);
          const r = await electron.sendRequest({
            ...basePayload,
            environment: hookEnv,
            request: hook,
            folderVars: useStore.getState().getInheritedVariables(hook.id),
            collectionVars: { ...collectionVars, ...liveLocalVars },
            globals: liveGlobals,
          });
          collectionVars   = { ...collectionVars,   ...r.scriptResult.updatedCollectionVars };
          liveGlobals      = { ...liveGlobals,      ...r.scriptResult.updatedGlobals };
          liveLocalVars    = { ...liveLocalVars,    ...r.scriptResult.updatedLocalVars };
          liveEnvOverrides = { ...liveEnvOverrides, ...r.scriptResult.updatedEnvVars };
          // Persist the named-scope writes into the session so the next manual
          // send can read them (in memory only; local vars stay request-scoped).
          recordScriptSession({
            env:        r.scriptResult.updatedEnvVars,
            collection: r.scriptResult.updatedCollectionVars,
            folder:     r.scriptResult.updatedFolderVars,
            globals:    r.scriptResult.updatedGlobals,
          });
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
      // Before hooks may have set env/local vars via scripts (e.g. extracting a
      // token); thread those run-only writes onto the environment and into the
      // collection-var bag for this send. Nothing was written to the store.
      const freshEnv = withEnvOverrides(activeEnv, liveEnvOverrides);
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
          folderVars,
          collectionVars: { ...collectionVars, ...liveLocalVars },
          globals: liveGlobals,
          streamId,
          ...(selectedDataRow() ? { dataRow: selectedDataRow() } : {}),
        });
      } finally {
        finishLiveStream(streamId);
      }

      setTabResponse(activeTabId, result.response, result.scriptResult, result.sentRequest);
      collectionVars   = { ...collectionVars,   ...result.scriptResult.updatedCollectionVars };
      liveGlobals      = { ...liveGlobals,      ...result.scriptResult.updatedGlobals };
      liveLocalVars    = { ...liveLocalVars,    ...result.scriptResult.updatedLocalVars };
      liveEnvOverrides = { ...liveEnvOverrides, ...result.scriptResult.updatedEnvVars };
      // Persist the main request's named-scope writes into the session so the
      // next manual send can read them (in memory only; local stays request-scoped).
      recordScriptSession({
        env:        result.scriptResult.updatedEnvVars,
        collection: result.scriptResult.updatedCollectionVars,
        folder:     result.scriptResult.updatedFolderVars,
        globals:    result.scriptResult.updatedGlobals,
      });

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
          const hookEnv = withEnvOverrides(activeEnv, liveEnvOverrides);
          const r = await electron.sendRequest({
            ...basePayload,
            environment: hookEnv,
            request: hook,
            folderVars: useStore.getState().getInheritedVariables(hook.id),
            collectionVars: { ...collectionVars, ...liveLocalVars },
            globals: liveGlobals,
          });
          collectionVars   = { ...collectionVars,   ...r.scriptResult.updatedCollectionVars };
          liveGlobals      = { ...liveGlobals,      ...r.scriptResult.updatedGlobals };
          liveLocalVars    = { ...liveLocalVars,    ...r.scriptResult.updatedLocalVars };
          liveEnvOverrides = { ...liveEnvOverrides, ...r.scriptResult.updatedEnvVars };
          // Persist the named-scope writes into the session so the next manual
          // send can read them (in memory only; local vars stay request-scoped).
          recordScriptSession({
            env:        r.scriptResult.updatedEnvVars,
            collection: r.scriptResult.updatedCollectionVars,
            folder:     r.scriptResult.updatedFolderVars,
            globals:    r.scriptResult.updatedGlobals,
          });
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
  const isSocketIo = request.protocol === 'socketio';
  const isMqtt = request.protocol === 'mqtt';

  // An example is a request specimen (a saved payload), not a test — so it has
  // no Scripts / Schema / Contract, only what it sends.
  const isExample = !!activeAppTab?.exampleId;
  const tabs = [
    // SOAP collapses Params + Body into a single "SOAP" tab — the WSDL drives both.
    // Docs leads so documentation is the first thing a reader sees.
    ...(!isExample ? [{ id: 'docs', label: 'Docs', count: request.description?.trim() ? 1 : 0 }] : []),
    ...(!isSoap ? [{ id: 'params', label: 'Params', count: request.params.filter(p => p.enabled && p.key).length }] : []),
    { id: 'headers', label: 'Headers', count: request.headers.filter(h => h.enabled && h.key).length },
    ...((!isWs && !isSocketIo) ? [
      { id: 'body',    label: isSoap ? 'SOAP' : 'Body', count: request.body.mode !== 'none' ? 1 : 0 },
      { id: 'auth',    label: 'Auth',    count: request.auth.type !== 'none' ? 1 : 0 },
      { id: 'variables', label: 'Variables', count: 0 },
      ...(!isExample ? [
        { id: 'scripts', label: 'Scripts', count: (hasPreScript ? 1 : 0) + (hasPostScript ? 1 : 0) },
        { id: 'schema',   label: 'Schema',   count: request.schema?.trim() ? 1 : 0 },
        { id: 'stream',   label: 'Stream',   count: (request.stream?.idleMs !== undefined || request.stream?.maxMs !== undefined) ? 1 : 0 },
      ] : []),
    ] : []),
  ] as const;

  // Keep the keyboard sub-tab navigator in sync with the (type-dependent) list.
  subTabIdsRef.current = tabs.map(tb => tb.id);
  activeSubTabRef.current = activeTab;

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
              {t('Example:')} {request.examples?.find(e => e.id === activeAppTab.exampleId)?.name ?? ''}
            </span>
          )}
        </div>
      </div>

      {/* URL bar */}
      <div className="flex flex-col gap-2 px-4 py-2 flex-shrink-0">
        {/* Row 1: protocol toggle + method */}
        <div className="flex items-center gap-2">
        {/* Protocol toggle */}
        <div className="flex bg-surface-800 border border-surface-700 rounded overflow-hidden text-xs font-bold flex-shrink-0">
          <button
            onClick={() => update({ protocol: 'http' })}
            className={`px-2 py-1.5 transition-colors ${!isWs && !isSoap && !isGrpc && !isSocketIo && !isMqtt ? 'bg-blue-600 text-white' : 'text-surface-500 hover:text-white'}`}
            title={t('HTTP request')}
          >
            HTTP
          </button>
          <button
            onClick={() => update({ protocol: 'websocket' })}
            className={`px-2 py-1.5 transition-colors ${isWs ? 'bg-cyan-700 text-cyan-200' : 'text-surface-500 hover:text-white'}`}
            title={t('WebSocket')}
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
            title={t('SOAP - endpoint and method are derived from the WSDL')}
          >
            SOAP
          </button>
          <button
            onClick={() => update({
              protocol: 'grpc',
              body: request.body.mode === 'grpc' ? request.body : { ...request.body, mode: 'grpc', grpc: request.body.grpc ?? { message: '{}', metadata: [], plaintext: false } },
            })}
            className={`px-2 py-1.5 transition-colors ${isGrpc ? 'bg-violet-700 text-violet-100' : 'text-surface-500 hover:text-white'}`}
            title={t('gRPC - proto-defined services over HTTP/2')}
          >
            gRPC
          </button>
          <button
            onClick={() => update({ protocol: 'socketio' })}
            className={`px-2 py-1.5 transition-colors ${isSocketIo ? 'bg-fuchsia-700 text-fuchsia-100' : 'text-surface-500 hover:text-white'}`}
            title={t('Socket.IO - event-based messaging over Engine.IO')}
          >
            IO
          </button>
          <button
            onClick={() => update({ protocol: 'mqtt' })}
            className={`px-2 py-1.5 transition-colors ${isMqtt ? 'bg-teal-700 text-teal-100' : 'text-surface-500 hover:text-white'}`}
            title={t('MQTT - publish/subscribe messaging for IoT')}
          >
            MQTT
          </button>
        </div>

        {/* Method selector — only meaningful for HTTP. SOAP is always POST,
            shown as a static badge so the user sees what's on the wire. */}
        {!isWs && !isSoap && !isGrpc && !isSocketIo && !isMqtt && (customVerb ? (
          <input
            autoFocus
            value={request.method}
            onChange={e => update({ method: e.target.value.toUpperCase() })}
            onBlur={() => setCustomVerb(false)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setCustomVerb(false); } }}
            placeholder={t('VERB')}
            title={t('Type any HTTP method')}
            className="w-24 bg-surface-800 border border-blue-500 rounded px-2 py-1.5 text-xs font-bold uppercase focus:outline-none text-fuchsia-400 placeholder-surface-600"
          />
        ) : (
          <select
            aria-label={t('HTTP method')}
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
            <option value="__custom__" className="text-white">{t('Custom…')}</option>
          </select>
        ))}
        {isSoap && (
          <span
            className="bg-surface-900 border border-surface-700 rounded px-2 py-1.5 text-xs font-bold text-amber-400 select-none"
            title={t('SOAP requests are always POST')}
          >
            POST
          </span>
        )}
        {isGrpc && (
          <span
            className="bg-surface-900 border border-surface-700 rounded px-2 py-1.5 text-xs font-bold text-violet-400 select-none"
            title={t('gRPC target is host:port')}
          >
            gRPC
          </span>
        )}
        </div>

        {/* Row 2: endpoint + hooks + Send (HTTP/SOAP only; WS/IO/MQTT/gRPC put
            the endpoint + Connect in their own panel header below). */}
        {!isWs && !isGrpc && !isSocketIo && !isMqtt && (
        <div className="flex items-center gap-2">
        <VarInput
          value={request.url}
          onChange={url => update({ url })}
          onPaste={handleUrlPaste}
          onBlur={handleUrlBlur}
          extraVars={Object.fromEntries(
            (request.params ?? [])
              .filter(p => p.enabled && p.key)
              .map(p => [p.key, p.value]),
          )}
          placeholder={
            isWs   ? 'ws://example.com/socket'
            : isSoap ? t('Endpoint (auto-filled from WSDL <soap:address>)')
            : isGrpc ? 'localhost:50051'
            : isMqtt ? 'mqtt://broker.example.com:1883'
            : 'https://api.example.com/endpoint'
          }
          wrapperClassName="flex-1"
          className={`border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 font-mono placeholder-surface-700 ${
            isSoap
              ? 'bg-surface-900 border-amber-900/50 text-surface-300'
              : 'bg-surface-800 border-surface-700'
          }`}
        />

        {/* Data-row picker — run this request against one specific data table row */}
        {!isWs && !isGrpc && !isMqtt && applicableDataSet && (
          <select
            value={dataRowIdx}
            onChange={e => setDataRowIdx(Number(e.target.value))}
            title={t('Run this request with the variables from one data table row')}
            className="bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 max-w-[150px]"
            style={{ color: 'var(--text-primary)' }}
          >
            <option value={-1}>{t('No data row')}</option>
            {applicableDataSet.rows.map((row, ri) => (
              <option key={ri} value={ri}>
                {t('Row :n', { n: ri + 1 })}{row[0] ? ` · ${row[0]}` : ''}
              </option>
            ))}
          </select>
        )}

        {/* Hooks toggle + Send button (HTTP only) */}
        {!isWs && !isGrpc && !isMqtt && (
          <>
            <button
              onClick={toggleRunHooks}
              title={runHooks ? t('Hooks enabled - click to disable') : t('Hooks disabled - click to enable')}
              className={`px-2 py-1.5 rounded text-xs font-medium transition-colors border ${
                runHooks
                  ? 'border-violet-500 text-violet-400 hover:bg-violet-500/10'
                  : 'border-surface-700 text-surface-500 hover:text-surface-300'
              }`}
            >
              {t('hooks')}
            </button>
            <button
              onClick={sendRequest}
              disabled={isSending || !request.url}
              title={t('Send (Cmd/Ctrl+Enter)')}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-surface-800 disabled:text-surface-400 rounded text-sm font-medium transition-colors min-w-[72px]"
            >
              {isSending ? '...' : t('Send')}
            </button>
          </>
        )}
        </div>
        )}

        {/* Live preview of the composed request (HTTP/SOAP): the final URL with
            enabled query params appended and path params/variables resolved, so
            it's clear what gets sent before clicking Send. */}
        {!isWs && !isGrpc && !isSocketIo && !isMqtt && previewUrl && previewUrl !== request.url && (
          <div
            className="flex items-start gap-2 text-[11px] font-mono -mt-0.5 px-0.5"
            title={t('The full request that will be sent, with the enabled params applied')}
          >
            <span className="text-surface-500 shrink-0">{t('Sends')}</span>
            <span className="break-all">
              <span className="font-bold text-blue-400">{request.method}</span>{' '}
              <span className="text-surface-300">{previewUrl}</span>
            </span>
          </div>
        )}
      </div>

      {showFuzz && <FuzzModal request={request} onClose={() => setShowFuzz(false)} />}
      {askPrompt && (
        <AskVarsModal
          asks={askPrompt.asks}
          requestName={request.name}
          onSubmit={answers => { askPrompt.resolve(answers); setAskPrompt(null); }}
          onCancel={() => { askPrompt.resolve(null); setAskPrompt(null); }}
        />
      )}

      {/* WS / Socket.IO / MQTT / gRPC panels take over the full remaining area,
          with a small Protocol | Docs switch so their requests can be documented. */}
      {(isWs || isSocketIo || isMqtt || isGrpc) ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex border-b border-surface-800 px-4 gap-0 flex-shrink-0">
            <button
              onClick={() => setRtTab('panel')}
              className={`px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px ${rtTab === 'panel' ? 'border-blue-500 text-white' : 'border-transparent text-surface-400 hover:text-white'}`}
            >
              {isWs ? t('WebSocket') : isSocketIo ? t('Socket.IO') : isMqtt ? t('MQTT') : t('gRPC')}
            </button>
            <button
              onClick={() => setRtTab('docs')}
              className={`px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px ${rtTab === 'docs' ? 'border-blue-500 text-white' : 'border-transparent text-surface-400 hover:text-white'}`}
            >
              {t('Docs')}
              {request.description?.trim() ? <span className="ml-1 text-[10px] bg-surface-600 text-white rounded px-1 font-medium">1</span> : null}
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {rtTab === 'docs' ? (
              <div className="px-4 py-3 h-full overflow-y-auto"><DocsTab request={request} onChange={update} /></div>
            ) : isWs ? (
              <WebSocketPanel request={request} onChange={update} />
            ) : isSocketIo ? (
              <SocketIoPanel request={request} onChange={update} />
            ) : isMqtt ? (
              <MqttPanel request={request} onChange={update} />
            ) : (
              <GrpcPanel request={request} onChange={update} />
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex border-b border-surface-800 px-4 gap-0 flex-shrink-0">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                title={TAB_HINTS[tab.id] ? t(TAB_HINTS[tab.id]) : undefined}
                className={`px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-white'
                    : 'border-transparent text-surface-400 hover:text-white'
                }`}
              >
                {t(tab.label)}
                {tab.count > 0 && (
                  <span className="ml-1 text-[10px] bg-surface-600 text-white rounded px-1 font-medium">{tab.count}</span>
                )}
              </button>
            ))}
            <button
              onClick={() => setShowFuzz(true)}
              disabled={!request.url}
              title={t('Fuzz this request with malformed inputs (opens a dialog; nothing is sent until you confirm)')}
              className="ml-auto my-1 self-center px-2 py-0.5 rounded text-[11px] border border-surface-700 text-surface-500 hover:text-fuchsia-400 hover:border-fuchsia-500 transition-colors disabled:opacity-40"
            >
              {t('fuzz')}
            </button>
          </div>

          {/* Tab content */}
          <div className="px-4 py-3 flex-1 overflow-y-auto min-h-0">
            {(() => {
              // The Contract tab was removed; a persisted 'contract' sub-tab
              // falls back to Schema (its successor for response validation).
              const raw = activeTab === 'contract' ? 'schema' : activeTab;
              // On an example, Scripts/Schema are hidden; if the stored tab was
              // one of them, fall back to Body so nothing renders blank.
              const shown = isExample && (raw === 'scripts' || raw === 'schema' || raw === 'docs' || raw === 'stream')
                ? 'body' : raw;
              return <>
                {shown === 'params'  && <ParamsTab  request={request} onChange={update} />}
                {shown === 'headers' && <HeadersTab request={request} onChange={update} />}
                {shown === 'body'    && <BodyTab    request={request} onChange={update} />}
                {shown === 'auth'    && <AuthTab    request={request} onChange={update} />}
                {shown === 'variables' && <VariablesTab request={request} />}
                {!isExample && shown === 'scripts' && <ScriptsTab request={request} onChange={update} />}
                {!isExample && shown === 'schema'   && <SchemaTab   request={request} onChange={update} />}
                {!isExample && shown === 'docs'     && <DocsTab     request={request} onChange={update} />}
                {!isExample && shown === 'stream'   && <StreamTab   request={request} onChange={update} />}
              </>;
            })()}
          </div>
        </>
      )}
    </div>
  );
}
