// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React from 'react';

// Renders a translatable string with inline markup (**bold**, *italic*, `code`)
// so each locale controls word order and emphasis, not split t() fragments.
const RICH_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

export function renderMarkup(text: string): React.ReactNode[] {
  return text.split(RICH_RE).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`')) return <span key={i} className="font-mono">{part.slice(1, -1)}</span>;
    return part;
  });
}
