// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Snippet appender: hoists a single `const json = sp.response.json();` to the top
// so multiple JSON snippets don't each redeclare it. Shared by the response-tree
// "Add assertion" flow and the Scripts-tab snippet palette.

const JSON_DECL = 'const json = sp.response.json();';

/** Matches a `const json = sp.response.json();` anywhere, to detect an existing
 *  declaration and strip stale inline copies from snippets. */
const JSON_DECL_RX_G = /[ \t]*const\s+json\s*=\s*sp\.response\.json\(\)\s*;?\s*\n?/g;

/** True if the snippet references the `json` identifier and so needs a declaration. */
function snippetUsesJson ( snippet: string ): boolean {
  // Strip the declaration before testing: a snippet that only declares json
  // shouldn't trigger hoisting.
  const withoutDecl = snippet.replace( JSON_DECL_RX_G, '' );
  return /\bjson\b/.test( withoutDecl );
}

/** Append `snippet` to `existing`, hoisting one top-level
 *  `const json = sp.response.json();` when the combined script references json. */
export function appendSnippetToScript ( existing: string, snippet: string ): string {
  const cleanedSnippet = snippet.replace( JSON_DECL_RX_G, '' ).replace( /^\n+/, '' );

  const sep = existing.trim() ? '\n\n' : '';
  let combined = existing + sep + cleanedSnippet;

  const needsJson = snippetUsesJson( existing ) || snippetUsesJson( cleanedSnippet );
  const hasTopDecl = /^\s*const\s+json\s*=\s*sp\.response\.json\(\)/m.test( combined );

  if ( needsJson && !hasTopDecl ) {
    // Strip any stray declarations, then prepend one clean one at the top.
    combined = combined.replace( JSON_DECL_RX_G, '' );
    combined = `${JSON_DECL}\n\n${combined.replace( /^\n+/, '' )}`;
  }

  return combined;
}
