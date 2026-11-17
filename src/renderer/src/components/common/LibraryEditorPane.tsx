// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { cmLabel } from '../../lib/cmA11y';
import { atCompletionExtension, signatureHelpExtension } from '../RequestBuilder/atCompletions';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { librariesInDir, libNameFromPath } from '../../../../shared/libraries';

interface Props {
  readonly path: string
}

/** Center-pane editor for one reusable library file. Autosaves to disk shortly
 *  after edits stop (lib files are small and git-tracked), so it feels like a
 *  normal code editor. */
export function LibraryEditorPane({ path }: Props) {
  const t = useT();
  const contents        = useStore(s => s.libraryContents);
  const saveLibraryFile = useStore(s => s.saveLibraryFile);
  const deleteLibraryFile = useStore(s => s.deleteLibraryFile);

  // The pane is keyed by path in App, so each file gets a fresh instance and the
  // buffer seeds once from the saved content.
  const saved = contents[path] ?? '';
  const [draft, setDraft] = useState(saved);
  const [status, setStatus] = useState<'saved' | 'saving'>('saved');

  const dir  = path.slice(0, path.lastIndexOf('/'));
  const siblings = useMemo(() => librariesInDir(contents, dir), [contents, dir]);
  const extensions = useMemo(
    () => [javascript({ typescript: true }), atCompletionExtension([], siblings), signatureHelpExtension(siblings), ...cmLabel(t('Library editor'))],
    [t, siblings],
  );

  // Debounced autosave. A ref holds the latest draft so the flush-on-unmount
  // effect writes the final text, not a stale closure.
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => {
    if (draft === saved) { setStatus('saved'); return; }
    setStatus('saving');
    const id = setTimeout(() => { void saveLibraryFile(path, latest.current); }, 600);
    return () => clearTimeout(id);
  }, [draft, saved, path, saveLibraryFile]);

  // Flush on unmount / file switch so nothing is lost.
  useEffect(() => () => {
    const current = useStore.getState().libraryContents[path];
    if (current !== undefined && current !== latest.current) void saveLibraryFile(path, latest.current);
  }, [path, saveLibraryFile]);

  async function remove() {
    if (!window.confirm(t('Delete library :name? This cannot be undone.', { name: libNameFromPath(path) }))) return;
    await deleteLibraryFile(path);
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-surface-800 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate">{libNameFromPath(path)}</span>
          <span className="text-[10px] text-surface-600 font-mono truncate" title={path}>{path}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[10px] text-surface-500">{status === 'saving' ? t('Saving…') : t('Saved')}</span>
          <button onClick={() => void remove()} className="px-2.5 py-1 rounded text-[11px] text-red-400 hover:bg-surface-800 transition-colors">{t('Delete')}</button>
        </div>
      </div>
      <p className="text-[10px] text-surface-600 px-4 pt-2">
        {t('Reusable TypeScript. Export functions/values and load them in any script with sp.require(\':name\').', { name: libNameFromPath(path) })}
      </p>
      <div className="flex-1 min-h-0 p-3">
        <div className="h-full rounded overflow-hidden border border-surface-800">
          <CodeMirror
            value={draft}
            height="100%"
            theme={oneDark}
            extensions={extensions}
            onChange={setDraft}
            basicSetup={{ lineNumbers: true, foldGutter: true, autocompletion: false }}
          />
        </div>
      </div>
    </div>
  );
}
