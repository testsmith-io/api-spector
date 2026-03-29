// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useRef, useState, useCallback } from 'react';
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

// ─── Component ───────────────────────────────────────────────────────────────

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string
  onChange: (value: string) => void
  /** Classes for the outer wrapper div (layout: flex-1, w-full, etc.) */
  wrapperClassName?: string
}

export function VarInput({ value, onChange, className, wrapperClassName, ...rest }: Props) {
  const varNames  = useVarNames();
  const varValues = useVarValues();
  const inputRef  = useRef<HTMLInputElement>(null);

  const [suggestions,  setSuggestions]  = useState<string[]>([]);
  const [activeIndex,  setActiveIndex]  = useState(-1);
  const [showPreview,  setShowPreview]  = useState(false);

  // ── Autocomplete ───────────────────────────────────────────────────────────

  function detectQuery(val: string, cursor: number) {
    const before = val.slice(0, cursor);
    const match  = /\{\{(\w*)$/.exec(before);
    if (!match) { setSuggestions([]); return; }

    const q        = match[1].toLowerCase();
    const filtered = varNames.filter(n => n.toLowerCase().includes(q));
    setSuggestions(filtered);
    setActiveIndex(-1);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newVal = e.target.value;
    const cursor = e.target.selectionStart ?? newVal.length;
    onChange(newVal);
    detectQuery(newVal, cursor);
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

  const apply = useCallback((name: string) => {
    const el     = inputRef.current;
    const cursor = el?.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const after  = value.slice(cursor);
    const match  = /\{\{(\w*)$/.exec(before);
    if (!match) return;

    const newVal    = before.slice(0, match.index) + `{{${name}}}` + after;
    const newCursor = match.index + name.length + 4;
    onChange(newVal);
    setSuggestions([]);
    requestAnimationFrame(() => el?.setSelectionRange(newCursor, newCursor));
  }, [value, onChange]);

  function handleBlur() {
    setTimeout(() => setSuggestions([]), 150);
  }

  // ── Hover preview ──────────────────────────────────────────────────────────

  const tokens        = parseVarTokens(value);
  const hasVars       = tokens.length > 0;
  const previewItems  = tokens.map(name => ({
    name,
    resolved: varValues[name] ?? null,
  }));

  // ── Render ─────────────────────────────────────────────────────────────────

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
        onBlur={handleBlur}
        className={`w-full ${className ?? ''}`}
        {...rest}
      />

      {/* {{var}} autocomplete dropdown */}
      {suggestions.length > 0 && (
        <ul className="absolute left-0 top-full mt-0.5 z-50 min-w-[160px] max-h-44 overflow-y-auto bg-surface-800 border border-surface-600 rounded shadow-xl text-xs">
          {suggestions.map((name, i) => (
            <li key={name}>
              <button
                onMouseDown={e => { e.preventDefault(); apply(name); }}
                className={`w-full text-left px-3 py-1.5 font-mono transition-colors ${
                  i === activeIndex
                    ? 'bg-blue-600 text-white'
                    : 'hover:bg-surface-700'
                }`}
              >
                <span className="text-surface-500">{'{{'}</span>
                <span>{name}</span>
                <span className="text-surface-500">{'}}'}</span>
              </button>
            </li>
          ))}
        </ul>
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
