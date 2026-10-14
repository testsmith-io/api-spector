// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DotsHorizontalIcon } from './icons';
import { useT } from '../../i18n';

// ─── Context menu ─────────────────────────────────────────────────────────────

export type MenuItem =
  | { type: 'item'; label: string; icon?: React.ReactNode; danger?: boolean; onClick: () => void }
  | { type: 'separator' }
  | { type: 'header'; label: string }

export function ContextMenu ( { items, x, y, onClose }: {
  items: MenuItem[]
  x: number
  y: number
  onClose: () => void
} ) {
  const ref = useRef<HTMLDivElement>( null );

  useEffect( () => {
    function handle ( e: MouseEvent ) {
      if ( ref.current && !ref.current.contains( e.target as Node ) ) onClose();
    }
    document.addEventListener( 'mousedown', handle, true );
    return () => document.removeEventListener( 'mousedown', handle, true );
  }, [onClose] );

  const [pos, setPos] = useState( { top: y, left: x } );
  useEffect( () => {
    if ( !ref.current ) return;
    const rect = ref.current.getBoundingClientRect();
    let left = x;
    let top = y;
    if ( left + rect.width > window.innerWidth ) left = x - rect.width;
    if ( top + rect.height > window.innerHeight ) top = y - rect.height;
    setPos( { top, left } );
  }, [x, y] );

  return createPortal(
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
      className="bg-surface-900 border border-surface-700 rounded-lg shadow-2xl py-1 min-w-[170px]"
      onMouseDown={e => e.stopPropagation()}
    >
      {items.map( ( item, i ) =>
        item.type === 'separator' ? (
          <div key={i} className="border-t border-surface-700 my-1" />
        ) : item.type === 'header' ? (
          <div key={i} className="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider font-semibold text-surface-500 select-none">
            {item.label}
          </div>
        ) : (
          <button
            key={i}
            onClick={e => { e.stopPropagation(); item.onClick(); onClose(); }}
            className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${item.danger
              ? 'text-red-400 hover:bg-surface-800 hover:text-red-300'
              : 'text-[var(--text-primary)] hover:bg-surface-800'
              }`}
          >
            {item.icon && <span className="w-3 h-3 shrink-0 flex items-center justify-center">{item.icon}</span>}
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  );
}

/**
 * The "⋯" options button. In addition to opening on click, it binds a
 * right-click (contextmenu) handler to its enclosing row — the nearest ancestor
 * matching `rowSelector` (default `[data-row]`) — so right-clicking anywhere on
 * that row opens the same menu at the cursor. Mark each row's root element with
 * `data-row` to enable it.
 */
export function DotsBtn ( { items, rowSelector = '[data-row]' }: {
  readonly items: MenuItem[]
  readonly rowSelector?: string
} ) {
  const t = useT();
  const btnRef = useRef<HTMLButtonElement>( null );
  const [menu, setMenu] = useState<{ x: number; y: number } | null>( null );

  // Open the same menu on right-click of the enclosing row.
  useEffect( () => {
    const row = btnRef.current?.closest( rowSelector ) as HTMLElement | null;
    if ( !row ) return;
    function onContextMenu ( e: MouseEvent ) {
      e.preventDefault();
      e.stopPropagation();   // innermost row wins for nested rows
      setMenu( { x: e.clientX, y: e.clientY } );
    }
    row.addEventListener( 'contextmenu', onContextMenu );
    return () => row.removeEventListener( 'contextmenu', onContextMenu );
  }, [rowSelector] );

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={e => {
          e.stopPropagation();
          if ( menu ) { setMenu( null ); return; }
          const rect = ( e.currentTarget as HTMLElement ).getBoundingClientRect();
          setMenu( { x: rect.right + 4, y: rect.top } );
        }}
        className="opacity-0 group-hover:opacity-100 px-1 py-0.5 rounded text-surface-400 hover:text-white hover:bg-surface-700 transition-all"
        title={t('Options')}
      >
        <DotsHorizontalIcon />
      </button>
      {menu && (
        <ContextMenu items={items} x={menu.x} y={menu.y} onClose={() => setMenu( null )} />
      )}
    </div>
  );
}
