// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from 'react';

// ─── Inline rename ────────────────────────────────────────────────────────────

export function InlineEdit ( {
  value, onCommit, onCancel, className = '', validate,
}: {
  value: string; onCommit: ( v: string ) => void; onCancel: () => void; className?: string
  validate?: ( v: string ) => string | null
} ) {
  const [draft, setDraft] = useState( value );
  const [error, setError] = useState<string | null>( null );
  const ref = useRef<HTMLInputElement>( null );
  useEffect( () => { ref.current?.select(); }, [] );

  function tryCommit ( v: string ) {
    const trimmed = v.trim();
    if ( !trimmed ) { onCancel(); return; }
    const err = validate?.( trimmed ) ?? null;
    if ( err ) { setError( err ); setTimeout( () => ref.current?.focus(), 0 ); return; }
    onCommit( trimmed );
  }

  return (
    <div onClick={e => e.stopPropagation()}>
      <input
        ref={ref}
        value={draft}
        onChange={e => { setDraft( e.target.value ); setError( null ); }}
        onBlur={() => tryCommit( draft )}
        onKeyDown={e => {
          if ( e.key === 'Enter' ) tryCommit( draft );
          if ( e.key === 'Escape' ) onCancel();
          e.stopPropagation();
        }}
        // Force the input's own text color so it's consistent regardless of
        // the parent row's `text-surface-*` (folder rows are dimmer than
        // request rows; without this, renaming a folder *looks* different
        // from renaming a request).
        className={`bg-surface-700 text-[var(--text-primary)] rounded px-1 focus:outline-none focus:ring-1 w-full ${error ? 'ring-1 ring-red-500 focus:ring-red-500' : 'focus:ring-blue-500'
          } ${className}`}
      />
      {error && <p className="text-[10px] text-red-400 mt-0.5 px-1">{error}</p>}
    </div>
  );
}
