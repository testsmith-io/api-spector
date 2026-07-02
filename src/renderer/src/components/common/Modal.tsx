// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useEffect } from 'react';

// ─── Shared modal shell ───────────────────────────────────────────────────────
//
// Wraps the fixed inset-0 overlay + centered panel pattern used by every modal
// in the app. Handles Escape-to-close and (optional) click-outside-to-close;
// clicks inside the panel never propagate to the overlay.
//
// The overlay and panel classes are full replacements (not appended) so call
// sites keep pixel-identical styling — pass the exact classes the modal had
// before. `fixed inset-0` is always applied to the overlay.

const DEFAULT_OVERLAY = 'bg-black/50 z-50 flex items-center justify-center';
const DEFAULT_PANEL   = 'bg-surface-900 border border-surface-800 rounded-lg shadow-2xl flex flex-col';

interface ModalProps {
  onClose: () => void
  /** When set, renders the standard title bar (title + × close button). */
  title?: React.ReactNode
  /** Small line under the title — only rendered when `title` is set. */
  subtitle?: React.ReactNode
  /** Overlay classes (darkness, z-index, alignment). Replaces the default. */
  overlayClassName?: string
  /** Panel classes (width, layout, border). Replaces the default. */
  panelClassName?: string
  /** Close when the backdrop is clicked. Default true. */
  closeOnBackdrop?: boolean
  /** Close when Escape is pressed. Default true. */
  closeOnEscape?: boolean
  children: React.ReactNode
}

export function Modal({
  onClose,
  title,
  subtitle,
  overlayClassName = DEFAULT_OVERLAY,
  panelClassName = DEFAULT_PANEL,
  closeOnBackdrop = true,
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

  return (
    <div
      className={`fixed inset-0 ${overlayClassName}`}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div className={panelClassName} onClick={e => e.stopPropagation()}>
        {title !== undefined && (
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-800 flex-shrink-0">
            <div>
              <h2 className="text-sm font-semibold">{title}</h2>
              {subtitle !== undefined && (
                <p className="text-[10px] text-surface-400 mt-0.5">{subtitle}</p>
              )}
            </div>
            <button onClick={onClose} className="text-surface-400 hover:text-[var(--text-primary)] text-lg leading-none">×</button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
