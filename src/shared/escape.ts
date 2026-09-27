// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// HTML/XML escaping shared across report and docs generators. Pure and
// dependency-free, so it is safe to import from main, renderer, and CLI.

/** Escape the five markup-significant characters for HTML text/attributes.
 *  Accepts anything and coerces to string (null/undefined → ""). */
export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Like {@link escapeHtml} but also escapes `'` as `&apos;` (XML attributes). */
export function escapeXml(s: unknown): string {
  return escapeHtml(s).replace(/'/g, '&apos;');
}
