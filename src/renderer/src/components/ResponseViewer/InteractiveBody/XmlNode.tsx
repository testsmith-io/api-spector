// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useState } from 'react';
import { buildSelector } from './utils/xmlPath';

interface Props {
  element: Element
  depth: number
  onLeaf: (e: React.MouseEvent, selector: string, value: string) => void
}

export function XmlNode({ element, depth, onLeaf }: Props) {
  // XML tends to be deeper than JSON; auto-expand the first three levels
  const [expanded, setExpanded] = useState(depth < 3);
  const childEls = Array.from(element.children);
  const tag = element.tagName;

  /* ── leaf element (no child elements, only text) ── */
  if (childEls.length === 0) {
    const text = element.textContent ?? '';
    const selector = buildSelector(element);
    return (
      <div className="group flex items-center gap-1.5 py-0.5 pl-1 rounded hover:bg-surface-800/40 min-w-0">
        <span className="text-blue-300 font-mono text-xs shrink-0">&lt;{tag}&gt;</span>
        <span className="text-emerald-400 font-mono text-xs select-all break-all min-w-0 truncate">
          {text.length > 100 ? text.slice(0, 100) + '…' : text}
        </span>
        <button
          onClick={e => onLeaf(e, selector, text)}
          className="ml-auto opacity-0 group-hover:opacity-100 shrink-0 text-[10px] px-1.5 leading-4 py-0.5 text-blue-400 border border-blue-800 hover:border-blue-500 hover:text-blue-300 rounded transition-all"
          title="Add assertion for this value"
        >
          + insert
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1.5 py-0.5 pl-1 rounded hover:bg-surface-800/40 w-full text-left"
      >
        <span className="text-surface-600 text-[10px] w-3 shrink-0 text-center">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="text-blue-300 font-mono text-xs">&lt;{tag}&gt;</span>
        <span className="text-surface-600 text-xs ml-1">{childEls.length}</span>
      </button>
      {expanded && (
        <div className="ml-4 border-l border-surface-800 pl-1">
          {childEls.map((child, i) => (
            <XmlNode key={i} element={child} depth={depth + 1} onLeaf={onLeaf} />
          ))}
        </div>
      )}
    </div>
  );
}
