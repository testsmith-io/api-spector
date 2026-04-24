// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

// ─── Snippet appender ────────────────────────────────────────────────────────
//
// Hoists `const json = sp.response.json();` to the top of the script so
// multiple JSON-based snippets don't each redeclare it inside their
// sp.test(...) block. Shared between the response-tree "Add assertion" flow
// and the Scripts-tab snippet palette.

const JSON_DECL = 'const json = sp.response.json();';

/** Matches a `const json = sp.response.json();` declaration anywhere, so we
 *  can detect whether the script already has one and remove stale inline
 *  copies from incoming snippets. */
const JSON_DECL_RX_G = /[ \t]*const\s+json\s*=\s*sp\.response\.json\(\)\s*;?\s*\n?/g;

/** True if the snippet references the `json` identifier (e.g. `json.field`,
 *  `sp.jsonPath(json, …)`) and therefore depends on a declaration. */
function snippetUsesJson ( snippet: string ): boolean {
  // Strip the declaration itself before testing — a snippet that *only*
  // declares json shouldn't trigger hoisting of another declaration.
  const withoutDecl = snippet.replace( JSON_DECL_RX_G, '' );
  return /\bjson\b/.test( withoutDecl );
}

/**
 * Append `snippet` to `existing`, hoisting a single top-level
 * `const json = sp.response.json();` when the combined script needs it.
 *
 * - Strips redundant `const json = …` lines from the incoming snippet.
 * - If any part of the resulting script references `json`, ensures exactly
 *   one declaration lives at the top.
 */
export function appendSnippetToScript ( existing: string, snippet: string ): string {
  const cleanedSnippet = snippet.replace( JSON_DECL_RX_G, '' ).replace( /^\n+/, '' );

  const sep = existing.trim() ? '\n\n' : '';
  let combined = existing + sep + cleanedSnippet;

  const needsJson = snippetUsesJson( existing ) || snippetUsesJson( cleanedSnippet );
  const hasTopDecl = /^\s*const\s+json\s*=\s*sp\.response\.json\(\)/m.test( combined );

  if ( needsJson && !hasTopDecl ) {
    // Strip any stray declarations inside existing too (defensive), then
    // prepend one clean declaration at the top.
    combined = combined.replace( JSON_DECL_RX_G, '' );
    combined = `${JSON_DECL}\n\n${combined.replace( /^\n+/, '' )}`;
  }

  return combined;
}
