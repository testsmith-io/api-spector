// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import type { Collection } from '../../../../shared/types';
import { EnvironmentBar } from '../EnvironmentBar/EnvironmentBar';
import { WorkspaceSettingsModal } from './WorkspaceSettingsModal';
import { DocsGeneratorModal } from './DocsGeneratorModal';
import { ImportModal } from './ImportModal';
import { useWorkspaceLoader } from '../../hooks/useWorkspaceLoader';
import { colRelPath } from '../../store';

const { electron } = window;

// ─── Preferences popover ──────────────────────────────────────────────────────

const ZOOM_STEPS = [0.75, 0.90, 1.0, 1.10, 1.25, 1.50];

function PreferencesPopover() {
  const theme    = useStore(s => s.theme);
  const zoom     = useStore(s => s.zoom);
  const setTheme = useStore(s => s.setTheme);
  const setZoom  = useStore(s => s.setZoom);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function zoomStep(dir: 1 | -1) {
    const idx = ZOOM_STEPS.indexOf(zoom);
    const next = idx === -1
      ? ZOOM_STEPS[2]
      : ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + dir))];
    setZoom(next);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`px-2.5 py-1 text-xs rounded transition-colors ${open ? 'bg-blue-700 text-white' : 'bg-surface-800 hover:bg-surface-700'}`}
        title="Preferences"
      >
        <span style={{ fontSize: '16px', lineHeight: 1 }}>⚙</span>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-56 bg-surface-900 border border-surface-700 rounded-lg shadow-xl z-50 p-3 flex flex-col gap-4">
          {/* Theme */}
          <div>
            <p className="text-[10px] text-surface-600 font-semibold uppercase tracking-wider mb-2">Theme</p>
            <div className="flex gap-1">
              {(['system', 'dark', 'light'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`flex-1 py-1.5 text-xs rounded capitalize transition-colors ${
                    theme === t
                      ? 'bg-blue-600 text-white'
                      : 'bg-surface-800 hover:bg-surface-700 text-surface-300'
                  }`}
                >
                  {t === 'system' ? '⊙ Auto' : t === 'dark' ? '☾ Dark' : '☀ Light'}
                </button>
              ))}
            </div>
          </div>

          {/* Zoom */}
          <div>
            <p className="text-[10px] text-surface-600 font-semibold uppercase tracking-wider mb-2">Interface size</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => zoomStep(-1)}
                disabled={zoom <= ZOOM_STEPS[0]}
                className="w-7 h-7 flex items-center justify-center bg-surface-800 hover:bg-surface-700 disabled:opacity-30 rounded text-sm transition-colors"
              >
                −
              </button>
              <span className="flex-1 text-center text-xs font-mono">{Math.round(zoom * 100)}%</span>
              <button
                onClick={() => zoomStep(1)}
                disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                className="w-7 h-7 flex items-center justify-center bg-surface-800 hover:bg-surface-700 disabled:opacity-30 rounded text-sm transition-colors"
              >
                +
              </button>
            </div>
            <div className="flex gap-0.5 mt-2">
              {ZOOM_STEPS.map(z => (
                <button
                  key={z}
                  onClick={() => setZoom(z)}
                  className={`flex-1 py-0.5 text-[9px] rounded transition-colors ${
                    zoom === z ? 'bg-blue-600 text-white' : 'bg-surface-800 hover:bg-surface-700 text-surface-600'
                  }`}
                >
                  {Math.round(z * 100)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

export function Toolbar({ onOpenDocs: _onOpenDocs }: { onOpenDocs?: () => void }) {
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

  async function afterImport(col: Collection | null) {
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
  }

  if (!workspace) return null;

  return (
    <div className="no-drag bg-surface-950 border-b border-surface-800 flex-shrink-0">
      {workspaceSettingsOpen && (
        <WorkspaceSettingsModal onClose={() => setWorkspaceSettingsOpen(false)} />
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
            <svg width="52" height="52" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
              <ellipse cx="256" cy="300" rx="145" ry="150" fill="#205d96" opacity="0.2"/>
              <path d="M 130,225 C 130,95 382,95 382,225 L 382,390 Q 340,435 298,390 Q 256,435 214,390 Q 172,435 130,390 Z" fill="#205d96"/>
              <path d="M 155,235 C 155,125 357,125 357,235 L 357,248 C 357,138 155,138 155,248 Z" fill="#6aa3c8" opacity="0.3"/>
              <ellipse cx="198" cy="262" rx="29" ry="33" fill="white"/>
              <ellipse cx="314" cy="262" rx="29" ry="33" fill="white"/>
              <ellipse cx="204" cy="268" rx="16" ry="20" fill="#1e1b2e" className="logo-pupil"/>
              <ellipse cx="320" cy="268" rx="16" ry="20" fill="#1e1b2e" className="logo-pupil logo-pupil-r"/>
              <ellipse cx="194" cy="254" rx="6" ry="7" fill="white" opacity="0.55"/>
              <ellipse cx="310" cy="254" rx="6" ry="7" fill="white" opacity="0.55"/>
            </svg>
            <span className="text-xs font-semibold tracking-wide text-surface-300">
              api <span style={{ color: '#6aa3c8' }}>Spector</span>
            </span>
          </div>

          {/* Import */}
          <button
            onClick={() => setImportOpen(true)}
            className="px-2.5 py-1 text-xs bg-surface-800 hover:bg-surface-700 rounded transition-colors shrink-0"
            title="Import collection (Postman, OpenAPI, Insomnia, Bruno)"
          >
            Import
          </button>

          {/* Separator */}
          <div className="w-px h-4 bg-surface-800 mx-1 shrink-0" />

          {/* Environment controls (inline) */}
          <span className="text-surface-600 text-xs shrink-0">ENV</span>
          <EnvironmentBar inline />
        </div>

        {/* ── Fixed right section (popovers live here, no overflow clipping) ── */}
        <div className="flex items-center gap-2 px-3 py-1.5 shrink-0 border-l border-surface-800">
          {/* Workspace switcher */}
          <button
            onClick={async () => {
              const result = await electron.openWorkspace();
              if (result) await applyWorkspace(result.workspace, result.workspacePath);
            }}
            className="px-2.5 py-1 text-xs bg-surface-800 hover:bg-surface-700 rounded transition-colors"
            title="Open a different workspace"
          >
            Open WS
          </button>
          <button
            onClick={async () => {
              const result = await electron.newWorkspace();
              if (result) await applyWorkspace(result.workspace, result.workspacePath);
            }}
            className="px-2.5 py-1 text-xs bg-surface-800 hover:bg-surface-700 rounded transition-colors"
            title="Create a new workspace"
          >
            New WS
          </button>
          <button
            onClick={async () => {
              await electron.closeWorkspace();
              closeWorkspace();
            }}
            className="px-2.5 py-1 text-xs bg-surface-800 hover:bg-surface-700 rounded transition-colors"
            title="Close current workspace"
          >
            Close WS
          </button>

          {/* Save */}
          <button
            onClick={saveAll}
            disabled={saving}
            className={`px-2.5 py-1 text-xs rounded transition-colors flex items-center gap-1.5 ${
              hasDirty
                ? 'bg-blue-700 hover:bg-blue-600 text-white'
                : 'bg-surface-800 hover:bg-surface-700 text-surface-500'
            }`}
            title="Save all unsaved changes"
          >
            {hasDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />}
            {saving ? 'Saving…' : 'Save'}
          </button>

          <PreferencesPopover />

          <button
            onClick={() => setWorkspaceSettingsOpen(true)}
            className="px-2.5 py-1 text-xs bg-surface-800 hover:bg-surface-700 rounded transition-colors"
            title="Workspace settings"
          >
            <span style={{ fontSize: '16px', lineHeight: 1 }}>⚙</span> WS
          </button>

          <button
            onClick={() => setDocsOpen(true)}
            className="px-2.5 py-1 text-xs bg-surface-800 hover:bg-surface-700 rounded transition-colors"
            title="Generate API documentation"
          >
            Docs
          </button>

          <button
            onClick={() => setShowGeneratorPanel(!showGeneratorPanel)}
            className={`px-2.5 py-1 text-xs rounded transition-colors font-mono ${
              showGeneratorPanel ? 'bg-blue-700 text-white' : 'bg-surface-800 hover:bg-surface-700'
            }`}
            title="Toggle code generator"
          >
            &lt;/&gt;
          </button>
        </div>
      </div>
    </div>
  );
}
