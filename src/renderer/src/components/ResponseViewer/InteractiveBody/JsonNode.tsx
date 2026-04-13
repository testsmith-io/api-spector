// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useState } from 'react';
import type { JsonPath } from './utils/jsonPath';

interface Props {
  nodeKey: string | number | null
  value: unknown
  path: JsonPath
  depth: number
  onLeaf: (e: React.MouseEvent, path: JsonPath, value: unknown) => void
}

export function JsonNode({ nodeKey, value, path, depth, onLeaf }: Props) {
  // Auto-expand the first two levels for readability
  const [expanded, setExpanded] = useState(depth < 2);

  const keySpan =
    nodeKey !== null ? (
      <span className="text-surface-500 font-mono text-xs shrink-0 select-all">
        {typeof nodeKey === 'number' ? `[${nodeKey}]` : nodeKey}
        {value === null || typeof value !== 'object' ? ':' : ''}
      </span>
    ) : null;

  /* ── leaf ── */
  if (value === null || typeof value !== 'object') {
    const display =
      value === null
        ? 'null'
        : typeof value === 'string'
          ? `"${(value as string).length > 100 ? (value as string).slice(0, 100) + '…' : value}"`
          : String(value);
    const cls =
      value === null
        ? 'text-surface-600 italic'
        : typeof value === 'string'
          ? 'text-emerald-400'
          : typeof value === 'number'
            ? 'text-blue-400'
            : 'text-amber-400'; // boolean

    return (
      <div className="group flex items-center gap-1.5 py-0.5 pl-1 rounded hover:bg-surface-800/40 min-w-0">
        {keySpan}
        <span className={`font-mono text-xs ${cls} select-all break-all min-w-0 truncate`}>{display}</span>
        <button
          onClick={e => onLeaf(e, path, value)}
          className="ml-auto opacity-0 group-hover:opacity-100 shrink-0 text-[10px] px-1.5 leading-4 py-0.5 text-blue-400 border border-blue-800 hover:border-blue-500 hover:text-blue-300 rounded transition-all"
          title="Add assertion for this value"
        >
          + insert
        </button>
      </div>
    );
  }

  /* ── branch ── */
  const isArr = Array.isArray(value);
  const entries: [string | number, unknown][] = isArr
    ? (value as unknown[]).map((v, i) => [i, v])
    : Object.entries(value as Record<string, unknown>);
  const summary = isArr ? `[${(value as unknown[]).length}]` : `{${entries.length}}`;

  return (
    <div>
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1.5 py-0.5 pl-1 rounded hover:bg-surface-800/40 w-full text-left"
      >
        <span className="text-surface-600 text-[10px] w-3 shrink-0 text-center">
          {expanded ? '▾' : '▸'}
        </span>
        {keySpan}
        <span className="text-surface-600 text-xs">{summary}</span>
      </button>
      {expanded && (
        <div className="ml-4 border-l border-surface-800 pl-1">
          {entries.map(([k, v]) => (
            <JsonNode
              key={String(k)}
              nodeKey={k}
              value={v}
              path={[...path, k]}
              depth={depth + 1}
              onLeaf={onLeaf}
            />
          ))}
        </div>
      )}
    </div>
  );
}
