// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

/**
 * Build a CSS-style selector that uniquely identifies `el` within its document.
 * Walks up the parent chain, qualifying each step with `:nth-of-type` when the
 * element has multiple same-tagged siblings.
 */
export function buildSelector(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur) {
    const parent: Element | null = cur.parentElement;
    if (!parent) break;
    const tag = cur.tagName;
    const siblings: Element[] = Array.from(parent.children).filter((c: Element) => c.tagName === tag);
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(cur) + 1})` : tag);
    cur = parent;
  }
  return parts.join(' > ');
}
