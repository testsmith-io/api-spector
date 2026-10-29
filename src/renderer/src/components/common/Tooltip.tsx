// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { ReactNode } from 'react';

// Instant, styled tooltip (matches the activity-bar tooltip). Native `title=`
// tooltips have a ~1s browser delay; this shows immediately on hover/focus.
// Wrap a control: <Tooltip label="Save"><button .../></Tooltip>. Keep an
// aria-label on the control itself for screen readers — this is visual only.
export function Tooltip({
  label,
  align = 'center',
  children,
}: {
  readonly label: string
  readonly align?: 'center' | 'left' | 'right'
  readonly children: ReactNode
}) {
  const pos = align === 'right' ? 'right-0'
    : align === 'left' ? 'left-0'
      : 'left-1/2 -translate-x-1/2';
  return (
    <span className="relative inline-flex group/tip">
      {children}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute top-full ${pos} mt-1.5 z-50 hidden group-hover/tip:block group-focus-within/tip:block whitespace-nowrap rounded px-2 py-1 text-[11px] bg-surface-900 text-[var(--text-primary)] border border-surface-700 shadow-lg`}
      >
        {label}
      </span>
    </span>
  );
}
