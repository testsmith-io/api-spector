// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React from 'react';

// Renders a single translatable string with lightweight inline markup so each
// locale controls word order, emphasis, and punctuation (instead of splitting a
// sentence into many t() fragments, which breaks translation and misplaces the
// emphasis). Supported markers:
//   **bold**   -> <strong>
//   *italic*   -> <em>
//   `code`     -> <span class="font-mono">
const RICH_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

export function renderMarkup(text: string): React.ReactNode[] {
  return text.split(RICH_RE).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`')) return <span key={i} className="font-mono">{part.slice(1, -1)}</span>;
    return part;
  });
}
