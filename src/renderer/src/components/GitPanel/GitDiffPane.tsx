// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { DiffViewer } from './GitPanel';

const { electron } = window;

/** Full-pane diff viewer rendered in the main content area when the user
 *  clicks a changed file in the Git sidebar. Avoids the cramped 12rem strip
 *  that used to live inside the sidebar. */
export function GitDiffPane() {
  const active        = useStore(s => s.activeGitDiff);
  const setActive     = useStore(s => s.setActiveGitDiff);
  const [diff, setDiff]       = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const d = active.staged
          ? await electron.gitDiffStaged(active.path)
          : await electron.gitDiff(active.path);
        if (!cancelled) setDiff(d);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [active?.path, active?.staged]);

  if (!active) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-surface-500">
        Select a changed file in the sidebar to view its diff.
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Header — file path + status + close */}
      <div className="px-4 py-2 border-b border-surface-800 flex items-center gap-3 flex-shrink-0">
        <span
          className={`text-[10px] uppercase tracking-wider font-semibold ${
            active.staged ? 'text-emerald-400' : 'text-amber-400'
          }`}
        >
          {active.staged ? 'Staged' : 'Working tree'}
        </span>
        <span className="text-xs font-mono text-surface-200 truncate flex-1">{active.path}</span>
        <button
          onClick={() => setActive(null)}
          className="text-surface-500 hover:text-white text-xs leading-none"
          title="Close diff"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto min-h-0">
        {loading && <p className="text-xs text-surface-500 p-4">Loading diff…</p>}
        {error   && <p className="text-xs text-red-400 p-4">{error}</p>}
        {!loading && !error && <DiffViewer diff={diff} />}
      </div>
    </div>
  );
}
