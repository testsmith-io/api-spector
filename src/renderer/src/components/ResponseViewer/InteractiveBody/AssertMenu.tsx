// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { useState, useEffect, useRef } from 'react';
import type { PopoverState } from './types';
import { getAtPath, jsonPathLabel } from './utils/jsonPath';
import {
  makeJsonSnippet,
  makeJsonPathSnippet,
  makeXmlSnippet,
  makeJsonExtractSnippet,
  makeJsonPathExtractSnippet,
  makeXmlExtractSnippet,
} from './utils/snippets';

interface Props {
  state: PopoverState
  onClose: () => void
  onConfirm: (snippet: string) => void
}

export function AssertMenu({ state, onClose, onConfirm }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [jpOpen, setJpOpen] = useState(false);
  const [filterKey, setFilterKey] = useState('');
  const [filterVal, setFilterVal] = useState('');

  // Click-outside + escape to close
  useEffect(() => {
    function onMouse(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  let title = '';
  let options: { label: string; snippet: string }[] = [];
  let jpSiblingKeys: string[] = [];
  let jpAvailable = false;

  if (state.type === 'json') {
    const { path, value, root } = state;
    const isStr = typeof value === 'string';
    const preview = isStr
      ? `"${(value as string).length > 22 ? (value as string).slice(0, 22) + '…' : value}"`
      : String(value);
    title = jsonPathLabel(path);
    options = [
      { label: `equals ${preview}`,                            snippet: makeJsonSnippet(path, value, 'equals')   },
      { label: 'exists (not null/undefined)',                  snippet: makeJsonSnippet(path, value, 'exists')   },
      { label: `is ${value === null ? 'null' : typeof value}`, snippet: makeJsonSnippet(path, value, 'type')     },
      ...(isStr ? [{ label: `contains ${preview}`,             snippet: makeJsonSnippet(path, value, 'contains') }] : []),
    ];

    // JSONPath filter: only when value is inside an array
    const arrayIdx = [...path].reverse().findIndex(k => typeof k === 'number');
    if (arrayIdx >= 0) {
      jpAvailable = true;
      const realIdx = path.length - 1 - arrayIdx;
      const itemObj = getAtPath(root, path.slice(0, realIdx + 1));
      if (itemObj != null && typeof itemObj === 'object' && !Array.isArray(itemObj)) {
        jpSiblingKeys = Object.keys(itemObj as Record<string, unknown>).filter(k => {
          const v = (itemObj as Record<string, unknown>)[k];
          return typeof v !== 'object' || v === null;
        });
      }
      if (!filterKey && jpSiblingKeys.length > 0) {
        // seed defaults once: prefer 'name' or 'id' if present, else first key
        const defaultKey = jpSiblingKeys.find(k => k === 'name' || k === 'id') ?? jpSiblingKeys[0];
        setTimeout(() => {
          setFilterKey(defaultKey);
          const seed = getAtPath(root, [...path.slice(0, realIdx + 1), defaultKey]);
          setFilterVal(seed != null ? String(seed) : '');
        }, 0);
      }
    }
  } else {
    const { selector, value } = state;
    const preview = `"${value.length > 22 ? value.slice(0, 22) + '…' : value}"`;
    title = selector;
    options = [
      { label: `equals ${preview}`,   snippet: makeXmlSnippet(selector, value, 'equals')   },
      { label: 'exists',              snippet: makeXmlSnippet(selector, value, 'exists')   },
      { label: `contains ${preview}`, snippet: makeXmlSnippet(selector, value, 'contains') },
    ];
  }

  // Clamp to viewport so we don't render off-screen
  const x = Math.min(state.x, window.innerWidth  - 280);
  const y = Math.min(state.y, window.innerHeight - 280);

  return (
    <div
      ref={ref}
      style={{ top: y, left: x, position: 'fixed' }}
      className="z-[200] bg-surface-900 border border-surface-700 rounded-lg shadow-2xl p-2 min-w-[260px]"
    >
      <div className="text-[10px] text-surface-500 font-mono px-1.5 pb-1.5 mb-1.5 border-b border-surface-800 truncate">
        {title}
      </div>
      {options.map(opt => (
        <button
          key={opt.label}
          onClick={() => { onConfirm(opt.snippet); onClose(); }}
          className="w-full text-left text-xs text-surface-300 hover:text-white hover:bg-surface-800 rounded px-2 py-1.5 transition-colors"
        >
          {opt.label}
        </button>
      ))}

      {jpAvailable && (
        <div className="mt-1 border-t border-surface-800 pt-1">
          <button
            onClick={() => setJpOpen(o => !o)}
            className="w-full text-left text-xs text-blue-400 hover:text-blue-300 hover:bg-surface-800 rounded px-2 py-1.5 transition-colors flex items-center gap-1"
          >
            <span>{jpOpen ? '▾' : '▸'}</span>
            <span>JSONPath assert (with filter)</span>
          </button>
          {jpOpen && state.type === 'json' && (
            <div className="mt-1 px-2 flex flex-col gap-1.5">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-surface-400 w-16 shrink-0">filter by</span>
                <select
                  value={filterKey}
                  onChange={e => {
                    const k = e.target.value;
                    setFilterKey(k);
                    const arrayIdx2 = [...state.path].reverse().findIndex(seg => typeof seg === 'number');
                    const realIdx2 = state.path.length - 1 - arrayIdx2;
                    const itemObj2 = getAtPath(state.root, state.path.slice(0, realIdx2 + 1));
                    const seed = itemObj2 != null ? (itemObj2 as Record<string, unknown>)[k] : undefined;
                    setFilterVal(seed != null ? String(seed) : '');
                  }}
                  className="flex-1 bg-surface-800 border border-surface-700 rounded px-1 py-0.5 text-xs focus:outline-none"
                >
                  {jpSiblingKeys.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-surface-400 w-16 shrink-0">equals</span>
                <input
                  value={filterVal}
                  onChange={e => setFilterVal(e.target.value)}
                  className="flex-1 bg-surface-800 border border-surface-700 rounded px-1 py-0.5 text-xs font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex gap-1 self-end">
                <button
                  disabled={!filterKey || !filterVal}
                  onClick={() => { onConfirm(makeJsonPathSnippet(state.path, state.value, filterKey, filterVal)); onClose(); }}
                  className="text-xs px-2 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 rounded transition-colors"
                >
                  Assert
                </button>
                <button
                  disabled={!filterKey || !filterVal}
                  onClick={() => { onConfirm(makeJsonPathExtractSnippet(state.path, filterKey, filterVal, 'variables')); onClose(); }}
                  className="text-xs px-2 py-1 bg-surface-700 hover:bg-surface-600 disabled:opacity-40 rounded transition-colors"
                >
                  → variable
                </button>
                <button
                  disabled={!filterKey || !filterVal}
                  onClick={() => { onConfirm(makeJsonPathExtractSnippet(state.path, filterKey, filterVal, 'environment')); onClose(); }}
                  className="text-xs px-2 py-1 bg-surface-700 hover:bg-surface-600 disabled:opacity-40 rounded transition-colors"
                >
                  → env
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Extract section ── */}
      <div className="mt-1 border-t border-surface-800 pt-1">
        <div className="text-[10px] text-surface-500 uppercase tracking-wider px-2 py-1">Extract</div>
        {state.type === 'json' ? (
          <>
            <button
              onClick={() => { onConfirm(makeJsonExtractSnippet(state.path, 'variables')); onClose(); }}
              className="w-full text-left text-xs text-surface-300 hover:text-white hover:bg-surface-800 rounded px-2 py-1.5 transition-colors"
            >
              Save to variable
            </button>
            <button
              onClick={() => { onConfirm(makeJsonExtractSnippet(state.path, 'environment')); onClose(); }}
              className="w-full text-left text-xs text-surface-300 hover:text-white hover:bg-surface-800 rounded px-2 py-1.5 transition-colors"
            >
              Save to environment
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => { onConfirm(makeXmlExtractSnippet(state.selector, 'variables')); onClose(); }}
              className="w-full text-left text-xs text-surface-300 hover:text-white hover:bg-surface-800 rounded px-2 py-1.5 transition-colors"
            >
              Save to variable
            </button>
            <button
              onClick={() => { onConfirm(makeXmlExtractSnippet(state.selector, 'environment')); onClose(); }}
              className="w-full text-left text-xs text-surface-300 hover:text-white hover:bg-surface-800 rounded px-2 py-1.5 transition-colors"
            >
              Save to environment
            </button>
          </>
        )}
      </div>
    </div>
  );
}
