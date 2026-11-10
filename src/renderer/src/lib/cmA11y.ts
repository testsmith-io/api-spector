// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { EditorView, ViewPlugin } from '@uiw/react-codemirror';

// axe `scrollable-region-focusable`: a scroll container must be keyboard-
// reachable. CodeMirror's scroller (`.cm-scroller`) isn't, so give it tabindex=0.
const scrollerFocusable = ViewPlugin.define(view => {
  try { view.scrollDOM.setAttribute('tabindex', '0'); } catch { /* no-op */ }
  return {};
});

/** A11y extensions for a CodeMirror editor: an accessible name on the textbox
 *  content and a keyboard-focusable scroller. Spread into `extensions`:
 *    <CodeMirror extensions={[json(), ...cmLabel(t('Request body'))]} /> */
export function cmLabel(label: string) {
  return [
    EditorView.contentAttributes.of({ 'aria-label': label }),
    scrollerFocusable,
  ];
}
