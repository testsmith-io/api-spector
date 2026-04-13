// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { ResponsePayload } from '../../../../shared/types';
import { getStatusColor } from '../../../../shared/colors';
import { prettyJson } from './utils/formatters';
import { computeLineDiff, type DiffLineType } from './utils/diffEngine';

const lineStyle: Record<DiffLineType, string> = {
  equal: 'text-surface-400',
  removed: 'bg-red-900/30 text-red-300',
  added: 'bg-emerald-900/30 text-emerald-300',
};

const linePrefix: Record<DiffLineType, string> = {
  equal: ' ',
  removed: '-',
  added: '+',
};

export function DiffView({ pinned, current }: { pinned: ResponsePayload; current: ResponsePayload }) {
  const pinnedBody = prettyJson(pinned.body);
  const currentBody = prettyJson(current.body);
  const diffLines = computeLineDiff(pinnedBody, currentBody);

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Status row */}
      <div className="flex items-center gap-6 px-4 py-2 border-b border-surface-800 text-xs shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-surface-600 font-medium uppercase text-[10px] tracking-wider">Pinned</span>
          <span className={`font-bold ${getStatusColor(pinned.status)}`}>{pinned.status} {pinned.statusText}</span>
          <span className="text-surface-400">{pinned.durationMs}ms</span>
        </div>
        <span className="text-surface-400">vs</span>
        <div className="flex items-center gap-2">
          <span className="text-surface-600 font-medium uppercase text-[10px] tracking-wider">Current</span>
          <span className={`font-bold ${getStatusColor(current.status)}`}>{current.status} {current.statusText}</span>
          <span className="text-surface-400">{current.durationMs}ms</span>
        </div>
      </div>

      {/* Diff lines */}
      <div className="flex-1 overflow-auto font-mono text-xs px-2 py-2">
        {diffLines.map((line, idx) => (
          <div
            key={idx}
            className={`flex gap-2 px-2 py-px leading-5 whitespace-pre-wrap ${lineStyle[line.type]}`}
          >
            <span className="select-none w-3 shrink-0 text-center">{linePrefix[line.type]}</span>
            <span className="break-all">{line.text}</span>
          </div>
        ))}
        {diffLines.length === 0 && (
          <div className="flex items-center justify-center h-full text-surface-600">
            No differences found
          </div>
        )}
      </div>
    </div>
  );
}
