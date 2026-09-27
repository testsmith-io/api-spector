// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { useT } from '../../i18n';
import { btnSecondaryCls } from '../../lib/ui-classes';

const { electron } = window;

type Part =
  | { type: 'text'; text: string }
  | { type: 'conflict'; ours: string; theirs: string; choice?: 'ours' | 'theirs' | 'both' };

// Split file content into plain text runs and conflict hunks. Handles diff3
// style (with a ||||||| base section) by discarding the base.
function parseConflicts(content: string): Part[] {
  const lines = content.split('\n');
  const parts: Part[] = [];
  let buf: string[] = [];
  const flush = () => { if (buf.length) { parts.push({ type: 'text', text: buf.join('\n') }); buf = []; } };
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<<')) {
      flush();
      i++;
      const ours: string[] = [];
      while (i < lines.length && !lines[i].startsWith('=======') && !lines[i].startsWith('|||||||')) { ours.push(lines[i]); i++; }
      if (i < lines.length && lines[i].startsWith('|||||||')) { i++; while (i < lines.length && !lines[i].startsWith('=======')) i++; }
      i++; // skip =======
      const theirs: string[] = [];
      while (i < lines.length && !lines[i].startsWith('>>>>>>>')) { theirs.push(lines[i]); i++; }
      i++; // skip >>>>>>>
      parts.push({ type: 'conflict', ours: ours.join('\n'), theirs: theirs.join('\n') });
    } else {
      buf.push(lines[i]); i++;
    }
  }
  flush();
  return parts;
}

function assemble(parts: Part[]): string {
  return parts.map(p => {
    if (p.type === 'text') return p.text;
    if (p.choice === 'ours') return p.ours;
    if (p.choice === 'theirs') return p.theirs;
    if (p.choice === 'both') return `${p.ours}\n${p.theirs}`;
    // Unresolved — keep the markers so nothing is silently lost.
    return `<<<<<<< ours\n${p.ours}\n=======\n${p.theirs}\n>>>>>>> theirs`;
  }).join('\n');
}

/** Inline merge-conflict resolver: per-hunk Accept ours/theirs/both, or free
 *  manual editing, then stage the resolved file. */
export function ConflictEditor({ path, onClose, onResolved }: { path: string; onClose: () => void; onResolved: () => void }) {
  const t = useT();
  const [parts, setParts] = useState<Part[] | null>(null);
  const [manual, setManual] = useState<string | null>(null); // non-null = manual edit mode
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    electron.gitReadConflict(path)
      .then(c => setParts(parseConflicts(c)))
      .catch(e => setError(String(e)));
  }, [path]);

  const conflictCount = useMemo(() => parts?.filter(p => p.type === 'conflict').length ?? 0, [parts]);
  const unresolved = useMemo(() => parts?.filter(p => p.type === 'conflict' && !p.choice).length ?? 0, [parts]);
  const content = manual != null ? manual : (parts ? assemble(parts) : '');
  const stillHasMarkers = /^(<{7}|={7}|>{7})/m.test(content);

  function choose(idx: number, choice: 'ours' | 'theirs' | 'both') {
    setParts(prev => prev?.map((p, i) => (i === idx && p.type === 'conflict' ? { ...p, choice } : p)) ?? prev);
  }

  function chooseAll(choice: 'ours' | 'theirs') {
    setParts(prev => prev?.map(p => (p.type === 'conflict' ? { ...p, choice } : p)) ?? prev);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await electron.gitWriteResolved(path, content);
      onResolved();
      onClose();
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  let conflictIdx = -1;

  return (
    <Modal
      onClose={onClose}
      overlayClassName="bg-black/50 z-50 flex items-start justify-center pt-12"
      panelClassName="w-[860px] max-w-[94vw] bg-surface-900 border border-surface-800 rounded-lg shadow-2xl flex flex-col max-h-[85vh]"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-800 shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold truncate">{t('Resolve conflicts')}</h2>
          <p className="text-[10px] text-surface-500 font-mono truncate">{path}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => chooseAll('ours')} className="text-[10px] px-2 py-0.5 rounded bg-surface-800 hover:bg-emerald-900/50 hover:text-emerald-300 transition-colors">{t('All ours')}</button>
          <button onClick={() => chooseAll('theirs')} className="text-[10px] px-2 py-0.5 rounded bg-surface-800 hover:bg-blue-900/50 hover:text-blue-300 transition-colors">{t('All theirs')}</button>
          <button
            onClick={() => setManual(m => (m != null ? null : assemble(parts ?? [])))}
            className={`text-[10px] px-2 py-0.5 rounded transition-colors ${manual != null ? 'bg-blue-700 text-white' : 'bg-surface-800 hover:bg-surface-700'}`}
          >{t('Edit manually')}</button>
          <button onClick={onClose} className="text-surface-400 hover:text-white text-lg leading-none pl-1">×</button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {error && <p className="text-[11px] text-red-400 px-4 pt-3">{error}</p>}
        {parts == null ? (
          <p className="text-xs text-surface-500 px-4 py-6">{t('Loading…')}</p>
        ) : manual != null ? (
          <textarea
            value={manual}
            onChange={e => setManual(e.target.value)}
            spellCheck={false}
            className="w-full h-[55vh] text-[11px] font-mono bg-surface-950 border-0 px-4 py-3 focus:outline-none resize-none leading-relaxed"
          />
        ) : (
          <div className="flex flex-col">
            {parts.map((p, i) => {
              if (p.type === 'text') {
                if (!p.text.trim()) return null;
                return (
                  <pre key={i} className="text-[11px] font-mono text-surface-400 px-4 py-1 whitespace-pre-wrap break-words border-b border-surface-800/40">{p.text}</pre>
                );
              }
              conflictIdx++;
              const idx = conflictIdx;
              const partIndex = i;
              return (
                <div key={i} className={`border-y border-surface-800 my-1 ${p.choice ? '' : 'ring-1 ring-inset ring-red-800/50'}`}>
                  <div className="flex items-center gap-1.5 px-3 py-1 bg-surface-800/50 text-[10px]">
                    <span className="uppercase tracking-wider text-surface-500 font-semibold">{t('Conflict :n', { n: idx + 1 })}</span>
                    <div className="ml-auto flex gap-1">
                      <button onClick={() => choose(partIndex, 'ours')}   className={`px-1.5 py-0.5 rounded transition-colors ${p.choice === 'ours' ? 'bg-emerald-800 text-white' : 'bg-surface-700 hover:bg-emerald-900/50 hover:text-emerald-300'}`}>{t('Ours')}</button>
                      <button onClick={() => choose(partIndex, 'theirs')} className={`px-1.5 py-0.5 rounded transition-colors ${p.choice === 'theirs' ? 'bg-blue-800 text-white' : 'bg-surface-700 hover:bg-blue-900/50 hover:text-blue-300'}`}>{t('Theirs')}</button>
                      <button onClick={() => choose(partIndex, 'both')}   className={`px-1.5 py-0.5 rounded transition-colors ${p.choice === 'both' ? 'bg-surface-500 text-white' : 'bg-surface-700 hover:bg-surface-600'}`}>{t('Both')}</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-surface-800">
                    <div className={`px-3 py-1.5 ${p.choice && p.choice !== 'ours' && p.choice !== 'both' ? 'opacity-40' : ''}`}>
                      <div className="text-[9px] uppercase tracking-wider text-emerald-400 mb-1">{t('Ours (current)')}</div>
                      <pre className="text-[11px] font-mono text-emerald-200/90 whitespace-pre-wrap break-words">{p.ours || ' '}</pre>
                    </div>
                    <div className={`px-3 py-1.5 ${p.choice && p.choice !== 'theirs' && p.choice !== 'both' ? 'opacity-40' : ''}`}>
                      <div className="text-[9px] uppercase tracking-wider text-blue-400 mb-1">{t('Theirs (incoming)')}</div>
                      <pre className="text-[11px] font-mono text-blue-200/90 whitespace-pre-wrap break-words">{p.theirs || ' '}</pre>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-surface-800 shrink-0">
        <span className="text-[11px] text-surface-500">
          {manual != null
            ? (stillHasMarkers ? t('Conflict markers still present') : t('Ready to stage'))
            : unresolved > 0
              ? t(':count of :total conflict unresolved|:count of :total conflicts unresolved', { count: unresolved, total: conflictCount })
              : t('All :count conflicts resolved', { count: conflictCount })}
        </span>
        <div className="ml-auto flex gap-2">
          <button onClick={onClose} className={btnSecondaryCls}>{t('Cancel')}</button>
          <button
            onClick={save}
            disabled={saving || stillHasMarkers}
            title={stillHasMarkers ? t('Resolve every conflict first') : t('Write the resolved file and stage it')}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-surface-800 disabled:text-surface-600 rounded font-medium transition-colors"
          >
            {saving ? t('Saving…') : t('Mark resolved')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
