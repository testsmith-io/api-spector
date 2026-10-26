// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useRef, useState } from 'react';
import { useT } from '../../i18n';
import { renderMarkdown } from '../../lib/markdown';

interface Props {
  readonly value: string
  readonly onChange: (v: string) => void
  readonly placeholder?: string
  /** Build + run AI generation, returning markdown (or null on cancel/failure).
   *  When omitted, the AI button is hidden entirely. */
  readonly onGenerate?: () => Promise<string | null>
  /** Whether an LLM key is configured. When false, the AI button is disabled
   *  with a hint to configure one. */
  readonly aiAvailable?: boolean
}

/** Markdown documentation editor shared by request / folder / collection docs.
 *  A Write/Preview toggle, a lightweight formatting toolbar, and an optional
 *  "Generate with AI" action. Docs are stored as plain markdown. */
export function DocsEditor({ value, onChange, placeholder, onGenerate, aiAvailable }: Props) {
  const t = useT();
  // Open in Preview when there's already documentation to read; fall back to
  // Write only when the doc is empty (nothing to preview yet).
  const [mode, setMode] = useState<'write' | 'preview'>(value.trim() ? 'preview' : 'write');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDiagramHelp, setShowDiagramHelp] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Wrap the current selection with `before`/`after` (e.g. ** ** for bold).
  function wrap(before: string, after = before) {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const sel = value.slice(start, end) || t('text');
    const next = value.slice(0, start) + before + sel + after + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + before.length, start + before.length + sel.length);
    });
  }

  // Prefix the line(s) touching the selection (headings, lists, quotes).
  function prefixLine(prefix: string) {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    onChange(next);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + prefix.length, start + prefix.length); });
  }

  function insertLink() {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const sel = value.slice(start, end) || t('link text');
    const snippet = `[${sel}](https://)`;
    onChange(value.slice(0, start) + snippet + value.slice(end));
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + snippet.length - 1, start + snippet.length - 1); });
  }

  // Drop a starter flowchart block at the cursor (and make sure we're in Write
  // so the user can edit it). Rendered as a diagram in Preview.
  function insertDiagram() {
    const ta = taRef.current;
    setMode('write');
    const start = ta ? ta.selectionStart : value.length;
    const snippet = '\n```flow\nflowchart TD\n  A([Start]) --> B[Do something]\n  B --> C{OK?}\n  C -->|yes| D([Done])\n  C -->|no| B\n```\n';
    onChange(value.slice(0, start) + snippet + value.slice(start));
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  }

  async function generate() {
    if (!onGenerate) return;
    setGenerating(true);
    setError(null);
    try {
      const md = await onGenerate();
      if (md) { onChange(md); setMode('preview'); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  const btn = 'px-1.5 py-0.5 text-[11px] rounded text-surface-400 hover:text-white hover:bg-surface-700 transition-colors';

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar */}
      <div className="flex items-center gap-1 flex-wrap">
        <div className="flex bg-surface-800 rounded p-0.5">
          <button onClick={() => setMode('write')}   className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors ${mode === 'write'   ? 'bg-blue-600 text-white' : 'text-surface-400 hover:text-surface-200'}`}>{t('Write')}</button>
          <button onClick={() => setMode('preview')} className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors ${mode === 'preview' ? 'bg-blue-600 text-white' : 'text-surface-400 hover:text-surface-200'}`}>{t('Preview')}</button>
        </div>

        {mode === 'write' && (
          <div className="flex items-center gap-0.5">
            <button onClick={() => wrap('**')} className={`${btn} font-bold`} title={t('Bold')}>B</button>
            <button onClick={() => wrap('*')} className={`${btn} italic`} title={t('Italic')}>I</button>
            <button onClick={() => wrap('`')} className={`${btn} font-mono`} title={t('Inline code')}>{'</>'}</button>
            <button onClick={() => prefixLine('## ')} className={btn} title={t('Heading')}>H</button>
            <button onClick={() => prefixLine('- ')} className={btn} title={t('List')}>•</button>
            <button onClick={() => prefixLine('> ')} className={btn} title={t('Quote')}>&ldquo;</button>
            <button onClick={insertLink} className={btn} title={t('Link')}>🔗</button>
            <button onClick={() => wrap('\n```\n', '\n```\n')} className={`${btn} font-mono`} title={t('Code block')}>{'{ }'}</button>
            <button onClick={insertDiagram} className={btn} title={t('Insert flowchart')}>⬡</button>
          </div>
        )}

        <button
          onClick={() => setShowDiagramHelp(v => !v)}
          className={`${btn} ${showDiagramHelp ? 'text-white bg-surface-700' : ''}`}
          title={t('Flowchart syntax help')}
          aria-expanded={showDiagramHelp}
        >
          {t('⬡ Diagram help')}
        </button>

        {onGenerate && (
          <button
            onClick={generate}
            disabled={generating || !aiAvailable}
            title={aiAvailable ? t('Generate documentation with AI from this item') : t('Configure an OpenAI key in Settings → AI to enable this')}
            className="ml-auto px-2.5 py-0.5 text-[10px] font-medium rounded bg-surface-800 hover:bg-surface-700 disabled:opacity-50 disabled:hover:bg-surface-800 text-surface-200 transition-colors flex items-center gap-1"
          >
            {generating ? t('Generating…') : t('✦ Generate with AI')}
          </button>
        )}
      </div>

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      {showDiagramHelp && (
        <div className="text-[11px] text-surface-300 bg-surface-800/60 border border-surface-700 rounded p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-surface-100">{t('Flowchart syntax')}</span>
            <button onClick={insertDiagram} className="text-[10px] px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors">
              {t('Insert example')}
            </button>
          </div>
          <p className="text-surface-400">{t('Wrap the diagram in a fenced code block tagged flow. It renders as a graph in Preview.')}</p>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 items-baseline">
            <span className="text-surface-500">{t('Direction')}</span><code className="font-mono text-surface-200">flowchart TD · LR · RL · BT</code>
            <span className="text-surface-500">{t('Steps')}</span><code className="font-mono text-surface-200">{'A[Box]  A(Round)  A([Start/End])'}</code>
            <span className="text-surface-500">{t('Decision')}</span><code className="font-mono text-surface-200">{'A{OK?}'}</code>
            <span className="text-surface-500">{t('More shapes')}</span><code className="font-mono text-surface-200">{'A((Circle))  A{{Hexagon}}  A[[Subroutine]]'}</code>
            <span className="text-surface-500">{t('Arrows')}</span><code className="font-mono text-surface-200">{'A --> B    A -->|label| B'}</code>
            <span className="text-surface-500">{t('Link styles')}</span><code className="font-mono text-surface-200">{'A -.-> B (dotted)   A ==> B (thick)   A --- B'}</code>
            <span className="text-surface-500">{t('Chain')}</span><code className="font-mono text-surface-200">A --&gt; B --&gt; C</code>
          </div>
        </div>
      )}

      {/* Body */}
      {mode === 'write' ? (
        <textarea
          ref={taRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder ?? t('Document this in markdown. **bold**, *italic*, `code`, # headings, - lists, [links](url).')}
          spellCheck={false}
          className="w-full min-h-[220px] text-xs font-mono bg-surface-800 border border-surface-700 rounded px-3 py-2 focus:outline-none focus:border-blue-500 resize-y leading-relaxed placeholder-surface-600"
        />
      ) : (
        <div className="min-h-[220px] border border-surface-800 rounded px-3 py-2 overflow-y-auto max-h-[50vh]">
          {value.trim()
            ? renderMarkdown(value)
            : <p className="text-xs text-surface-600 italic">{t('Nothing documented yet.')}</p>}
        </div>
      )}
    </div>
  );
}
