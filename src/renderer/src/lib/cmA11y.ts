// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { EditorView, ViewPlugin } from '@uiw/react-codemirror';

// axe `scrollable-region-focusable`: a scroll container must be reachable by
// keyboard. CodeMirror's scroller (`.cm-scroller`) isn't focusable on its own,
// so give it tabindex=0. (The editable content is focusable too, but axe checks
// the scroller element itself.)
const scrollerFocusable = ViewPlugin.define(view => {
  try { view.scrollDOM.setAttribute('tabindex', '0'); } catch { /* no-op */ }
  return {};
});

/**
 * Accessibility extensions for a CodeMirror editor:
 *  - an accessible name on the `role="textbox"` content (axe: aria-input-field-name)
 *  - a keyboard-focusable scroller (axe: scrollable-region-focusable)
 * Spread into the editor's `extensions`:
 *
 *   <CodeMirror extensions={[json(), ...cmLabel(t('Request body'))]} />
 */
export function cmLabel(label: string) {
  return [
    EditorView.contentAttributes.of({ 'aria-label': label }),
    scrollerFocusable,
  ];
}
