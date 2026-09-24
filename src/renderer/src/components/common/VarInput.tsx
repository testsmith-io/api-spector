// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useRef, useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useVarNames } from '../../hooks/useVarNames';
import { useVarValues } from '../../hooks/useVarValues';
import { FAKER_NAMESPACES, FAKER_SUB } from '../RequestBuilder/atCompletions';

// Staged {{…}} completion, matching the request-body / URL editors: a variable
// name, a $dynamic var, or an expression drilled faker → namespace → method
// (and dayjs starters). Each item carries the exact text to splice in place of
// the token being typed; `close` items finish with `}}`, the rest keep the
// dropdown open so completion continues (e.g. faker. → person. → firstName()).
type CompletionType = 'variable' | 'function' | 'property'

interface Suggestion {
  label: string
  insert: string
  type: CompletionType   // drives the CodeMirror-style completion icon
  close?: boolean        // append }} — a terminal completion
  detail?: string
  boost?: number         // higher sorts first (matches the body editor)
}

const DAYJS_OPTIONS: { label: string; insert: string }[] = [
  { label: "dayjs().format('YYYY-MM-DD')",         insert: "dayjs().format('YYYY-MM-DD')" },
  { label: 'dayjs().toISOString()',                insert: 'dayjs().toISOString()' },
  { label: 'dayjs().valueOf()',                    insert: 'dayjs().valueOf()' },
  { label: "dayjs().subtract(1,'day').format(…)",  insert: "dayjs().subtract(1,'day').format('YYYY-MM-DD')" },
  { label: "dayjs().add(1,'day').format(…)",       insert: "dayjs().add(1,'day').format('YYYY-MM-DD')" },
];

// Mirrors CodeMirror's completion icons (@codemirror/autocomplete) so the
// dropdown reads the same as the request-body editor.
const ICON: Record<CompletionType, { glyph: string; cls: string }> = {
  variable: { glyph: '𝑥', cls: 'text-emerald-400' },
  function: { glyph: 'ƒ', cls: 'text-violet-400' },
  property: { glyph: '◆', cls: 'text-blue-400' },
};
import { useT } from '../../i18n';

// ─── Parse {{varname}} tokens ─────────────────────────────────────────────────

function parseVarTokens(str: string): string[] {
  const found: string[] = [];
  const re = /\{\{([^}]+)\}\}/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    const name = m[1].trim();
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

// ─── Dropdown rendered in a portal (escapes overflow:hidden parents) ──────────

interface DropdownPos { top: number; left: number; minWidth: number }

function PortalDropdown({
  pos,
  items,
  activeIndex,
  mode,
  onPick,
}: {
  pos: DropdownPos
  items: Suggestion[]
  activeIndex: number
  mode: 'var' | 'static'
  onPick: (s: Suggestion) => void
}) {
  return ReactDOM.createPortal(
    <ul
      style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: Math.max(pos.minWidth, 220), zIndex: 9999 }}
      className="max-h-56 overflow-y-auto bg-surface-800 border border-surface-600 rounded shadow-xl text-xs py-0.5"
    >
      {items.map((s, i) => (
        <li key={s.label + i}>
          <button
            onMouseDown={e => { e.preventDefault(); onPick(s); }}
            className={`w-full text-left px-2 py-1 font-mono transition-colors flex items-center gap-1.5 ${
              i === activeIndex ? 'bg-blue-600 text-white' : 'hover:bg-surface-700'
            }`}
          >
            {mode === 'var'
              ? <span className={`w-3 shrink-0 text-center ${i === activeIndex ? 'text-white/80' : ICON[s.type].cls}`}>{ICON[s.type].glyph}</span>
              : null}
            <span className="truncate">{s.label}</span>
            {s.detail && <span className={`ml-auto pl-2 shrink-0 italic ${i === activeIndex ? 'text-white/70' : 'text-surface-500'}`}>{s.detail}</span>}
          </button>
        </li>
      ))}
    </ul>,
    document.body,
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

type SuggestionMode = 'var' | 'static'

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string
  onChange: (value: string) => void
  /** Classes for the outer wrapper div (layout: flex-1, w-full, etc.) */
  wrapperClassName?: string
  /**
   * Optional static suggestions (e.g. HTTP header names or common values).
   * Shown when the field is focused and the user has not opened a {{var}} query.
   * The user can always ignore the list and type a custom value.
   */
  staticSuggestions?: string[]
}

export function VarInput({ value, onChange, className, wrapperClassName, staticSuggestions, ...rest }: Props) {
  const t         = useT();
  const varNames  = useVarNames();
  const varValues = useVarValues();
  const inputRef  = useRef<HTMLInputElement>(null);

  const [suggestions,    setSuggestions]    = useState<Suggestion[]>([]);
  const [suggestionMode, setSuggestionMode] = useState<SuggestionMode>('var');
  const [activeIndex,    setActiveIndex]    = useState(-1);
  const [dropPos,        setDropPos]        = useState<DropdownPos | null>(null);
  const [showPreview,    setShowPreview]    = useState(false);
  // Length of the token currently being replaced (the completion's `from`).
  const partialLen = useRef(0);

  // Recalculate portal position whenever suggestions appear or window resizes
  useEffect(() => {
    if (suggestions.length === 0) { setDropPos(null); return; }
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setDropPos({ top: r.bottom + 2, left: r.left, minWidth: r.width });
  }, [suggestions.length]);

  // ── Autocomplete ───────────────────────────────────────────────────────────

  function show(items: Suggestion[], from: number) {
    partialLen.current = from;
    setSuggestions(items);
    setSuggestionMode('var');
    setActiveIndex(-1);
  }

  function detectQuery(val: string, cursor: number) {
    const before = val.slice(0, cursor);

    // Prefix matches sort before mid-string ones, then higher boost — the same
    // ordering CodeMirror applies in the body editor.
    const sortByMatch = (items: Suggestion[], q: string) =>
      items.map((it, i) => ({ it, i }))
        .sort((a, b) => {
          const ap = a.it.label.toLowerCase().startsWith(q) ? 0 : 1;
          const bp = b.it.label.toLowerCase().startsWith(q) ? 0 : 1;
          return ap - bp || (b.it.boost ?? 0) - (a.it.boost ?? 0) || a.i - b.i;
        })
        .map(x => x.it);

    // {{faker.<namespace>.<method> — drill into a namespace's generators.
    let m = /\{\{faker\.(\w+)\.(\w*)$/.exec(before);
    if (m) {
      const q = m[2].toLowerCase();
      const subs = (FAKER_SUB[m[1]] ?? []).filter(c => c.label.toLowerCase().includes(q));
      show(sortByMatch(subs.map(c => ({ label: c.label, type: 'function', detail: (c.detail as string) ?? '()', insert: `${c.label}()`, close: true })), q), m[2].length);
      return;
    }
    // {{faker.<namespace> — list namespaces (person, internet, …).
    m = /\{\{faker\.(\w*)$/.exec(before);
    if (m) {
      const q = m[1].toLowerCase();
      const items: Suggestion[] = FAKER_NAMESPACES.filter(c => c.label.toLowerCase().includes(q))
        .map(c => ({ label: c.label, type: 'property', insert: `${c.label}.` }));
      show(sortByMatch(items, q), m[1].length);
      return;
    }
    // {{dayjs… — date/time expression options.
    m = /\{\{(dayjs\b[^}]*)$/.exec(before);
    if (m) {
      const q = m[1].toLowerCase();
      show(DAYJS_OPTIONS.filter(o => o.label.toLowerCase().includes(q))
        .map(o => ({ label: o.label, type: 'function', insert: o.insert, close: true })), m[1].length);
      return;
    }
    // {{name / {{$dynamic / faker|dayjs expression starters.
    m = /\{\{(\$?\w*)$/.exec(before);
    if (m) {
      const q = m[1].toLowerCase();
      const vars: Suggestion[] = varNames
        .filter(n => n.toLowerCase().includes(q))
        .map(n => ({ label: n, insert: n, type: 'variable', close: true, boost: n.startsWith('$') ? 1 : 0 }));
      const starters: Suggestion[] = [
        { label: 'faker', insert: 'faker.', type: 'property' as const },
        { label: 'dayjs', insert: 'dayjs().', type: 'function' as const },
      ].filter(s => s.label.includes(q));
      show([...sortByMatch(vars, q), ...starters], m[1].length);
      return;
    }

    if (staticSuggestions) {
      const q = val.toLowerCase();
      const filtered = (q
        ? staticSuggestions
            .filter(s => s.toLowerCase().includes(q))
            .sort((a, b) => (a.toLowerCase().startsWith(q) ? 0 : 1) - (b.toLowerCase().startsWith(q) ? 0 : 1))
            .slice(0, 20)
        : staticSuggestions.slice(0, 20));
      partialLen.current = 0;
      setSuggestions(filtered.map(s => ({ label: s, insert: s, type: 'variable' as const })));
      setSuggestionMode('static');
      setActiveIndex(-1);
      return;
    }
    setSuggestions([]);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newVal = e.target.value;
    const cursor = e.target.selectionStart ?? newVal.length;
    onChange(newVal);
    detectQuery(newVal, cursor);
  }

  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    detectQuery(value, e.target.selectionStart ?? value.length);
    rest.onFocus?.(e);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      apply(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      setSuggestions([]);
    }
  }

  function apply(item: Suggestion) {
    if (suggestionMode === 'static') {
      onChange(item.insert);
      setSuggestions([]);
      return;
    }

    const el     = inputRef.current;
    const cursor = el?.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const after  = value.slice(cursor);
    const start  = cursor - partialLen.current;                 // replace the token being typed
    const insert = item.insert + (item.close ? '}}' : '');
    const newVal    = before.slice(0, start) + insert + after;
    const newCursor = start + insert.length;
    onChange(newVal);

    if (item.close) {
      setSuggestions([]);
      requestAnimationFrame(() => el?.setSelectionRange(newCursor, newCursor));
    } else {
      // Non-terminal (faker. / namespace. / dayjs().) — keep completing.
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(newCursor, newCursor);
        detectQuery(newVal, newCursor);
      });
    }
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    setTimeout(() => setSuggestions([]), 150);
    setShowPreview(false);
    rest.onBlur?.(e);
  }

  // ── Hover preview ──────────────────────────────────────────────────────────

  const tokens       = parseVarTokens(value);
  const hasVars      = tokens.length > 0;
  const previewItems = tokens.map(name => ({
    name,
    resolved: varValues[name] ?? null,
  }));

  // ── Render ─────────────────────────────────────────────────────────────────

  const { onFocus: _f, onBlur: _b, ...inputRest } = rest;

  return (
    <div
      className={`relative ${wrapperClassName ?? ''}`}
      onMouseEnter={() => hasVars && setShowPreview(true)}
      onMouseLeave={() => setShowPreview(false)}
    >
      <input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={`w-full ${className ?? ''}`}
        {...inputRest}
      />

      {/* Autocomplete dropdown — rendered in a portal to escape overflow:hidden parents */}
      {suggestions.length > 0 && dropPos && (
        <PortalDropdown
          pos={dropPos}
          items={suggestions}
          activeIndex={activeIndex}
          mode={suggestionMode}
          onPick={apply}
        />
      )}

      {/* Variable hover preview */}
      {showPreview && suggestions.length === 0 && previewItems.length > 0 && (
        <div className="absolute left-0 top-full mt-0.5 z-50 bg-surface-800 border border-surface-600 rounded shadow-xl text-xs min-w-[220px] max-w-[420px]">
          {previewItems.map(({ name, resolved }) => (
            <div key={name} className="flex items-baseline gap-2 px-3 py-1.5 border-b border-surface-700 last:border-0">
              <span className="font-mono text-blue-400 shrink-0">{`{{${name}}}`}</span>
              <span className="text-surface-500 mx-0.5">→</span>
              {resolved !== null
                ? <span className="font-mono text-emerald-400 truncate">{resolved}</span>
                : <span className="text-orange-400 italic">{t('undefined')}</span>
              }
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
