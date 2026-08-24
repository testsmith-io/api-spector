// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { keymap } from '@codemirror/view';
import { toggleComment } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';

// Cmd/Ctrl+/ toggles comments on the selected lines. `toggleComment` picks a
// line comment when the language defines one, otherwise a block comment. Kept at
// the editor level (not global) so it only fires while a payload editor is
// focused, and preventDefault stops the browser/Electron default for the combo.
export const commentKeymap = keymap.of([
  { key: 'Mod-/', run: toggleComment, preventDefault: true },
]);

// JSON has no comment syntax of its own, but JSONC-style `//` line comments are
// the de-facto convention every editor uses. Teach the language that token so
// Cmd/Ctrl+/ has something to toggle. Returns the language + its comment-token
// language-data + the keymap, ready to spread into a CodeMirror `extensions`.
export function jsonWithComments() {
  const lang = json();
  return [lang, lang.language.data.of({ commentTokens: { line: '//' } }), commentKeymap];
}

// XML already ships block-comment tokens (<!-- -->) via @codemirror/lang-xml, so
// we only need to add the keymap on top of the language.
export function xmlWithComments() {
  return [xml(), commentKeymap];
}
