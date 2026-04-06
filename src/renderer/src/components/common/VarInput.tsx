// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useRef, useState, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useVarNames } from '../../hooks/useVarNames';
import { useVarValues } from '../../hooks/useVarValues';

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
  items: string[]
  activeIndex: number
  mode: 'var' | 'static'
  onPick: (s: string) => void
}) {
  return ReactDOM.createPortal(
    <ul
      style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.minWidth, zIndex: 9999 }}
      className="max-h-52 overflow-y-auto bg-surface-800 border border-surface-600 rounded shadow-xl text-xs"
    >
      {items.map((s, i) => (
        <li key={s}>
          <button
            onMouseDown={e => { e.preventDefault(); onPick(s); }}
            className={`w-full text-left px-3 py-1.5 font-mono transition-colors ${
              i === activeIndex ? 'bg-blue-600 text-white' : 'hover:bg-surface-700'
            }`}
          >
            {mode === 'var' ? (
              <>
                <span className="text-surface-500">{'{{'}</span>
                <span>{s}</span>
                <span className="text-surface-500">{'}}'}</span>
              </>
            ) : s}
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
  const varNames  = useVarNames();
  const varValues = useVarValues();
  const inputRef  = useRef<HTMLInputElement>(null);

  const [suggestions,    setSuggestions]    = useState<string[]>([]);
  const [suggestionMode, setSuggestionMode] = useState<SuggestionMode>('var');
  const [activeIndex,    setActiveIndex]    = useState(-1);
  const [dropPos,        setDropPos]        = useState<DropdownPos | null>(null);
  const [showPreview,    setShowPreview]    = useState(false);

  // Recalculate portal position whenever suggestions appear or window resizes
  useEffect(() => {
    if (suggestions.length === 0) { setDropPos(null); return; }
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setDropPos({ top: r.bottom + 2, left: r.left, minWidth: r.width });
  }, [suggestions.length]);

  // ── Autocomplete ───────────────────────────────────────────────────────────

  function detectQuery(val: string, cursor: number) {
    const before   = val.slice(0, cursor);
    const varMatch = /\{\{(\w*)$/.exec(before);

    if (varMatch) {
      const q        = varMatch[1].toLowerCase();
      const filtered = varNames.filter(n => n.toLowerCase().includes(q));
      setSuggestions(filtered);
      setSuggestionMode('var');
      setActiveIndex(-1);
    } else if (staticSuggestions) {
      const q        = val.toLowerCase();
      const filtered = q
        ? staticSuggestions
            .filter(s => s.toLowerCase().includes(q))
            .sort((a, b) => {
              const aP = a.toLowerCase().startsWith(q) ? 0 : 1;
              const bP = b.toLowerCase().startsWith(q) ? 0 : 1;
              return aP - bP;
            })
            .slice(0, 20)
        : staticSuggestions.slice(0, 20);
      setSuggestions(filtered);
      setSuggestionMode('static');
      setActiveIndex(-1);
    } else {
      setSuggestions([]);
    }
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

  const apply = useCallback((suggestion: string) => {
    if (suggestionMode === 'static') {
      onChange(suggestion);
      setSuggestions([]);
      return;
    }

    // var mode: splice {{name}} at cursor position
    const el     = inputRef.current;
    const cursor = el?.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const after  = value.slice(cursor);
    const match  = /\{\{(\w*)$/.exec(before);
    if (!match) return;

    const newVal    = before.slice(0, match.index) + `{{${suggestion}}}` + after;
    const newCursor = match.index + suggestion.length + 4;
    onChange(newVal);
    setSuggestions([]);
    requestAnimationFrame(() => el?.setSelectionRange(newCursor, newCursor));
  }, [suggestionMode, value, onChange]);

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
                : <span className="text-orange-400 italic">undefined</span>
              }
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
