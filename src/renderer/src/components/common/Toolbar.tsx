// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useRef, useState, type ReactNode } from 'react';
import { useStore, colRelPath } from '../../store';
import type { Collection, Flow } from '../../../../shared/types';
import { EnvironmentBar } from '../EnvironmentBar/EnvironmentBar';
import { WorkspaceSettingsModal } from './WorkspaceSettingsModal';
import { DocsGeneratorModal } from './DocsGeneratorModal';
import { ImportModal } from './ImportModal';
import { useWorkspaceLoader } from '../../hooks/useWorkspaceLoader';
import { GearIcon } from './icons';
import { Tooltip } from './Tooltip';
import { useT } from '../../i18n';

// Small document icon for the "Generate docs" action (stroke style matches the
// shared icon set). Kept local since it is only used here.
function DocIcon () {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5M8.5 13h7M8.5 16.5h5" />
    </svg>
  );
}

// Import icon (arrow down into a tray).
function ImportIcon () {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v10m0 0l-3.5-3.5M12 13l3.5-3.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" />
    </svg>
  );
}

// ─── Workspace-action icons (stroke style matches the shared set) ────────────
function Svg ({ children }: { readonly children: ReactNode }) {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}
// Open workspace (folder-open).
const OpenWsIcon = () => <Svg><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.75h16.5a1.5 1.5 0 011.47 1.8l-1.2 6a1.5 1.5 0 01-1.47 1.2H4.95a1.5 1.5 0 01-1.47-1.2l-1.2-6a1.5 1.5 0 011.47-1.8zM3.75 9.75V6.75A1.5 1.5 0 015.25 5.25h3.88a1.5 1.5 0 011.06.44l1.12 1.12a1.5 1.5 0 001.06.44h4.88a1.5 1.5 0 011.5 1.5v.56" /></Svg>;
// New workspace (folder with a plus).
const NewWsIcon = () => <Svg><path strokeLinecap="round" strokeLinejoin="round" d="M12 11v5m2.5-2.5h-5M3.75 7.5V18a1.5 1.5 0 001.5 1.5h13.5A1.5 1.5 0 0020.25 18V9a1.5 1.5 0 00-1.5-1.5h-5.19a1.5 1.5 0 01-1.06-.44l-1.12-1.12a1.5 1.5 0 00-1.06-.44H5.25a1.5 1.5 0 00-1.5 1.5z" /></Svg>;
// Close workspace (x).
const CloseWsIcon = () => <Svg><path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" /></Svg>;
// Save (floppy disk).
const SaveIcon = () => <Svg><path strokeLinecap="round" strokeLinejoin="round" d="M5 4h11l3 3v12a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z" /><path strokeLinecap="round" strokeLinejoin="round" d="M8 4v4h6V4M8 13h8v6H8z" /></Svg>;

const { electron } = window;

// ─── Toolbar ──────────────────────────────────────────────────────────────────

export function Toolbar({ onOpenDocs: _onOpenDocs }: { readonly onOpenDocs?: () => void }) {
  const t = useT();
  const { applyWorkspace } = useWorkspaceLoader();
  const workspace = useStore(s => s.workspace);
  const closeWorkspace = useStore(s => s.closeWorkspace);
  const collections = useStore(s => s.collections);
  const environments = useStore(s => s.environments);
  const markCollectionClean = useStore(s => s.markCollectionClean);
  const showGeneratorPanel = useStore(s => s.showGeneratorPanel);
  const setShowGeneratorPanel = useStore(s => s.setShowGeneratorPanel);
  const loadCollection = useStore(s => s.loadCollection);
  const setActiveCollection = useStore(s => s.setActiveCollection);
  const workspaceSettingsOpen = useStore(s => s.workspaceSettingsOpen);
  const workspaceSettingsTab = useStore(s => s.workspaceSettingsTab);
  const setWorkspaceSettingsOpen = useStore(s => s.setWorkspaceSettingsOpen);

  const [saving, setSaving]       = useState(false);
  const [docsOpen, setDocsOpen]   = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const hasDirty = Object.values(collections).some(c => c.dirty);

  async function saveAll() {
    setSaving(true);
    try {
      for (const { relPath, data, dirty } of Object.values(collections)) {
        if (!dirty) continue;
        await electron.saveCollection(relPath, data);
        markCollectionClean(data.id);
      }
      for (const { relPath, data } of Object.values(environments)) {
        await electron.saveEnvironment(relPath, data);
      }
      if (workspace) await electron.saveWorkspace(workspace);
    } finally {
      setSaving(false);
    }
  }

  async function afterImport(col: Collection | null, extras?: { flows?: Flow[] }) {
    if (!col) return;
    const relPath = colRelPath(col.name, col.id);
    await electron.saveCollection(relPath, col);
    loadCollection(relPath, col);
    setActiveCollection(col.id);
    const ws = useStore.getState().workspace;
    if (ws && !ws.collections.includes(relPath)) {
      const updated = { ...ws, collections: [...ws.collections, relPath] };
      useStore.setState({ workspace: updated });
      await electron.saveWorkspace(updated);
    }
    // Arazzo import also brings flows — register each, open the last, and switch
    // the sidebar to the Flows view so the imported workflow is visible.
    if (extras?.flows?.length) {
      const store = useStore.getState();
      let lastId = '';
      for (const flow of extras.flows) lastId = store.addFlowObject(flow);
      if (lastId) store.setActiveFlow(lastId);
      store.setSidebarTab('flows');
    }
  }

  // Guard so rapid clicks on Open/New WS can't stack multiple native dialogs.
  // busyRef is the race-free guard (synchronous); wsBusy drives the disabled UI.
  const wsBusyRef = useRef(false);
  const [wsBusy, setWsBusy] = useState(false);

  async function openWs() {
    if (wsBusyRef.current) return;
    wsBusyRef.current = true; setWsBusy(true);
    try {
      const result = await electron.openWorkspace();
      if (result) await applyWorkspace(result.workspace, result.workspacePath);
    } finally {
      wsBusyRef.current = false; setWsBusy(false);
    }
  }

  async function newWs() {
    if (wsBusyRef.current) return;
    wsBusyRef.current = true; setWsBusy(true);
    try {
      const result = await electron.newWorkspace();
      if (result) await applyWorkspace(result.workspace, result.workspacePath);
    } finally {
      wsBusyRef.current = false; setWsBusy(false);
    }
  }

  if (!workspace) return null;

  return (
    <div className="no-drag bg-surface-950 border-b border-surface-800 flex-shrink-0">
      {workspaceSettingsOpen && (
        <WorkspaceSettingsModal initialTab={workspaceSettingsTab} onClose={() => setWorkspaceSettingsOpen(false)} />
      )}
      {docsOpen && (
        <DocsGeneratorModal onClose={() => setDocsOpen(false)} />
      )}
      {importOpen && (
        <ImportModal onImport={afterImport} onClose={() => setImportOpen(false)} />
      )}
      <div className="flex items-center min-w-0">
        {/* ── Scrollable left section ── */}
        <div className="flex items-center gap-2 px-3 py-1.5 overflow-x-auto min-w-0 flex-1">
          {/* App logo */}
          <style>{`
            @keyframes eyeRoll {
              0%,  18% { transform: translate(0px,   0px); }
              23%      { transform: translate(-7px, -5px); }
              28%      { transform: translate(0px,  -8px); }
              33%      { transform: translate(7px,  -5px); }
              38%      { transform: translate(9px,   0px); }
              43%      { transform: translate(7px,   5px); }
              48%      { transform: translate(0px,   7px); }
              53%      { transform: translate(-7px,  5px); }
              58%      { transform: translate(-9px,  0px); }
              63%      { transform: translate(0px,   0px); }
              100%     { transform: translate(0px,   0px); }
            }
            .logo-pupil {
              transform-box: fill-box;
              transform-origin: center;
              animation: eyeRoll 5s ease-in-out infinite;
            }
            .logo-pupil-r { animation-delay: 0.04s; }
          `}</style>
          <div className="flex items-center gap-1.5 mr-1 shrink-0 select-none">
            <button
              onClick={() => window.electron.openExternal('https://api-spector.dev')}
              title={t('Open api-spector.dev')}
              aria-label={t('API Spector home')}
              className="shrink-0 focus:outline-none rounded hover:opacity-80 transition-opacity cursor-pointer"
            >
            <svg width="52" height="52" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <radialGradient id="logoBody" cx="35%" cy="22%" r="70%">
                  <stop offset="0%" stopColor="#5497c8"/>
                  <stop offset="55%" stopColor="#205d96"/>
                  <stop offset="100%" stopColor="#123a60"/>
                </radialGradient>
                <linearGradient id="logoGloss" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="white" stopOpacity="0.45"/>
                  <stop offset="100%" stopColor="white" stopOpacity="0"/>
                </linearGradient>
                <clipPath id="logoGhostClip">
                  <path d="M 130,225 C 130,95 382,95 382,225 L 382,390 Q 340,435 298,390 Q 256,435 214,390 Q 172,435 130,390 Z"/>
                </clipPath>
              </defs>
              <path d="M 130,225 C 130,95 382,95 382,225 L 382,390 Q 340,435 298,390 Q 256,435 214,390 Q 172,435 130,390 Z" fill="url(#logoBody)"/>
              <ellipse cx="198" cy="262" rx="29" ry="33" fill="white"/>
              <ellipse cx="314" cy="262" rx="29" ry="33" fill="white"/>
              <ellipse cx="204" cy="268" rx="16" ry="20" fill="#0b1624" className="logo-pupil"/>
              <ellipse cx="320" cy="268" rx="16" ry="20" fill="#0b1624" className="logo-pupil logo-pupil-r"/>
              <ellipse cx="194" cy="254" rx="6" ry="7" fill="white" opacity="0.65"/>
              <ellipse cx="310" cy="254" rx="6" ry="7" fill="white" opacity="0.65"/>
              <ellipse cx="256" cy="100" rx="200" ry="180" fill="url(#logoGloss)" clipPath="url(#logoGhostClip)"/>
            </svg>
            </button>
            <div className="flex flex-col leading-tight">
              <button
                onClick={() => window.electron.openExternal('https://api-spector.dev')}
                title={t('Open api-spector.dev')}
                className="text-xs font-semibold tracking-wide text-left hover:underline focus:outline-none cursor-pointer"
              >
                <span style={{ color: 'var(--wordmark-muted)' }}>API</span> <span style={{ color: 'var(--wordmark-accent)' }}>Spector</span>
              </button>
              <button
                onClick={() => window.electron.openExternal('https://testsmith.io')}
                className="text-[9px] tracking-wide hover:underline focus:outline-none text-left"
                style={{ color: 'var(--text-muted)' }}
              >
                {t('by Testsmith')}
              </button>
            </div>
          </div>

          {/* Environment controls (inline) */}
          <span className="text-surface-600 text-xs shrink-0">{t('ENV')}</span>
          <EnvironmentBar inline />
        </div>

        {/* ── Fixed right section (popovers live here, no overflow clipping) ── */}
        <div className="flex items-center gap-2 px-3 py-1.5 shrink-0 border-l border-surface-800">
          {/* Workspace group: open / new / close / save, then a separator + import */}
          <span className="text-surface-600 text-xs shrink-0">{t('Workspace')}</span>
          <Tooltip label={t('Open a different workspace')}>
            <button
              onClick={openWs}
              disabled={wsBusy}
              className="p-1.5 bg-surface-800 hover:bg-surface-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={t('Open a different workspace')}
            >
              <OpenWsIcon />
            </button>
          </Tooltip>
          <Tooltip label={t('Create a new workspace')}>
            <button
              onClick={newWs}
              disabled={wsBusy}
              className="p-1.5 bg-surface-800 hover:bg-surface-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={t('Create a new workspace')}
            >
              <NewWsIcon />
            </button>
          </Tooltip>
          <Tooltip label={t('Close current workspace')}>
            <button
              onClick={async () => {
                await electron.closeWorkspace();
                closeWorkspace();
              }}
              className="p-1.5 bg-surface-800 hover:bg-surface-700 rounded transition-colors"
              aria-label={t('Close current workspace')}
            >
              <CloseWsIcon />
            </button>
          </Tooltip>

          {/* Save (keeps the dirty indicator: blue + amber dot) */}
          <Tooltip label={saving ? t('Saving…') : t('Save all unsaved changes')}>
            <button
              onClick={saveAll}
              disabled={saving}
              className={`relative p-1.5 rounded transition-colors ${
                hasDirty
                  ? 'bg-blue-700 hover:bg-blue-600 text-white'
                  : 'bg-surface-800 hover:bg-surface-700 text-surface-500'
              } ${saving ? 'opacity-60' : ''}`}
              aria-label={t('Save all unsaved changes')}
            >
              <SaveIcon />
              {hasDirty && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" />}
            </button>
          </Tooltip>

          {/* Separator */}
          <div className="w-px h-4 bg-surface-800 mx-1 shrink-0" />

          {/* Import (icon) */}
          <Tooltip label={t('Import collection (Postman, OpenAPI, Insomnia, Bruno)')}>
            <button
              onClick={() => setImportOpen(true)}
              className="p-1.5 bg-surface-800 hover:bg-surface-700 rounded transition-colors"
              aria-label={t('Import collection (Postman, OpenAPI, Insomnia, Bruno)')}
            >
              <ImportIcon />
            </button>
          </Tooltip>

          {/* Section separator */}
          <div className="w-px h-4 bg-surface-800 mx-1 shrink-0" />

          {/* Generate group: Docs + code generator, as compact icon buttons */}
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-surface-600 text-xs">{t('Generate')}</span>
            <Tooltip label={t('Generate API documentation')}>
              <button
                onClick={() => setDocsOpen(true)}
                className="p-1.5 bg-surface-800 hover:bg-surface-700 rounded transition-colors"
                aria-label={t('Generate API documentation')}
              >
                <DocIcon />
              </button>
            </Tooltip>
            <Tooltip label={t('Toggle code generator')}>
              <button
                onClick={() => setShowGeneratorPanel(!showGeneratorPanel)}
                className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                  showGeneratorPanel ? 'bg-blue-700 text-white' : 'bg-surface-800 hover:bg-surface-700'
                }`}
                aria-label={t('Toggle code generator')}
              >
                &lt;/&gt;
              </button>
            </Tooltip>
          </div>

          {/* Separator */}
          <div className="w-px h-4 bg-surface-800 mx-1 shrink-0" />

          {/* Workspace settings (far right) */}
          <Tooltip label={t('Workspace settings')} align="right">
            <button
              onClick={() => setWorkspaceSettingsOpen(true)}
              className="p-1.5 bg-surface-800 hover:bg-surface-700 rounded transition-colors"
              aria-label={t('Workspace settings')}
            >
              <GearIcon />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
