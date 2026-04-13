// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useState, useEffect, useRef } from 'react';
import { useStore } from './store';
import { useAutoSave } from './hooks/useAutoSave';
import { useWorkspaceLoader } from './hooks/useWorkspaceLoader';
import { CollectionTree } from './components/CollectionTree/CollectionTree';
import { RequestBuilder } from './components/RequestBuilder/RequestBuilder';
import { ResponseViewer } from './components/ResponseViewer/ResponseViewer';
import { GeneratorPanel } from './components/GeneratorPanel/GeneratorPanel';
import { HistoryPanel } from './components/History/HistoryPanel';
import { WelcomeScreen } from './components/common/WelcomeScreen';
import { Toolbar } from './components/common/Toolbar';
import { RunnerModal } from './components/Runner/RunnerModal';
import { CollectionPanel } from './components/CollectionPanel/CollectionPanel';
import { MockPanel } from './components/MockPanel/MockPanel';
import { MockDetailPanel } from './components/MockPanel/MockDetailPanel';
import { RecorderPanel } from './components/MockPanel/RecorderPanel';
import { ContractPanel } from './components/ContractPanel/ContractPanel';
import { ContractResultsPanel } from './components/ContractPanel/ContractResultsPanel';
import { GitPanel } from './components/GitPanel/GitPanel';
import { CommandPalette } from './components/common/CommandPalette';
import { DocsGeneratorModal } from './components/common/DocsGeneratorModal';

const { electron } = window;

// ─── Activity bar icons ───────────────────────────────────────────────────────

function IconCollections () {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
      <path d="M2 6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  );
}

function IconHistory () {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function IconMock () {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
      <path fillRule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm14 1a1 1 0 11-2 0 1 1 0 012 0zM2 13a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2v-2zm14 1a1 1 0 11-2 0 1 1 0 012 0z" clipRule="evenodd" />
    </svg>
  );
}

function IconContract () {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
      <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 14a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 5.477V17H13a1 1 0 110 2H7a1 1 0 110-2h2V5.477L6.237 6.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 14a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 3.323V3a1 1 0 011-1z" clipRule="evenodd" />
    </svg>
  );
}

function IconGit () {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <circle cx="6"  cy="6"  r="2.5" />
      <circle cx="6"  cy="18" r="2.5" />
      <circle cx="18" cy="6"  r="2.5" />
      <line x1="6" y1="8.5" x2="6"  y2="15.5" />
      <path d="M6 8.5 C6 13 18 10 18 8.5" />
    </svg>
  );
}

function ActivityBarBtn ( {
  active,
  onClick,
  title,
  badge,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  badge?: number
  children: React.ReactNode
} ) {
  return (
    <div className="relative group/ab">
      <button
        onClick={onClick}
        className={`relative w-10 h-10 flex items-center justify-center rounded transition-colors ${active
          ? 'text-white bg-surface-800'
          : 'text-surface-600 hover:text-surface-300 hover:bg-surface-800/50'
          }`}
      >
        {children}
        {badge !== undefined && badge > 0 && (
          <span className="absolute top-1 right-1 text-[9px] bg-surface-600 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center font-medium leading-none">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>
      <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 hidden group-hover/ab:block">
        <span className="whitespace-nowrap rounded px-2 py-1 text-[11px] bg-surface-900 text-[var(--text-primary)] border border-surface-700 shadow-lg">
          {title}
        </span>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

// ─── Method badge colors for tab bar ─────────────────────────────────────────

const TAB_METHOD_COLORS: Record<string, string> = {
  GET: 'text-emerald-400',
  POST: 'text-blue-400',
  PUT: 'text-amber-400',
  PATCH: 'text-orange-400',
  DELETE: 'text-red-400',
  HEAD: 'text-purple-400',
  OPTIONS: 'text-gray-400',
};

export default function App () {
  useAutoSave();
  const { applyWorkspace } = useWorkspaceLoader();
  const workspace = useStore( s => s.workspace );
  const collections = useStore( s => s.collections );
  const tabs = useStore( s => s.tabs );
  const activeTabId = useStore( s => s.activeTabId );
  const setActiveTabId = useStore( s => s.setActiveTabId );
  const closeTab = useStore( s => s.closeTab );
  const closeAllTabs = useStore( s => s.closeAllTabs );
  const closeOtherTabs = useStore( s => s.closeOtherTabs );
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; tabId: string } | null>( null );
  const showGeneratorPanel = useStore( s => s.showGeneratorPanel );
  const sidebarTab = useStore( s => s.sidebarTab );
  const setSidebarTab = useStore( s => s.setSidebarTab );
  const historyCount = useStore( s => s.history.length );
  const addCollection = useStore( s => s.addCollection );
  const addMockHit = useStore( s => s.addMockHit );
  const activeMockId       = useStore( s => s.activeMockId );
  const recorderRunning       = useStore( s => s.recorderRunning );
  const recorderTargetMockId  = useStore( s => s.recorderTargetMockId );
  const setRecorderRunning    = useStore( s => s.setRecorderRunning );
  const loadMock           = useStore( s => s.loadMock );
  const setActiveMockId    = useStore( s => s.setActiveMockId );
  const updateMock         = useStore( s => s.updateMock );
  const theme = useStore( s => s.theme );
  const setCommandPaletteOpen = useStore( s => s.setCommandPaletteOpen );
  const setWsStatus = useStore( s => s.setWsStatus );
  const addWsMessage = useStore( s => s.addWsMessage );

  const [sidebarOpen, setSidebarOpen] = useState( true );
  const [responseOpen, setResponseOpen] = useState( false );
  const [docsModalOpen, setDocsModalOpen] = useState( false );
  const [sidebarWidth, setSidebarWidth] = useState( 256 );
  const [requestPaneWidth, setRequestPaneWidth] = useState<number | null>( null );
  const dragging = useRef<'sidebar' | 'request' | null>( null );
  const dragStart = useRef( { x: 0, w: 0 } );
  const leftPaneRef = useRef<HTMLDivElement>( null );

  useEffect( () => {
    function onMouseMove ( e: MouseEvent ) {
      if ( !dragging.current ) return;
      const delta = e.clientX - dragStart.current.x;
      if ( dragging.current === 'sidebar' ) {
        setSidebarWidth( Math.max( 160, Math.min( 520, dragStart.current.w + delta ) ) );
      } else {
        setRequestPaneWidth( Math.max( 200, Math.min( window.innerWidth - 300, dragStart.current.w + delta ) ) );
      }
    }
    function onMouseUp () {
      if ( !dragging.current ) return;
      dragging.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener( 'mousemove', onMouseMove );
    window.addEventListener( 'mouseup', onMouseUp );
    return () => {
      window.removeEventListener( 'mousemove', onMouseMove );
      window.removeEventListener( 'mouseup', onMouseUp );
    };
  }, [] );

  // Auto-load last opened workspace on startup
  useEffect( () => {
    electron.getLastWorkspace().then( ( result: { workspace: unknown; workspacePath: string } | null ) => {
      if ( result ) applyWorkspace( result.workspace, result.workspacePath );
    } );
  }, [applyWorkspace] );

  useEffect( () => {
    electron.onMockHit( addMockHit );
    return () => electron.offMockHit();
  }, [addMockHit] );

  useEffect( () => {
    electron.onWsMessage( ( { requestId, message }: { requestId: string; message: Parameters<typeof addWsMessage>[1] } ) => {
      addWsMessage( requestId, message );
    } );
    electron.onWsStatus( ( { requestId, status, error }: { requestId: string; status: Parameters<typeof setWsStatus>[1]; error?: string } ) => {
      setWsStatus( requestId, status, error );
    } );
    return () => electron.offWsEvents();
  }, [addWsMessage, setWsStatus] );

  useEffect( () => {
    function handleKeyDown ( e: KeyboardEvent ) {
      if ( e.key === 'k' && ( e.metaKey || e.ctrlKey ) ) {
        e.preventDefault();
        setCommandPaletteOpen( true );
      }
    }
    window.addEventListener( 'keydown', handleKeyDown );
    return () => window.removeEventListener( 'keydown', handleKeyDown );
  }, [setCommandPaletteOpen] );

  // Keep light class in sync when OS preference changes (system theme)
  useEffect( () => {
    if ( theme !== 'system' ) return;
    const mq = window.matchMedia( '(prefers-color-scheme: dark)' );
    const handler = ( e: MediaQueryListEvent ) =>
      document.documentElement.classList.toggle( 'light', !e.matches );
    mq.addEventListener( 'change', handler );
    return () => mq.removeEventListener( 'change', handler );
  }, [theme] );

  const activeTab = tabs.find( t => t.id === activeTabId ) ?? null;
  const activeRequest = activeTab?.requestId
    ? Object.values( collections ).find( c => c.data.requests[activeTab.requestId!] )?.data.requests[activeTab.requestId!]
    : null;

  // The response panel mirrors whether the *active tab* has a response yet.
  // Open as soon as one arrives (or when switching to a tab that has one),
  // collapse again when switching to a tab that hasn't been sent. The user
  // can still toggle manually after the initial state is set.
  useEffect( () => {
    setResponseOpen( Boolean( activeTab?.lastResponse ) );
  }, [activeTabId, activeTab?.lastResponse] );

  function selectPanel ( tab: 'collections' | 'history' | 'mocks' | 'contracts' | 'git' ) {
    if ( sidebarTab === tab && sidebarOpen ) {
      setSidebarOpen( false );
    } else {
      setSidebarTab( tab );
      setSidebarOpen( true );
    }
  }

  return (
    <div className="flex flex-col h-screen bg-surface-950" style={{ color: 'var(--text-primary)' }}>
      <RunnerModal />
      <CommandPalette />
      {docsModalOpen && <DocsGeneratorModal onClose={() => setDocsModalOpen( false )} />}
      {/* macOS drag region with centered title — hidden on Windows (native title bar used instead) */}
      {window.electron.platform !== 'win32' && (
        <div className="drag-region flex-shrink-0 bg-surface-950 flex items-center justify-center">
          <span className="no-drag text-[11px] font-medium tracking-widest select-none" style={{ color: 'var(--text-muted)' }}>
            api <span style={{ color: '#6aa3c8' }}>Spector</span>
            {__APP_VERSION__ && <span className="ml-2 text-[10px] font-normal opacity-50">v{__APP_VERSION__}</span>}
            <span className="mx-2 opacity-30">·</span>
            <button
              onClick={() => window.electron.openExternal('https://testsmith.io')}
              className="no-drag text-[10px] font-normal opacity-60 hover:opacity-100 hover:underline focus:outline-none transition-opacity"
              style={{ color: '#6aa3c8' }}
            >
              testsmith.io
            </button>
          </span>
        </div>
      )}

      {/* Header */}
      <Toolbar onOpenDocs={() => setDocsModalOpen( true )} />

      {workspace ? (
        <div className="flex flex-1 min-h-0">
          {/* Activity bar (icon rail) */}
          <div className="w-12 flex-shrink-0 flex flex-col items-center pt-1 gap-0.5 border-r border-surface-800 bg-surface-950">
            <ActivityBarBtn
              active={sidebarOpen && sidebarTab === 'collections'}
              onClick={() => selectPanel( 'collections' )}
              title="Collections"
            >
              <IconCollections />
            </ActivityBarBtn>
            <ActivityBarBtn
              active={sidebarOpen && sidebarTab === 'history'}
              onClick={() => selectPanel( 'history' )}
              title="History"
              badge={historyCount}
            >
              <IconHistory />
            </ActivityBarBtn>
            <ActivityBarBtn
              active={sidebarOpen && sidebarTab === 'mocks'}
              onClick={() => selectPanel( 'mocks' )}
              title="Mock servers"
            >
              <IconMock />
            </ActivityBarBtn>
            <ActivityBarBtn
              active={sidebarOpen && sidebarTab === 'contracts'}
              onClick={() => selectPanel( 'contracts' )}
              title="Contract testing"
            >
              <IconContract />
            </ActivityBarBtn>
            <ActivityBarBtn
              active={sidebarOpen && sidebarTab === 'git'}
              onClick={() => selectPanel( 'git' )}
              title="Git"
            >
              <IconGit />
            </ActivityBarBtn>
          </div>

          {/* Side panel */}
          {sidebarOpen ? (
            <>
              <aside style={{ width: sidebarWidth }} className="flex-shrink-0 flex flex-col overflow-hidden">
                <div className="px-3 py-2 flex items-center justify-between border-b border-surface-800 flex-shrink-0">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-surface-600">
                    {sidebarTab === 'collections' ? 'Collections' : sidebarTab === 'history' ? 'History' : sidebarTab === 'mocks' ? 'Mocks' : sidebarTab === 'git' ? 'Git' : 'Contracts'}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {sidebarTab === 'history' && historyCount > 0 && (
                      <span className="text-[10px] bg-surface-700 text-surface-400 rounded px-1.5 py-0.5">
                        {historyCount}
                      </span>
                    )}
                    {sidebarTab === 'collections' && (
                      <button
                        onClick={() => addCollection( 'New Collection' )}
                        title="New collection"
                        className="text-surface-600 hover:text-surface-300 transition-colors text-sm leading-none px-0.5"
                      >+</button>
                    )}
                    <button
                      onClick={() => setSidebarOpen( false )}
                      title="Collapse sidebar"
                      className="text-surface-600 hover:text-surface-300 transition-colors text-sm leading-none px-0.5"
                    >‹</button>
                  </div>
                </div>
                {sidebarTab === 'collections' ? <CollectionTree /> :
                  sidebarTab === 'history' ? <HistoryPanel /> :
                    sidebarTab === 'mocks' ? <MockPanel /> :
                      sidebarTab === 'git' ? <GitPanel /> :
                        <ContractPanel />}
              </aside>
              {/* Sidebar resize handle */}
              <div
                className="flex-shrink-0 w-1 cursor-col-resize border-r border-surface-800 hover:border-blue-500 transition-colors"
                onMouseDown={e => {
                  dragging.current = 'sidebar';
                  dragStart.current = { x: e.clientX, w: sidebarWidth };
                  document.body.style.cursor = 'col-resize';
                  document.body.style.userSelect = 'none';
                  e.preventDefault();
                }}
              />
            </>
          ) : (
            <button
              onClick={() => setSidebarOpen( true )}
              title="Expand sidebar"
              className="flex-shrink-0 w-5 flex items-center justify-center border-r border-surface-800 bg-surface-950 hover:bg-surface-800 text-surface-700 hover:text-surface-300 transition-colors"
            >
              <span className="text-xs">›</span>
            </button>
          )}

          {/* Main area */}
          <main className="flex-1 min-w-0 flex flex-col min-h-0">
            {/* Tab bar */}
            {tabs.length > 0 && (
              <div className="flex items-center border-b border-surface-800 bg-surface-950 flex-shrink-0">
                <div className="flex items-center overflow-x-auto flex-1 min-w-0">
                  {tabs.map( tab => {
                    const req = tab.requestId
                      ? Object.values( collections ).find( c => c.data.requests[tab.requestId!] )?.data.requests[tab.requestId!]
                      : null;
                    const isActive = tab.id === activeTabId;
                    return (
                      <div
                        key={tab.id}
                        onClick={() => setActiveTabId( tab.id )}
                        onContextMenu={e => {
                          e.preventDefault();
                          setTabContextMenu( { x: e.clientX, y: e.clientY, tabId: tab.id } );
                        }}
                        className={`group flex items-center gap-1.5 px-3 py-1.5 border-r border-surface-800 cursor-pointer min-w-0 max-w-[200px] flex-shrink-0 transition-colors ${isActive
                          ? 'bg-surface-900 border-b-2 border-b-blue-500 -mb-px'
                          : 'hover:bg-surface-900/50 text-surface-600'
                          }`}
                      >
                        {req && (
                          <span className={`text-[10px] font-bold shrink-0 ${TAB_METHOD_COLORS[req.method] ?? 'text-gray-400'}`}>
                            {req.method}
                          </span>
                        )}
                        <span className={`text-xs truncate ${isActive ? 'text-white' : ''}`}>
                          {req?.name ?? 'Untitled'}
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); closeTab( tab.id ); }}
                          className="ml-auto opacity-0 group-hover:opacity-100 shrink-0 text-surface-600 hover:text-white transition-all leading-none"
                          title="Close tab"
                        >
                          ×
                        </button>
                      </div>
                    );
                  } )}
                </div>
                {/* Close-all button, always at the far right of the tab strip */}
                <button
                  onClick={closeAllTabs}
                  title="Close all tabs"
                  className="flex-shrink-0 px-2 py-1.5 text-surface-500 hover:text-white hover:bg-surface-900/50 border-l border-surface-800 text-xs leading-none transition-colors"
                >
                  ⨯ all
                </button>
              </div>
            )}

            {/* Tab context menu */}
            {tabContextMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setTabContextMenu( null )}
                  onContextMenu={e => { e.preventDefault(); setTabContextMenu( null ); }}
                />
                <div
                  className="fixed z-50 bg-surface-900 border border-surface-700 rounded shadow-2xl py-1 text-xs min-w-[160px]"
                  style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
                >
                  <button
                    onClick={() => { closeTab( tabContextMenu.tabId ); setTabContextMenu( null ); }}
                    className="w-full text-left px-3 py-1.5 text-surface-300 hover:bg-surface-800 hover:text-white transition-colors"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => { closeOtherTabs( tabContextMenu.tabId ); setTabContextMenu( null ); }}
                    disabled={tabs.length < 2}
                    className="w-full text-left px-3 py-1.5 text-surface-300 hover:bg-surface-800 hover:text-white disabled:text-surface-600 disabled:hover:bg-transparent transition-colors"
                  >
                    Close others
                  </button>
                  <button
                    onClick={() => { closeAllTabs(); setTabContextMenu( null ); }}
                    className="w-full text-left px-3 py-1.5 text-surface-300 hover:bg-surface-800 hover:text-white transition-colors"
                  >
                    Close all
                  </button>
                </div>
              </>
            )}

            {sidebarTab === 'contracts' ? (
              <div className="flex-1 min-h-0">
                <ContractResultsPanel />
              </div>
            ) : sidebarTab === 'mocks' && recorderRunning ? (
              <div className="flex-1 min-h-0">
                <RecorderPanel
                  defaultTargetMockId={recorderTargetMockId}
                  onClose={() => setRecorderRunning(false)}
                  onImportMock={async (session, targetMockId) => {
                    const name = `Recorded — ${new URL(session.upstream).hostname}`;
                    const newRoutes = await electron.recordToMock(session.entries, session.upstream, name, session.port);

                    if (targetMockId) {
                      // Append routes to existing mock server, skipping duplicates
                      const existing = useStore.getState().mocks[targetMockId];
                      if (existing) {
                        const existingKeys = new Set(existing.data.routes.map(r => `${r.method}:${r.path}`));
                        const toAdd = newRoutes.routes.filter((r: { method: string; path: string }) => !existingKeys.has(`${r.method}:${r.path}`));
                        const updated = { ...existing.data, routes: [...existing.data.routes, ...toAdd] };
                        updateMock(targetMockId, updated);
                        await electron.saveMock(existing.relPath, updated);
                        setActiveMockId(targetMockId);
                        setRecorderRunning(false);
                      }
                    } else {
                      // Create new mock server, register in workspace
                      const relPath = `mocks/${newRoutes.id}.mock.json`;
                      loadMock(relPath, newRoutes);
                      await electron.saveMock(relPath, newRoutes);
                      const ws = useStore.getState().workspace;
                      if (ws) {
                        if (!ws.mocks) ws.mocks = [];
                        ws.mocks.push(relPath);
                        await electron.saveWorkspace(ws);
                      }
                      setActiveMockId(newRoutes.id);
                      setRecorderRunning(false);
                    }
                  }}
                />
              </div>
            ) : sidebarTab === 'mocks' && activeMockId ? (
              <div className="flex-1 min-h-0">
                <MockDetailPanel mockId={activeMockId} />
              </div>
            ) : activeRequest ? (
              <div className="flex-1 flex min-h-0">
                {/* Left pane: request builder */}
                <div
                  ref={leftPaneRef}
                  className="min-w-0 flex flex-col overflow-hidden"
                  style={!responseOpen || requestPaneWidth === null ? { flex: '1 1 0%' } : { width: requestPaneWidth, flexShrink: 0 }}
                >
                  <RequestBuilder request={activeRequest} />
                </div>
                {/* Resize + collapse handle */}
                <div
                  className="flex-shrink-0 w-1 relative cursor-col-resize border-x border-surface-800 hover:border-blue-500 transition-colors group"
                  onMouseDown={e => {
                    dragging.current = 'request';
                    dragStart.current = { x: e.clientX, w: leftPaneRef.current?.offsetWidth ?? requestPaneWidth ?? 400 };
                    document.body.style.cursor = 'col-resize';
                    document.body.style.userSelect = 'none';
                    e.preventDefault();
                  }}
                >
                  <button
                    onClick={() => setResponseOpen( v => !v )}
                    title={responseOpen ? 'Collapse response' : 'Expand response'}
                    className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-4 h-8 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 bg-surface-800 text-surface-400 hover:text-white transition-all text-xs z-10"
                  >
                    {responseOpen ? '›' : '‹'}
                  </button>
                </div>
                {/* Right pane: response viewer */}
                {responseOpen && (
                  <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                    <ResponseViewer />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 min-h-0">
                <CollectionPanel />
              </div>
            )}
          </main>

          {/* Generator panel (right drawer) */}
          {showGeneratorPanel && (
            <aside className="w-[480px] flex-shrink-0 border-l border-surface-800 flex flex-col overflow-hidden">
              <GeneratorPanel />
            </aside>
          )}
        </div>
      ) : (
        <WelcomeScreen />
      )}
    </div>
  );
}
