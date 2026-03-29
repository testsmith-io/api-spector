// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useState } from 'react';
import { useStore } from '../../store';
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import type { GeneratedFile, GenerateTarget } from '../../../../shared/types';

const { electron } = window;

interface TargetDef {
  id: GenerateTarget
  label: string
  description: string
}

const TARGETS: TargetDef[] = [
  { id: 'robot_framework', label: 'Robot Framework', description: 'Python RequestsLibrary keywords + test suite' },
  { id: 'playwright_ts',   label: 'Playwright TS',   description: 'TypeScript page-object API classes + spec files' },
  { id: 'playwright_js',   label: 'Playwright JS',   description: 'JavaScript page-object API classes + spec files' },
  { id: 'supertest_ts',    label: 'Supertest TS',    description: 'Jest + Supertest TypeScript tests' },
  { id: 'supertest_js',    label: 'Supertest JS',    description: 'Jest + Supertest JavaScript tests' },
  { id: 'rest_assured',    label: 'REST Assured',    description: 'Java + JUnit 5 + Maven pom.xml' },
];

export function GeneratorPanel() {
  const setShowGeneratorPanel = useStore(s => s.setShowGeneratorPanel);
  const collections           = useStore(s => s.collections);
  const environments          = useStore(s => s.environments);
  const activeCollectionId    = useStore(s => s.activeCollectionId);
  const activeEnvironmentId   = useStore(s => s.activeEnvironmentId);

  const [target, setTarget]   = useState<GenerateTarget>('robot_framework');
  const [files, setFiles]     = useState<GeneratedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [generating, setGenerating]     = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const colList = Object.values(collections);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>(
    activeCollectionId ?? colList[0]?.data.id ?? ''
  );

  async function generate() {
    if (!selectedCollectionId) return;
    setGenerating(true);
    setError(null);
    try {
      const col = collections[selectedCollectionId]?.data;
      const env = activeEnvironmentId ? environments[activeEnvironmentId]?.data ?? null : null;
      const generated = await electron.generateCode({ collection: col, environment: env, target });
      setFiles(generated);
      setSelectedFile(generated[0]?.path ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function saveZip() {
    if (files.length === 0) return;
    const col = collections[selectedCollectionId]?.data;
    await electron.saveGeneratedFilesAsZip(files, col?.name ?? 'api-tests', target);
  }

  const selectedContent = files.find(f => f.path === selectedFile)?.content ?? '';
  const activeTarget = TARGETS.find(t => t.id === target);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-surface-800 flex-shrink-0">
        <h2 className="text-sm font-semibold">Code Generator</h2>
        <button
          onClick={() => setShowGeneratorPanel(false)}
          className="text-surface-400 hover:text-white text-lg leading-none"
        >×</button>
      </div>

      {/* Controls */}
      <div className="px-4 py-3 border-b border-surface-800 flex flex-col gap-3 flex-shrink-0">
        {/* Collection selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-surface-400">Collection</label>
          <select
            value={selectedCollectionId}
            onChange={e => setSelectedCollectionId(e.target.value)}
            className="text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500"
          >
            {colList.map(({ data: col }) => (
              <option key={col.id} value={col.id}>{col.name}</option>
            ))}
          </select>
        </div>

        {/* Target selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-surface-400">Output format</label>
          <div className="grid grid-cols-2 gap-1.5">
            {TARGETS.map(t => (
              <label
                key={t.id}
                className={`flex items-center gap-1.5 cursor-pointer rounded px-2 py-1 border transition-colors ${
                  target === t.id
                    ? 'border-blue-500 bg-blue-900/20 text-white'
                    : 'border-surface-700 text-surface-400 hover:border-surface-500 hover:text-white'
                }`}
              >
                <input
                  type="radio"
                  value={t.id}
                  checked={target === t.id}
                  onChange={() => setTarget(t.id)}
                  className="sr-only"
                />
                <span className="text-xs font-medium">{t.label}</span>
              </label>
            ))}
          </div>
          {activeTarget && (
            <p className="text-[10px] text-surface-400">{activeTarget.description}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={generate}
            disabled={generating || !selectedCollectionId}
            className="flex-1 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-surface-800 disabled:text-surface-400 rounded transition-colors"
          >
            {generating ? 'Generating…' : 'Generate'}
          </button>
          {files.length > 0 && (
            <button
              onClick={saveZip}
              className="px-3 py-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 rounded transition-colors"
            >
              Save as ZIP
            </button>
          )}
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      {files.length > 0 && (
        <>
          {/* File tabs */}
          <div className="flex border-b border-surface-800 overflow-x-auto flex-shrink-0">
            {files.map(f => (
              <button
                key={f.path}
                onClick={() => setSelectedFile(f.path)}
                className={`px-3 py-1.5 text-xs whitespace-nowrap border-b-2 -mb-px transition-colors ${
                  selectedFile === f.path
                    ? 'border-blue-500 text-white'
                    : 'border-transparent text-surface-400 hover:text-white'
                }`}
              >
                {f.path.split('/').pop()}
              </button>
            ))}
          </div>

          {/* Path label */}
          <div className="px-4 py-1 text-[10px] text-surface-400 border-b border-surface-800 flex-shrink-0 font-mono">
            {selectedFile}
          </div>

          {/* Code preview */}
          <div className="flex-1 overflow-auto">
            <CodeMirror
              value={selectedContent}
              height="100%"
              theme={oneDark}
              readOnly
              basicSetup={{ lineNumbers: true, foldGutter: false }}
            />
          </div>
        </>
      )}

      {files.length === 0 && !generating && (
        <div className="flex-1 flex items-center justify-center text-surface-400 text-xs text-center px-6">
          Select a collection and hit Generate to preview the output code.
        </div>
      )}
    </div>
  );
}
