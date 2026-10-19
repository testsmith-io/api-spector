// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Run a GraphQL subscription over WebSocket (graphql-ws) and stream the results.
// Shown inside the GraphQL editor when the query is a subscription. The live
// connection lives in the main process (graphqlws-handler.ts); this panel emits
// subscribe/stop and renders the streamed payloads from the store.

import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { useVarValues } from '../../hooks/useVarValues';
import { RealtimeTestSection, useRealtimeTest } from '../common/RealtimeTestSection';
import { useT } from '../../i18n';
import type { ApiRequest, GraphQLBody, GraphQlWsMessage } from '../../../../shared/types';

const { electron } = window;

/** A GraphQL query defines a subscription when an operation starts with the
 *  `subscription` keyword. */
export function isSubscriptionQuery(query: string): boolean {
  return /(^|\n)\s*subscription\b/i.test(query ?? '');
}

export function deriveWsUrl(httpUrl: string): string {
  const u = httpUrl.trim();
  if (!u) return '';
  if (/^wss?:\/\//i.test(u)) return u;
  if (/^https:\/\//i.test(u)) return u.replace(/^https:\/\//i, 'wss://');
  if (/^http:\/\//i.test(u)) return u.replace(/^http:\/\//i, 'ws://');
  return u;
}

function fmt(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function pretty(data: string): string {
  try { return JSON.stringify(JSON.parse(data), null, 2); } catch { return data; }
}

export function GraphQlSubscription({ request, gql, onPatch }: {
  readonly request: ApiRequest
  readonly gql: GraphQLBody
  readonly onPatch: (patch: Partial<GraphQLBody>) => void
}) {
  const t = useT();
  const connections = useStore(s => s.graphqlWsConnections);
  const setStatus   = useStore(s => s.setGraphqlWsStatus);
  const clearLog    = useStore(s => s.clearGraphqlWsMessages);
  const vars = useVarValues();

  const conn = connections[request.id] ?? { status: 'disconnected', messages: [] as GraphQlWsMessage[] };
  const isActive = conn.status === 'connected' || conn.status === 'connecting';
  const [showParams, setShowParams] = useState(Boolean(gql.connectionParams?.trim()));
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [conn.messages.length]);

  const interp = (s: string) => (s ?? '').replace(/\{\{([^}]+)\}\}/g, (_m, k) => vars[String(k).trim()] ?? '');
  const urlPlaceholder = deriveWsUrl(interp(request.url)) || 'wss://example.com/graphql';

  async function subscribe() {
    const rawUrl = gql.subscriptionUrl?.trim() || request.url;
    const url = deriveWsUrl(interp(rawUrl));
    if (!url) { setStatus(request.id, 'error', t('No subscription URL')); return; }
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
      setStatus(request.id, 'error', err instanceof Error ? err.message : String(err));
    }
  }

  // Run the subscription as a test: a fresh connection subscribes, collects the
  // emitted payloads for the window, then asserts over sp.messages.
  const test = useRealtimeTest(async (collectMs) => {
    const rawUrl = gql.subscriptionUrl?.trim() || request.url;
    const url = deriveWsUrl(interp(rawUrl));
    const headers: Record<string, string> = {};
    for (const h of request.headers) if (h.enabled && h.key) headers[interp(h.key)] = interp(h.value);
    return electron.graphqlWsTest({
      url, headers,
      query: gql.query,
      variables: interp(gql.variables),
      operationName: gql.operationName,
      connectionParams: gql.connectionParams ? interp(gql.connectionParams) : undefined,
      collectMs,
      script: gql.subscriptionTestScript ?? '',
      collectionVars: vars,
    });
  });

  const statusColors: Record<string, string> = {
    connected: 'bg-emerald-500', connecting: 'bg-amber-400', error: 'bg-red-500', disconnected: 'bg-surface-600',
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-2 p-3">
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-fuchsia-300 font-medium">{t('Subscription (WebSocket)')}</span>
        <span className={`w-2 h-2 rounded-full ${statusColors[conn.status] ?? 'bg-surface-600'}`} title={conn.status} />
        {conn.messages.length > 0 && (
          <button onClick={() => clearLog(request.id)} className="ml-auto text-[10px] text-surface-600 hover:text-surface-400 transition-colors">{t('Clear')}</button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <input
          value={gql.subscriptionUrl ?? ''}
          onChange={e => onPatch({ subscriptionUrl: e.target.value })}
          disabled={isActive}
          placeholder={urlPlaceholder}
          className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-500 placeholder-surface-600 disabled:opacity-50"
        />
        {isActive ? (
          <button onClick={() => electron.graphqlWsStop(request.id)} className="px-3 py-1 bg-red-700 hover:bg-red-600 rounded text-xs font-medium transition-colors whitespace-nowrap">
            {conn.status === 'connecting' ? t('Connecting…') : t('Stop')}
          </button>
        ) : (
          <button onClick={subscribe} className="px-3 py-1 bg-fuchsia-700 hover:bg-fuchsia-600 rounded text-xs font-medium transition-colors whitespace-nowrap">
            {t('Subscribe')}
          </button>
        )}
      </div>

      <div className="flex-shrink-0">
        <button onClick={() => setShowParams(v => !v)} className="text-[10px] text-surface-600 hover:text-surface-300 transition-colors">
          <span className="text-[18px] leading-none">{showParams ? '▾' : '▸'}</span> {t('Connection params (JSON)')}
        </button>
        {showParams && (
          <input
            value={gql.connectionParams ?? ''}
            onChange={e => onPatch({ connectionParams: e.target.value })}
            disabled={isActive}
            placeholder='{"authToken": "{{token}}"}'
            className="w-full mt-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-500 placeholder-surface-700 disabled:opacity-50"
          />
        )}
      </div>

      {conn.status === 'error' && conn.error && (
        <div className="px-2 py-1 bg-red-900/40 border border-red-700/50 rounded text-[11px] text-red-400 flex-shrink-0">{conn.error}</div>
      )}

      {/* Live stream fills the remaining height */}
      <div className="flex-1 min-h-0 border border-surface-800 rounded bg-surface-950 overflow-y-auto">
        {conn.messages.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] text-surface-500">{t('No events yet. Subscribe to start streaming.')}</div>
        ) : (
          <div className="p-2 flex flex-col gap-1">
            {conn.messages.map(m => (
              <div key={m.id} className="text-[11px]">
                <span className="text-surface-600 font-mono mr-2">{fmt(m.timestamp)}</span>
                {m.kind === 'next' ? (
                  <pre className="inline-block align-top font-mono text-surface-300 whitespace-pre-wrap break-all">{pretty(m.data)}</pre>
                ) : m.kind === 'error' ? (
                  <span className="font-mono text-red-400 break-all">{pretty(m.data)}</span>
                ) : (
                  <span className="text-surface-500 italic">{m.data}</span>
                )}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      {/* Test: collect subscription payloads for a window, then assert */}
      <div className="flex-shrink-0 max-h-[45%] overflow-y-auto">
        <RealtimeTestSection
          defaultOpen
          buttonClass="bg-fuchsia-700 hover:bg-fuchsia-600"
          dotClass="text-fuchsia-400/70"
          hint={<>{t('The test opens its own connection, runs this subscription, collects payloads for the window, then asserts. Payloads are in')} <span className="font-mono text-surface-500">sp.messages</span> {t('(each has .data and .json()).')}</>}
          scriptPlaceholder={"sp.test('a payload arrives', () => {\n  const m = sp.messages[0];\n  sp.expect(m).to.exist;\n  sp.expect(m.json()).to.have.property('randomNumber');\n});"}
          testScript={gql.subscriptionTestScript ?? ''}
          collectMs={gql.subscriptionCollectMs ?? 3000}
          onChangeScript={s => onPatch({ subscriptionTestScript: s })}
          onChangeCollectMs={ms => onPatch({ subscriptionCollectMs: ms })}
          running={test.running}
          remaining={test.remaining}
          result={test.result}
          onRun={() => test.run(gql.subscriptionCollectMs ?? 3000)}
          runDisabled={!gql.query?.trim()}
        />
      </div>
    </div>
  );
}
