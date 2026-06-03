// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

/** Escape backslashes, double-quotes, and newlines for safe string interpolation. */
export function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '');
}

/** Render a primitive value as a JavaScript literal: strings get quoted+escaped. */
export function toLit(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return `"${esc(v)}"`;
  return String(v);
}
