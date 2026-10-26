// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { keymap, Decoration, ViewPlugin, EditorView } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { toggleComment } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { jsonCommentRanges } from '../../../../shared/strip-json-comments';

// Cmd/Ctrl+/ toggles comments on the selected lines. `toggleComment` picks a
// line comment when the language defines one, otherwise a block comment. Kept at
// the editor level (not global) so it only fires while a payload editor is
// focused, and preventDefault stops the browser/Electron default for the combo.
export const commentKeymap = keymap.of([
  { key: 'Mod-/', run: toggleComment, preventDefault: true },
]);

// The JSON grammar has no comment token, so // and /* */ comments aren't coloured
// by the language. This decoration marks every comment span (string-aware, shared
// with the send-time stripper) and the theme greys it out, so commented lines read
// as comments rather than as broken JSON.
const commentMark = Decoration.mark({ class: 'cm-jsonc-comment' });

// Use `theme` (higher precedence than `baseTheme`) and override descendants with
// !important: the comment span wraps JSON tokens that carry their own colours
// from the active highlight style, so the inner spans must be forced too.
const jsoncCommentTheme = EditorView.theme({
  '.cm-jsonc-comment, .cm-jsonc-comment *': {
    color: '#7d8799 !important',
    fontStyle: 'italic',
  },
});

function buildCommentDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of jsonCommentRanges(view.state.doc.toString())) {
    if (r.to > r.from) builder.add(r.from, r.to, commentMark);
  }
  return builder.finish();
}

export const jsonCommentHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildCommentDecorations(view); }
    update(u: ViewUpdate) { if (u.docChanged) this.decorations = buildCommentDecorations(u.view); }
  },
  { decorations: v => v.decorations },
);

// JSON has no comment syntax of its own, but JSONC-style `//` line comments are
// the de-facto convention every editor uses. Teach the language that token so
// Cmd/Ctrl+/ has something to toggle, and colour comment spans. Returns the
// language + comment-token language-data + keymap + highlighter, ready to spread
// into a CodeMirror `extensions`.
export function jsonWithComments() {
  const lang = json();
  return [
    lang,
    lang.language.data.of({ commentTokens: { line: '//' } }),
    commentKeymap,
    jsonCommentHighlighter,
    jsoncCommentTheme,
  ];
}

// XML already ships block-comment tokens (<!-- -->) via @codemirror/lang-xml, so
// we only need to add the keymap on top of the language.
export function xmlWithComments() {
  return [xml(), commentKeymap];
}
