// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Shared Tailwind class strings for the most-repeated UI "tokens", so the same
// look isn't re-typed dozens of times. Compose with template literals when a
// site needs extra classes, e.g. className={`${inputCls} w-full`}.

/** Small uppercase field label above an input. */
export const labelCls = 'text-[10px] uppercase tracking-wider text-surface-600 font-medium';

/** Standard text input / select. */
// Border uses surface-500 (3:1 on the panel surface, WCAG 1.4.11) rather than the
// too-faint surface-700 (2.08:1). Keyboard focus adds a visible ring globally
// (see index.css :focus-visible fallback) on top of the blue border swap.
export const inputCls = 'bg-surface-800 border border-surface-500 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono';

/** Neutral secondary button. */
export const btnSecondaryCls = 'px-3 py-1.5 text-xs bg-surface-800 hover:bg-surface-700 rounded transition-colors';

/** Primary (blue) action button, with disabled styling. */
export const btnPrimaryCls = 'px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-surface-800 disabled:text-surface-600 rounded transition-colors';
