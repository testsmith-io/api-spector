import { useState } from 'react';
import { useStore } from '../../store';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { v4 as uuidv4 } from 'uuid';
import type { ResponsePayload, MockRoute, ScriptExecutionMeta, SentRequest } from '../../../../shared/types';
import { getStatusColor } from '../../../../shared/colors';
import { InteractiveBody } from './InteractiveBody';

const { electron } = window;

type RespTab = 'body' | 'headers' | 'tests' | 'console' | 'request'

function prettyJson ( raw: string ): string {
  try {
    return JSON.stringify( JSON.parse( raw ), null, 2 );
  } catch {
    return raw;
  }
}

// ─── Save as mock modal ───────────────────────────────────────────────────────

function SaveAsMockModal ( { onClose }: { onClose: () => void } ) {
  const mocks = useStore( s => s.mocks );
  const addMock = useStore( s => s.addMock );
  const updateMock = useStore( s => s.updateMock );
  const collections = useStore( s => s.collections );
  const activeTab = useStore( s => s.tabs.find( t => t.id === s.activeTabId ) );
  const response = activeTab?.lastResponse ?? null as ResponsePayload | null;

  const activeRequestId = activeTab?.requestId ?? null;

  // Get the active request for method + URL
  const activeRequest = activeRequestId
    ? Object.values( collections ).find( c => c.data.requests[activeRequestId] )?.data.requests[activeRequestId]
    : null;

  // Extract path from URL
  function extractPath ( url: string ): string {
    try {
      return new URL( url ).pathname || '/';
    } catch {
      const match = url.match( /(?:https?:\/\/[^/]+)?(\/[^?]*)/ );
      return match?.[1] ?? '/';
    }
  }

  const [targetMockId, setTargetMockId] = useState<string>( Object.keys( mocks )[0] ?? '__new__' );
  const [newServerName, setNewServerName] = useState( 'Mock Server' );
  const [newServerPort, setNewServerPort] = useState( '3900' );
  const [method, setMethod] = useState<string>( activeRequest?.method ?? 'GET' );
  const [path, setPath] = useState( extractPath( activeRequest?.url ?? '/' ) );
  const [statusCode, setStatusCode] = useState( response.status );
  const [body, setBody] = useState( () => {
    try { return JSON.stringify( JSON.parse( response.body ), null, 2 ); } catch { return response.body; }
  } );
  const [saving, setSaving] = useState( false );

  const mockList = Object.values( mocks );
  const isNew = targetMockId === '__new__' || mockList.length === 0;

  async function save () {
    setSaving( true );
    try {
      const route: MockRoute = {
        id: uuidv4(),
        method: method as MockRoute['method'],
        path,
        statusCode,
        headers: {},
        body,
      };

      let serverId = targetMockId;
      if ( isNew ) {
        addMock();
        const state = useStore.getState();
        serverId = state.activeMockId!;
        const entry = state.mocks[serverId];
        const updated = { ...entry.data, name: newServerName, port: Number( newServerPort ), routes: [route] };
        updateMock( serverId, updated );
        await electron.saveMock( entry.relPath, updated );
        const ws = useStore.getState().workspace;
        if ( ws ) await electron.saveWorkspace( ws );
      } else {
        const entry = useStore.getState().mocks[serverId];
        const updated = { ...entry.data, routes: [...entry.data.routes, route] };
        updateMock( serverId, updated );
        await electron.saveMock( entry.relPath, updated );
      }
      onClose();
    } finally {
      setSaving( false );
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-20">
      <div
        className="bg-surface-900 border border-surface-800 rounded-lg shadow-2xl w-[520px] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-800">
          <h2 className="text-sm font-semibold">Save as mock route</h2>
          <button onClick={onClose} className="text-surface-400 hover:text-[var(--text-primary)] text-lg leading-none">×</button>
        </div>

        <div className="px-4 py-4 flex flex-col gap-3 text-xs overflow-y-auto max-h-[70vh]">

          {/* Server selection */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-surface-400 uppercase tracking-wider font-medium">Mock server</label>
            {mockList.length > 0 ? (
              <select
                value={targetMockId}
                onChange={e => setTargetMockId( e.target.value )}
                className="bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                style={{ color: 'var(--text-primary)' }}
              >
                {mockList.map( m => (
                  <option key={m.data.id} value={m.data.id}>{m.data.name} :{m.data.port}</option>
                ) )}
                <option value="__new__">+ Create new server</option>
              </select>
            ) : null}
          </div>

          {/* New server fields */}
          {isNew && (
            <div className="flex gap-2">
              <input
                value={newServerName}
                onChange={e => setNewServerName( e.target.value )}
                placeholder="Server name"
                className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              />
              <input
                value={newServerPort}
                onChange={e => setNewServerPort( e.target.value )}
                placeholder="Port"
                className="w-20 bg-surface-800 border border-surface-700 rounded px-2 py-1 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          {/* Route details */}
          <div className="flex gap-2">
            <select
              value={method}
              onChange={e => setMethod( e.target.value )}
              className="bg-surface-800 border border-surface-700 rounded px-2 py-1 font-bold text-[11px] focus:outline-none focus:border-blue-500"
              style={{ color: 'var(--text-primary)' }}
            >
              {['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map( m => (
                <option key={m} value={m}>{m}</option>
              ) )}
            </select>
            <input
              value={path}
              onChange={e => setPath( e.target.value )}
              placeholder="/path"
              className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 font-mono focus:outline-none focus:border-blue-500"
            />
            <input
              type="number"
              value={statusCode}
              onChange={e => setStatusCode( Number( e.target.value ) )}
              className="w-16 bg-surface-800 border border-surface-700 rounded px-2 py-1 font-mono text-center focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Body */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-surface-400 uppercase tracking-wider font-medium">Response body</label>
            <textarea
              value={body}
              onChange={e => setBody( e.target.value )}
              rows={6}
              className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1.5 font-mono text-[11px] focus:outline-none focus:border-blue-500 resize-y"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-surface-800 disabled:text-surface-400 rounded font-medium transition-colors"
            >
              {saving ? 'Saving…' : 'Add route'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-surface-800 hover:bg-surface-700 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Diff view ────────────────────────────────────────────────────────────────

type DiffLineType = 'equal' | 'removed' | 'added'
interface DiffLine { type: DiffLineType; text: string }

function computeLineDiff ( a: string, b: string ): DiffLine[] {
  const aLines = a.split( '\n' );
  const bLines = b.split( '\n' );
  // Simple LCS-based diff: O(n*m) but fine for response bodies
  const m = aLines.length;
  const n = bLines.length;
  // dp[i][j] = length of LCS for aLines[0..i-1] and bLines[0..j-1]
  const dp: number[][] = Array.from( { length: m + 1 }, () => new Array( n + 1 ).fill( 0 ) );
  for ( let i = 1; i <= m; i++ ) {
    for ( let j = 1; j <= n; j++ ) {
      dp[i][j] = aLines[i - 1] === bLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max( dp[i - 1][j], dp[i][j - 1] );
    }
  }
  // Backtrack
  const result: DiffLine[] = [];
  let i = m, j = n;
  while ( i > 0 || j > 0 ) {
    if ( i > 0 && j > 0 && aLines[i - 1] === bLines[j - 1] ) {
      result.unshift( { type: 'equal', text: aLines[i - 1] } );
      i--; j--;
    } else if ( j > 0 && ( i === 0 || dp[i][j - 1] >= dp[i - 1][j] ) ) {
      result.unshift( { type: 'added', text: bLines[j - 1] } );
      j--;
    } else {
      result.unshift( { type: 'removed', text: aLines[i - 1] } );
      i--;
    }
  }
  return result;
}

function DiffView ( { pinned, current }: { pinned: ResponsePayload; current: ResponsePayload } ) {
  const pinnedBody = prettyJson( pinned.body );
  const currentBody = prettyJson( current.body );
  const diffLines = computeLineDiff( pinnedBody, currentBody );

  const lineStyle: Record<DiffLineType, string> = {
    equal: 'text-surface-400',
    removed: 'bg-red-900/30 text-red-300',
    added: 'bg-emerald-900/30 text-emerald-300',
  };
  const linePrefix: Record<DiffLineType, string> = {
    equal: ' ',
    removed: '-',
    added: '+',
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Status row */}
      <div className="flex items-center gap-6 px-4 py-2 border-b border-surface-800 text-xs shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-surface-600 font-medium uppercase text-[10px] tracking-wider">Pinned</span>
          <span className={`font-bold ${getStatusColor( pinned.status )}`}>{pinned.status} {pinned.statusText}</span>
          <span className="text-surface-400">{pinned.durationMs}ms</span>
        </div>
        <span className="text-surface-400">vs</span>
        <div className="flex items-center gap-2">
          <span className="text-surface-600 font-medium uppercase text-[10px] tracking-wider">Current</span>
          <span className={`font-bold ${getStatusColor( current.status )}`}>{current.status} {current.statusText}</span>
          <span className="text-surface-400">{current.durationMs}ms</span>
        </div>
      </div>

      {/* Diff lines */}
      <div className="flex-1 overflow-auto font-mono text-xs px-2 py-2">
        {diffLines.map( ( line, idx ) => (
          <div
            key={idx}
            className={`flex gap-2 px-2 py-px leading-5 whitespace-pre-wrap ${lineStyle[line.type]}`}
          >
            <span className="select-none w-3 shrink-0 text-center">{linePrefix[line.type]}</span>
            <span className="break-all">{line.text}</span>
          </div>
        ) )}
        {diffLines.length === 0 && (
          <div className="flex items-center justify-center h-full text-surface-600">
            No differences found
          </div>
        )}
      </div>
    </div>
  );
}

export function ResponseViewer () {
  const activeTab = useStore( s => s.tabs.find( t => t.id === s.activeTabId ) );
  const activeTabId = useStore( s => s.activeTabId );
  const pinnedResponse = useStore( s => s.pinnedResponse );
  const setPinned = useStore( s => s.setPinnedResponse );
  const updateRequest = useStore( s => s.updateRequest );
  const setTabRequestTab = useStore( s => s.setTabRequestTab );
  const setTabScriptTab = useStore( s => s.setTabScriptTab );
  const isSending = activeTab?.isSending ?? false;
  const response = activeTab?.lastResponse ?? null;
  const scriptResult = activeTab?.lastScriptResult ?? null;
  const sentRequest = activeTab?.lastSentRequest ?? null;
  const requestId = activeTab?.requestId ?? null;
  const [tab, setTab] = useState<RespTab>( 'body' );
  const [diffMode, setDiffMode] = useState( false );
  const [showMockModal, setShowMockModal] = useState( false );
  const [bodyView, setBodyView] = useState<'tree' | 'raw'>( 'raw' );
  const [assertToast, setAssertToast] = useState( false );
  const [contractToast, setContractToast] = useState( false );

  async function saveAsContract () {
    if ( !response || !requestId || !activeTabId ) return;
    const schema: string | null = response.body
      ? await electron.inferContractSchema( response.body )
      : null;
    const contentType = response.headers['content-type'];
    const headers: { key: string; value: string; required: boolean }[] = contentType
      ? [{ key: 'content-type', value: contentType, required: true }]
      : [];
    updateRequest( requestId, {
      contract: {
        statusCode: response.status,
        headers,
        bodySchema: schema ?? '',
      },
    } );
    setTabRequestTab( activeTabId, 'contract' );
    setContractToast( true );
    setTimeout( () => setContractToast( false ), 2500 );
  }

  function handleAssert ( snippet: string ) {
    if ( !requestId ) return;
    const state = useStore.getState();
    const req = Object.values( state.collections )
      .find( c => c.data.requests[requestId] )?.data.requests[requestId];
    if ( !req ) return;
    const existing = req.postRequestScript ?? '';
    const sep = existing.trim() ? '\n\n' : '';
    updateRequest( requestId, { postRequestScript: existing + sep + snippet } );
    if ( activeTabId ) {
      setTabRequestTab( activeTabId, 'scripts' );
      setTabScriptTab( activeTabId, 'post' );
    }
    setAssertToast( true );
    setTimeout( () => setAssertToast( false ), 2500 );
  }

  if ( isSending ) {
    return (
      <div className="h-full flex items-center justify-center text-surface-400 text-sm">
        Sending...
      </div>
    );
  }

  if ( !response ) {
    return (
      <div className="h-full flex items-center justify-center text-surface-400 text-sm">
        Hit Send to see the response
      </div>
    );
  }

  if ( response.error ) {
    return (
      <div className="h-full flex flex-col p-4 gap-2">
        <div className="text-red-400 text-sm font-medium">Request failed</div>
        <pre className="text-xs text-red-300 whitespace-pre-wrap">{response.error}</pre>
      </div>
    );
  }

  const contentType = response.headers['content-type'] ?? '';
  const isJson = contentType.includes( 'json' );
  const isXml = !isJson && ( contentType.includes( 'xml' ) || contentType.includes( 'html' ) );
  const supportsTree = isJson || isXml;
  const displayBody = isJson ? prettyJson( response.body ) : response.body;

  const passedCount = scriptResult?.testResults.filter( t => t.passed ).length ?? 0;
  const totalCount = scriptResult?.testResults.length ?? 0;
  const consoleCount = scriptResult?.consoleOutput.length ?? 0;

  const tabList: { id: RespTab; label: string; badge?: number | string }[] = [
    { id: 'request', label: 'Request' },
    { id: 'body', label: 'Body' },
    { id: 'headers', label: 'Headers' },
    { id: 'tests', label: 'Tests', badge: totalCount > 0 ? `${passedCount}/${totalCount}` : undefined },
    { id: 'console', label: 'Console', badge: consoleCount > 0 ? consoleCount : undefined },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Status bar */}
      <div className="flex items-center gap-4 px-4 py-1.5 border-b border-surface-800 flex-shrink-0 overflow-x-auto">
        <span className={`text-sm font-bold shrink-0 ${getStatusColor( response.status )}`}>
          {response.status} {response.statusText}
        </span>
        <span className="text-xs text-surface-400 shrink-0">{response.durationMs}ms</span>
        <span className="text-xs text-surface-400 shrink-0">{( response.bodySize / 1024 ).toFixed( 1 )} KB</span>

        <div className="flex gap-0 ml-2 shrink-0">
          {tabList.map( t => (
            <button
              key={t.id}
              onClick={() => setTab( t.id )}
              className={`px-3 py-1 text-xs rounded transition-colors flex items-center gap-1 ${tab === t.id ? 'bg-surface-800 text-white' : 'text-surface-400 hover:text-white'
                }`}
            >
              {t.label}
              {t.badge !== undefined && (
                <span className={`text-[10px] px-1 rounded ${t.id === 'tests' && passedCount < totalCount
                  ? 'bg-red-800 text-red-200'
                  : 'bg-surface-700 text-white'
                  }`}>
                  {t.badge}
                </span>
              )}
            </button>
          ) )}
        </div>

        {/* Script errors */}
        {( scriptResult?.preScriptError || scriptResult?.postScriptError ) && (
          <span className="text-[10px] text-red-400 font-medium shrink-0">Script error</span>
        )}

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
                onClick={() => setBodyView( 'tree' )}
                className={`px-2 py-0.5 text-[10px] transition-colors ${bodyView === 'tree' ? 'bg-surface-700 text-white' : 'text-surface-600 hover:text-white'}`}
                title="Interactive tree view — click values to add assertions"
              >
                Tree
              </button>
              <button
                onClick={() => setBodyView( 'raw' )}
                className={`px-2 py-0.5 text-[10px] transition-colors ${bodyView === 'raw' ? 'bg-surface-700 text-white' : 'text-surface-600 hover:text-white'}`}
                title="Raw body view"
              >
                Raw
              </button>
            </div>
          )}

          {/* Pin button */}
          <button
            onClick={() => setPinned( response )}
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
              onClick={() => setDiffMode( d => !d )}
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
            onClick={() => setShowMockModal( true )}
            className="px-2 py-0.5 text-[10px] bg-surface-800 hover:bg-surface-700 rounded transition-colors"
            title="Save this response as a mock route"
          >
            ↓ Mock
          </button>
        </div>
      </div>

      {showMockModal && <SaveAsMockModal onClose={() => setShowMockModal( false )} />}

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
          <div className="flex-1 min-h-0 overflow-hidden">
            <CodeMirror
              value={displayBody}
              height="100%"
              theme={oneDark}
              extensions={isJson ? [json()] : []}
              readOnly
              basicSetup={{ lineNumbers: true, foldGutter: true }}
            />
          </div>
        ) : tab === 'headers' ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <table className="w-full text-xs px-4 py-2">
              <tbody>
                {Object.entries( response.headers ).map( ( [k, v] ) => (
                  <tr key={k} className="border-b border-surface-800">
                    <td className="py-1.5 px-4 text-surface-400 font-mono w-56 align-top">{k}</td>
                    <td className="py-1.5 px-4 text-white font-mono break-all">{v}</td>
                  </tr>
                ) )}
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

// ─── Tests panel ─────────────────────────────────────────────────────────────

function TestsPanel ( { scriptResult }: { scriptResult: ScriptExecutionMeta | null } ) {
  const sr = scriptResult as ScriptExecutionMeta | null;

  if ( !sr || ( sr.testResults.length === 0 && !sr.preScriptError && !sr.postScriptError ) ) {
    return (
      <div className="flex items-center justify-center h-full text-surface-400 text-xs">
        No tests ran. Add <code className="mx-1 bg-surface-800 px-1 rounded">pm.test()</code> calls to your post-response script.
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-2">
      {sr.preScriptError && (
        <div className="flex items-start gap-2 p-2 rounded bg-red-900/30 border border-red-700">
          <span className="text-red-400 text-xs font-bold shrink-0">PRE-SCRIPT ERROR</span>
          <span className="text-red-300 text-xs font-mono">{sr.preScriptError}</span>
        </div>
      )}
      {sr.postScriptError && (
        <div className="flex items-start gap-2 p-2 rounded bg-red-900/30 border border-red-700">
          <span className="text-red-400 text-xs font-bold shrink-0">POST-SCRIPT ERROR</span>
          <span className="text-red-300 text-xs font-mono">{sr.postScriptError}</span>
        </div>
      )}
      {sr.testResults.map( ( result, i ) => (
        <div
          key={i}
          className={`flex items-start gap-2 p-2 rounded border ${result.passed
            ? 'bg-emerald-900/20 border-emerald-800'
            : 'bg-red-900/20 border-red-800'
            }`}
        >
          <span className={`text-xs font-bold shrink-0 ${result.passed ? 'text-emerald-400' : 'text-red-400'}`}>
            {result.passed ? '✓' : '✗'}
          </span>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-white">{result.name}</span>
            {result.error && (
              <span className="text-[11px] text-red-300 font-mono">{result.error}</span>
            )}
          </div>
        </div>
      ) )}
    </div>
  );
}

// ─── Request panel ───────────────────────────────────────────────────────────

function RequestPanel ( { sentRequest }: { sentRequest: SentRequest | null } ) {
  if ( !sentRequest ) {
    return (
      <div className="flex items-center justify-center h-full text-surface-400 text-xs">
        Send a request to see what was transmitted.
      </div>
    );
  }

  const hasBody = sentRequest.body !== undefined && sentRequest.body !== '';

  return (
    <div className="flex-1 min-h-0 overflow-y-auto text-xs font-mono">
      {/* Request line */}
      <div className="px-4 py-3 border-b border-surface-800 flex items-center gap-3">
        <span className="font-bold text-blue-400 shrink-0">{sentRequest.method}</span>
        <span className="text-white break-all">{sentRequest.url}</span>
      </div>

      {/* Headers */}
      <div className="px-4 py-2 border-b border-surface-800">
        <p className="text-[10px] text-surface-400 uppercase tracking-wider font-medium mb-1.5">Headers</p>
        {Object.keys( sentRequest.headers ).length === 0 ? (
          <span className="text-surface-600">No headers sent</span>
        ) : (
          <table className="w-full">
            <tbody>
              {Object.entries( sentRequest.headers ).map( ( [k, v] ) => (
                <tr key={k} className="border-b border-surface-800/50 last:border-0">
                  <td className="py-1 pr-4 text-surface-400 w-56 align-top">{k}</td>
                  <td className="py-1 text-white break-all">{v}</td>
                </tr>
              ) )}
            </tbody>
          </table>
        )}
      </div>

      {/* Body */}
      {hasBody && (
        <div className="px-4 py-2">
          <p className="text-[10px] text-surface-400 uppercase tracking-wider font-medium mb-1.5">Body</p>
          <pre className="text-white whitespace-pre-wrap break-all text-[11px]">{sentRequest.body}</pre>
        </div>
      )}
    </div>
  );
}

// ─── Console panel ────────────────────────────────────────────────────────────

function ConsolePanel ( { scriptResult }: { scriptResult: ScriptExecutionMeta | null } ) {
  const sr = scriptResult as ScriptExecutionMeta | null;

  if ( !sr || sr.consoleOutput.length === 0 ) {
    return (
      <div className="flex items-center justify-center h-full text-surface-400 text-xs">
        No console output. Use <code className="mx-1 bg-surface-800 px-1 rounded">console.log()</code> in your scripts.
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-1">
      {sr.consoleOutput.map( ( line, i ) => (
        <div
          key={i}
          className={`text-xs font-mono py-0.5 border-b border-surface-800/50 last:border-0 ${line.startsWith( '[error]' ) ? 'text-red-300' :
            line.startsWith( '[warn]' ) ? 'text-amber-300' :
              line.startsWith( '[set]' ) ? 'text-cyan-400' :
                'text-surface-400'
            }`}
        >
          {line}
        </div>
      ) )}
    </div>
  );
}
