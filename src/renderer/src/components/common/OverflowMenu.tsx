// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useEffect, useId, useRef, useState } from 'react';

// A small, accessible overflow dropdown (mouse + keyboard) used by the response
// toolbar for "More" tabs and the "…" action menu. It is rendered inline (not a
// portal) so it lives inside the toolbar's @container and its menu items can
// show/hide via container-query classes. Menu items are plain <button
// role="menuitem"> children; items hidden by a container query are skipped
// during keyboard navigation.

interface Props {
  /** Trigger label (e.g. "More ▾" or "…"). */
  button: React.ReactNode;
  ariaLabel: string;
  title?: string;
  /** Classes for the relative wrapper — put container-query show/hide here so
   *  the whole control appears only at the widths where it is needed. */
  wrapperClassName?: string;
  buttonClassName?: string;
  /** Which edge to anchor the menu to. */
  align?: 'left' | 'right';
  children: React.ReactNode;
}

export function OverflowMenu({ button, ariaLabel, title, wrapperClassName = '', buttonClassName = '', align = 'right', children }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Visible (not container-query-hidden) menu items, in DOM order.
  function items(): HTMLElement[] {
    if (!menuRef.current) return [];
    return Array.from(menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .filter(el => el.offsetParent !== null && !el.hasAttribute('disabled'));
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open]);

  // Focus the first item when opening.
  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const list = items();
    const idx = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(idx + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(idx - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btnRef.current?.focus(); }
    else if (e.key === 'Tab') { setOpen(false); }
  }

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); }
  }

  return (
    <div ref={wrapRef} className={`relative ${wrapperClassName}`}>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        title={title ?? ariaLabel}
        onClick={() => setOpen(o => !o)}
        onKeyDown={onTriggerKeyDown}
        className={buttonClassName}
      >
        {button}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          onKeyDown={onMenuKeyDown}
          // Close after a menu item is activated (mouse or keyboard).
          onClick={() => setOpen(false)}
          className={`absolute top-full mt-1 z-50 min-w-[150px] bg-surface-900 border border-surface-700 rounded-lg shadow-2xl py-1 flex flex-col ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
