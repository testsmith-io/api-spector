// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useEffect, useRef, useState, useCallback, useId } from 'react';

// ─── Shared modal shell ───────────────────────────────────────────────────────
//
// Wraps the fixed inset-0 overlay + centered panel pattern used by every modal
// in the app. Handles Escape-to-close and (opt-in) click-outside-to-close.
// Backdrop-close is OFF by default so a stray click next to a dialog never
// discards it; dialogs close via the × button, a Cancel/Close button, or Escape.
//
// The overlay and panel classes are full replacements (not appended) so call
// sites keep pixel-identical styling — pass the exact classes the modal had
// before. `fixed inset-0` is always applied to the overlay.
//
// The dialog opens centered and can be dragged by its title bar (when a `title`
// is provided). The drag is a transform offset from the centered position, so
// it reopens centered; the offset is clamped to keep the panel on screen.

const DEFAULT_OVERLAY = 'bg-black/50 z-50 flex items-center justify-center';
const DEFAULT_PANEL   = 'bg-surface-900 border border-surface-800 rounded-lg shadow-2xl flex flex-col';

interface ModalProps {
  readonly onClose: () => void
  /** When set, renders the standard title bar (title + × close button). */
  readonly title?: React.ReactNode
  /** Small line under the title — only rendered when `title` is set. */
  readonly subtitle?: React.ReactNode
  /** Overlay classes (darkness, z-index, alignment). Replaces the default. */
  readonly overlayClassName?: string
  /** Panel classes (width, layout, border). Replaces the default. */
  readonly panelClassName?: string
  /** Close when the backdrop is clicked. Default false (opt-in per dialog). */
  readonly closeOnBackdrop?: boolean
  /** Close when Escape is pressed. Default true. */
  readonly closeOnEscape?: boolean
  readonly children: React.ReactNode
}

// A modal that renders its OWN header (no `title` prop) can still be dragged by
// putting `data-modal-drag` (and a `cursor-move` class) on that header element.
export function Modal({
  onClose,
  title,
  subtitle,
  overlayClassName = DEFAULT_OVERLAY,
  panelClassName = DEFAULT_PANEL,
  closeOnBackdrop = false,
  closeOnEscape = true,
  children,
}: ModalProps) {
  useEffect(() => {
    if (!closeOnEscape) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeOnEscape, onClose]);

  // ── Drag by the title bar ──────────────────────────────────────────────────
  // The panel is centered by the overlay's flexbox; dragging stores an (x, y)
  // offset applied as a transform, clamped so the dialog can't leave the screen.
  const panelRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  const onDragMove = useCallback((e: MouseEvent) => {
    const d = drag.current;
    if (!d) return;
    let x = d.baseX + (e.clientX - d.startX);
    let y = d.baseY + (e.clientY - d.startY);
    const panel = panelRef.current;
    if (panel) {
      const maxX = Math.max(0, (window.innerWidth - panel.offsetWidth) / 2);
      const maxY = Math.max(0, (window.innerHeight - panel.offsetHeight) / 2);
      x = Math.min(maxX, Math.max(-maxX, x));
      y = Math.min(maxY, Math.max(-maxY, y));
    }
    setOffset({ x, y });
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', endDrag);
    document.body.style.userSelect = '';
  }, [onDragMove]);

  // Start a drag when the press lands on a drag region — the built-in title bar
  // or anything marked `data-modal-drag` (so a modal with its own header is
  // draggable too) — but not on a control inside it (button/input/…).
  const onPanelMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;           // left button only
    const el = e.target as HTMLElement;
    if (!el.closest('[data-modal-drag]')) return;
    if (el.closest('button, a, input, select, textarea, [role="button"], [contenteditable=""], [contenteditable="true"]')) return;
    drag.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', endDrag);
  }, [offset.x, offset.y, onDragMove, endDrag]);

  // Safety: drop listeners if the modal unmounts mid-drag.
  useEffect(() => endDrag, [endDrag]);

  // Every dialog needs an accessible name (WCAG / axe aria-dialog-name): point at
  // the title heading when there is one, else a generic label so it's never nameless.
  const titleId = useId();

  return (
    <div
      role={closeOnBackdrop ? 'button' : undefined}
      tabIndex={closeOnBackdrop ? -1 : undefined}
      aria-label={closeOnBackdrop ? 'Close dialog' : undefined}
      className={`fixed inset-0 ${overlayClassName}`}
      // Close only when the click/keypress lands on the backdrop itself, not on
      // content bubbling up from the dialog — so the dialog needs no guard handlers.
      onClick={closeOnBackdrop ? (e => { if (e.target === e.currentTarget) onClose(); }) : undefined}
      onKeyDown={closeOnBackdrop ? (e => { if (e.key === 'Escape') onClose(); }) : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title !== undefined ? titleId : undefined}
        aria-label={title === undefined ? 'Dialog' : undefined}
        className={panelClassName}
        style={(offset.x || offset.y) ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}
        onMouseDown={onPanelMouseDown}
      >
        {title !== undefined && (
          <div
            data-modal-drag
            className="flex items-center justify-between px-4 py-2.5 border-b border-surface-800 flex-shrink-0 cursor-move select-none"
          >
            <div>
              <h2 id={titleId} className="text-sm font-semibold">{title}</h2>
              {subtitle !== undefined && (
                <p className="text-[10px] text-surface-400 mt-0.5">{subtitle}</p>
              )}
            </div>
            <button onClick={onClose} aria-label="Close" title="Close" className="text-surface-400 hover:text-[var(--text-primary)] text-lg leading-none cursor-pointer">×</button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
